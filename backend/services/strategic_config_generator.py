"""
StrategicConfigGenerator - Convert SeedDocument to SimulationConfig

Extracts stakeholders, claims, positions, and metrics from documents.
Implements: US-072

P2-G3 升级：接受 user_params 派生 max_rounds / n_stakeholders / 部门列表 / 外部因素；
保留旧 _define_metrics 作为 user_params 缺失时的 fallback。
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

from ..models.seed_document import SeedDocument
from ..models.strategic_agent import AgentType


# 时间步长 → 每多少回合代表 1 年的映射（与 frontend/src/types/simulationConfig.ts 同步）
_TIME_STEP_PER_YEAR: Dict[str, int] = {
    "year": 1,
    "quarter": 4,
    "month": 12,
}

# 默认派生值（与 frontend DEFAULT_USER_PARAMS 保持一致）
_DEFAULT_YEARS = 1
_DEFAULT_TIME_STEP = "quarter"
_DEFAULT_N_STAKEHOLDERS = 12
_MAX_N_STAKEHOLDERS = 24
_MIN_N_STAKEHOLDERS = 6
# 部门与 agent_type 名称前缀的简单映射（保证至少有"销售/技术/财务"等被识别）
_DEPT_KEYWORD_PREFIXES: List[tuple] = [
    ("销售", "销售"),
    ("技术", "技术"),
    ("财务", "财务"),
    ("HR", "HR"),
    ("法务", "法务"),
    ("产品", "产品"),
    ("运营", "运营"),
    ("市场", "市场"),
]


@dataclass
class SimulationConfig:
    """Simulation configuration"""
    seed_doc_id: str
    agents: List[Dict[str, Any]] = field(default_factory=list)
    max_rounds: int = 10
    simulated_hours: int = 72
    metrics: List[str] = field(default_factory=list)
    topics: List[str] = field(default_factory=list)
    # P2-G3 派生字段
    selected_departments: List[str] = field(default_factory=list)
    external_factors: List[str] = field(default_factory=list)
    emergence_policy: str = "moderate"
    convergence_policy: str = "auto_extend"
    time_step: str = _DEFAULT_TIME_STEP
    years: int = _DEFAULT_YEARS


class StrategicConfigGenerator:
    """
    Generates simulation configuration from seed documents.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}

    def generate(
        self,
        seed_doc: SeedDocument,
        requirement: str,
        user_params: Optional[Dict[str, Any]] = None,
    ) -> SimulationConfig:
        """
        Generate SimulationConfig from a SeedDocument.

        Args:
            seed_doc: SeedDocument to analyze
            requirement: User requirement
            user_params: 可选 8 维用户参数，缺省则走 _define_metrics fallback 行为
                {
                    years: int,
                    time_step: 'year' | 'quarter' | 'month',
                    departments: List[str],
                    external_factors: List[str],
                    n_stakeholders: int,
                    emergence_policy: 'conservative'|'moderate'|'aggressive',
                    convergence_policy: 'fixed'|'auto_extend',
                }

        Returns:
            SimulationConfig for the simulation
        """
        if user_params:
            return self._generate_with_user_params(seed_doc, requirement, user_params)

        # ---------- Fallback：原行为（无 user_params 时）----------
        agents = self._identify_stakeholders(seed_doc)
        topics = self._map_claims_to_topics(seed_doc, agents)
        metrics = self._define_metrics(requirement)
        return SimulationConfig(
            seed_doc_id=seed_doc.doc_id,
            agents=agents,
            max_rounds=self.config.get("max_rounds", 10),
            simulated_hours=self.config.get("simulated_hours", 72),
            metrics=metrics,
            topics=topics,
        )

    # ---------- P2-G3 主路径 ----------
    def _generate_with_user_params(
        self,
        seed_doc: SeedDocument,
        requirement: str,
        user_params: Dict[str, Any],
    ) -> SimulationConfig:
        """基于 user_params 派生 max_rounds / 部门 / 外部因素 / agent 列表。"""
        # 1) 派生 years / time_step / max_rounds
        years = self._coerce_int(user_params.get("years", _DEFAULT_YEARS), default=_DEFAULT_YEARS, lo=1, hi=10)
        time_step = str(user_params.get("time_step", _DEFAULT_TIME_STEP) or _DEFAULT_TIME_STEP)
        per_year = _TIME_STEP_PER_YEAR.get(time_step, 4)
        max_rounds = years * per_year

        # 2) 派生 n_stakeholders（6..24，与前端 input min/max 对齐）
        n_stakeholders_raw = self._coerce_int(
            user_params.get("n_stakeholders", _DEFAULT_N_STAKEHOLDERS),
            default=_DEFAULT_N_STAKEHOLDERS,
            lo=_MIN_N_STAKEHOLDERS,
            hi=_MAX_N_STAKEHOLDERS,
        )
        n_stakeholders = min(n_stakeholders_raw, _MAX_N_STAKEHOLDERS)

        # 3) 派生 selected_departments / external_factors
        selected_departments = list(user_params.get("departments") or [])
        external_factors = [str(x).strip() for x in (user_params.get("external_factors") or []) if str(x).strip()]

        # 4) 派生 emergence / convergence policy
        emergence_policy = str(user_params.get("emergence_policy", "moderate") or "moderate")
        convergence_policy = str(user_params.get("convergence_policy", "auto_extend") or "auto_extend")

        # 5) 构造 agents：基础 stakeholders + 部门 slot agents（每个部门至少 3 个）
        base_agents = self._identify_stakeholders(seed_doc)
        agents: List[Dict[str, Any]] = list(base_agents)
        agents_per_dept = max(3, n_stakeholders // max(1, len(selected_departments))) if selected_departments else 0
        for dept in selected_departments:
            for i in range(agents_per_dept):
                agents.append({
                    "name": f"{dept}-Agent-{i+1}",
                    "agent_type": self._dept_to_agent_type(dept),
                    "influence_weight": 0.5,
                    "department": dept,
                })
        # 如果部门没产生任何 agent（n_stakeholders=0、depts=[]），保留 n_stakeholders 名占位 agent
        if not selected_departments and n_stakeholders > len(agents):
            for i in range(n_stakeholders - len(agents)):
                agents.append({
                    "name": f"Stakeholder_{i+1}",
                    "agent_type": AgentType.CORPORATE_EXEC.value,
                    "influence_weight": 0.5,
                    "department": None,
                })
        # 兜底：n_stakeholders 截断
        agents = agents[: max(1, n_stakeholders)]

        # 6) topics：来自 claims；如果有外部因素，附加为议题
        topics = self._map_claims_to_topics(seed_doc, agents)
        for factor in external_factors:
            if factor and factor not in topics:
                topics.append(factor[:80])

        # 7) metrics：根据 emergence_policy 决定指标丰富度
        metrics = self._define_metrics(requirement, emergence_policy=emergence_policy)

        return SimulationConfig(
            seed_doc_id=seed_doc.doc_id,
            agents=agents,
            max_rounds=max_rounds,
            simulated_hours=int(self.config.get("simulated_hours", 72)),
            metrics=metrics,
            topics=topics,
            selected_departments=selected_departments,
            external_factors=external_factors,
            emergence_policy=emergence_policy,
            convergence_policy=convergence_policy,
            time_step=time_step,
            years=years,
        )

    # ---------- 保留的旧方法（fallback 仍调用） ----------
    def _identify_stakeholders(
        self,
        seed_doc: SeedDocument,
    ) -> List[Dict[str, Any]]:
        """Extract stakeholders from document"""
        agents = []

        # Use extracted entities
        for entity in seed_doc.key_entities:
            agent_type = self._infer_agent_type(entity.entity_type)
            agents.append({
                "name": entity.text,
                "agent_type": agent_type,
                "influence_weight": 0.5,
            })

        return agents

    def _map_claims_to_topics(
        self,
        seed_doc: SeedDocument,
        agents: List[Dict[str, Any]],
    ) -> List[str]:
        """Map claims to belief topics"""
        topics = []
        for claim in seed_doc.claims[:10]:
            topics.append(claim.content[:50])
        return topics

    def _define_metrics(
        self,
        requirement: str,
        emergence_policy: str = "moderate",
    ) -> List[str]:
        """Define outcome metrics based on requirement.

        emergence_policy 影响指标丰富度：
        - conservative: 4 项基础指标
        - moderate:     6 项（含部门 / 时间维度）
        - aggressive:   8 项（含涌现 / 反弹 / 收敛速率）
        """
        base = [
            "belief_evolution",
            "action_count",
            "stakeholder_engagement",
            "decision_quality",
        ]
        if emergence_policy == "conservative":
            return base
        if emergence_policy == "moderate":
            return base + ["department_drift", "time_step_pressure"]
        # aggressive
        return base + [
            "department_drift",
            "time_step_pressure",
            "emergence_index",
            "convergence_rate",
        ]

    def _infer_agent_type(self, entity_type: str) -> str:
        """Map entity type to agent type"""
        entity_type_lower = entity_type.lower()

        if "person" in entity_type_lower or "individual" in entity_type_lower:
            return AgentType.CORPORATE_EXEC.value
        elif "company" in entity_type_lower or "organization" in entity_type_lower:
            return AgentType.CORPORATE_EXEC.value
        elif "government" in entity_type_lower:
            return AgentType.POLICY_MAKER.value
        elif "investor" in entity_type_lower:
            return AgentType.INSTITUTIONAL_INVESTOR.value
        elif "media" in entity_type_lower:
            return AgentType.MEDIA.value

        return AgentType.CORPORATE_EXEC.value

    # ---------- P2-G3 辅助方法 ----------
    def _dept_to_agent_type(self, dept: str) -> str:
        """把中文部门名映射到 AgentType；未知部门默认 CORPORATE_EXEC。"""
        for kw, _ in _DEPT_KEYWORD_PREFIXES:
            if kw in dept:
                # 所有部门均用 CORPORATE_EXEC 作为占位；具体行为由 profile_generator
                # 在 PROFILE_GENERATION 阶段根据 user_params 进一步覆盖。
                return AgentType.CORPORATE_EXEC.value
        return AgentType.CORPORATE_EXEC.value

    @staticmethod
    def _coerce_int(value: Any, default: int, lo: int, hi: int) -> int:
        """安全转 int 并裁剪到 [lo, hi]。"""
        try:
            v = int(value)
        except (TypeError, ValueError):
            return default
        return max(lo, min(hi, v))
