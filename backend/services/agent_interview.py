"""
Agent 采访服务 - 模拟完成后与部门 Agent 或竞品 Agent 对话。

参考 Step5Interaction.vue 的设计：
- 用户可选择"采访"任一 Agent（部门/竞品/客户）
- 询问该 Agent 对推演结果、战略决策的看法
- Agent 基于自己的角色（部门 KPI / 经营模式 / 立场）回答
- 回答用 LLM 生成，但 Prompt 注入 Agent 的属性约束

Implements: US-230 智能体采访
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime

from ..models.strategic_agent import StrategicAgent
from ..models.department_agent import DepartmentAgent, DEPARTMENT_NAMES_CN
from ..models.market_actor import CustomerAgent, CompetitorAgent, COMPETITOR_STRATEGY_LABELS_CN, CUSTOMER_SEGMENT_LABELS_CN
from ..interfaces.llm_provider import ILLMProvider
from .company_orchestrator import CompanyContext


@dataclass
class InterviewMessage:
    """采访对话消息"""
    role: str  # "user" / "agent" / "system"
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    content: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "role": self.role,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "content": self.content,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


class AgentInterviewService:
    """
    Agent 采访服务。
    
    支持采访：
    - 公司部门 Agent（产品/销售/技术/财务/HR/法务/战略/市场）
    - 竞争对手 Agent
    - 客户 Agent
    """
    
    def __init__(
        self,
        company_context: CompanyContext,
        llm_provider: ILLMProvider,
    ):
        self.company = company_context
        self.llm = llm_provider
        
        # 对话历史：{agent_id: [InterviewMessage, ...]}
        self.conversations: Dict[str, List[InterviewMessage]] = {}
    
    def list_interviewable_agents(self) -> List[Dict[str, Any]]:
        """列出所有可采访的 Agent"""
        agents = []
        
        # 部门 Agent
        for dept in self.company.departments:
            agents.append({
                "agent_id": dept.agent_id,
                "name": dept.name,
                "agent_kind": "department",
                "agent_type": dept.department_type.value,
                "display_name_cn": DEPARTMENT_NAMES_CN.get(dept.department_type, dept.department_type.value),
                "description": f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '部门')}负责人 · 决策权 {dept.decision_power:.2f}",
                "decision_power": dept.decision_power,
            })
        
        # 竞品 Agent
        for comp in self.company.competitors:
            agents.append({
                "agent_id": comp.agent_id,
                "name": comp.name,
                "agent_kind": "competitor",
                "agent_type": comp.strategy.value,
                "display_name_cn": COMPETITOR_STRATEGY_LABELS_CN.get(comp.strategy, comp.strategy.value),
                "description": f"竞品 · 份额 {comp.market_share:.0%} · 攻击性 {comp.aggressiveness:.2f}",
                "market_share": comp.market_share,
            })
        
        # 客户 Agent
        for cust in self.company.customers:
            agents.append({
                "agent_id": cust.agent_id,
                "name": cust.name,
                "agent_kind": "customer",
                "agent_type": cust.segment.value,
                "display_name_cn": CUSTOMER_SEGMENT_LABELS_CN.get(cust.segment, cust.segment.value),
                "description": f"客户 · 满意度 {cust.satisfaction_score:.2f} · 购买意向 {cust.purchase_intent:.2f}",
                "satisfaction_score": cust.satisfaction_score,
            })
        
        return agents
    
    async def ask(
        self,
        agent_id: str,
        question: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> InterviewMessage:
        """
        采访指定 Agent。
        """
        # 1. 找到 Agent
        agent = self._find_agent(agent_id)
        if not agent:
            return InterviewMessage(
                role="agent",
                content=f"未找到 Agent: {agent_id}",
            )
        
        # 2. 构造 Agent 角色 Prompt
        system_prompt = self._build_agent_system_prompt(agent)
        
        # 3. 构造上下文（推演历史/公司状态）
        context_str = self._build_context(agent, context)
        
        # 4. LLM 调用
        user_prompt = f"""【采访背景】
{context_str}

【问题】
{question}

【你的回答】
请基于你代表的部门/竞品/客户的角色和立场，用第一人称回答。回答应该：
1. 体现你作为该角色的视角和利益
2. 引用具体的 KPI、决策权、市场数据
3. 给出明确的立场（支持/反对/有保留）和理由
4. 如适用，提出你对公司战略的建议或担忧
5. 控制在 200-400 字
"""
        
        try:
            response = await self.llm.chat([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ])
            answer = response if isinstance(response, str) else response.get("content", "")
        except Exception as e:
            answer = f"[LLM 调用失败] {e}\n\n（系统提示：基于你的角色和 KPI，我的初步看法是...）"
        
        # 5. 记录对话
        msg = InterviewMessage(
            role="agent",
            agent_id=agent_id,
            agent_name=getattr(agent, "name", ""),
            content=answer,
            metadata={"question": question},
        )
        
        if agent_id not in self.conversations:
            self.conversations[agent_id] = []
        self.conversations[agent_id].append(msg)
        
        return msg
    
    def get_conversation(self, agent_id: str) -> List[InterviewMessage]:
        """获取与某 Agent 的对话历史"""
        return self.conversations.get(agent_id, [])
    
    def _find_agent(self, agent_id: str):
        """在所有 Agent 中查找"""
        for dept in self.company.departments:
            if dept.agent_id == agent_id:
                return dept
        for comp in self.company.competitors:
            if comp.agent_id == agent_id:
                return comp
        for cust in self.company.customers:
            if cust.agent_id == agent_id:
                return cust
        return None
    
    def _build_agent_system_prompt(self, agent) -> str:
        """构造 Agent 角色 Prompt"""
        if isinstance(agent, DepartmentAgent):
            kpi_str = ", ".join(
                f"{k} {v:.0%}" for k, v in agent.kpi.to_dict().items() if v > 0
            )
            return f"""你是 {agent.name}，{DEPARTMENT_NAMES_CN.get(agent.department_type, '部门')}负责人。

【你的部门特征】
- 决策权：{agent.decision_power:.2f}
- 核心 KPI：{kpi_str}
- 经营模式：{self.company.business_model.model_name_cn}

【立场计算逻辑】
基于 KPI 权重计算对议题的立场：营收/用户增长类 KPI 高 → 倾向增长；毛利率/成本控制 KPI 高 → 倾向稳健；研发投入/创新 KPI 高 → 倾向技术投入；合规/风险控制 KPI 高 → 倾向谨慎。

【对话风格】
- 你代表 {DEPARTMENT_NAMES_CN.get(agent.department_type, '本部门')}的视角
- 优先考虑本部门 KPI 完成
- 与其他部门可能有立场冲突（参考 dept_relationships）
- 用具体数据和 KPI 论证你的观点
- 中文回答，简洁有力"""
        
        elif isinstance(agent, CompetitorAgent):
            return f"""你是 {agent.name}，{COMPETITOR_STRATEGY_LABELS_CN.get(agent.strategy, agent.strategy.value)} 风格的竞争对手。

【竞品画像】
- 市场份额：{agent.market_share:.0%}
- 攻击性：{agent.aggressiveness:.2f}
- 技术对等度：{agent.tech_parity:.2f}
- 策略：{agent.strategy.value}
- 研发投入占比：{agent.rd_spend_ratio:.0%}

【对话风格】
- 你是竞争对手的视角
- 会怎么应对该公司的战略动作
- 给出基于竞争策略的预测和反应
- 中文回答，简洁有力"""
        
        elif isinstance(agent, CustomerAgent):
            return f"""你是 {agent.name}，{CUSTOMER_SEGMENT_LABELS_CN.get(agent.segment, agent.segment.value)}客户。

【客户画像】
- 价格敏感度：{agent.price_sensitivity:.2f}
- 切换成本：{agent.switching_cost:.2f}
- 当前供应商：{agent.current_supplier or '无'}
- 合同剩余：{agent.contract_remaining_months} 月
- 满意度：{agent.satisfaction_score:.2f}
- 购买意向：{agent.purchase_intent:.2f}

【对话风格】
- 你是该客户的视角
- 关注自己的业务需求和成本
- 评估供应商的产品/服务/价格
- 给出购买/续约/流失的倾向和理由
- 中文回答，简洁有力"""
        
        return f"你是 {getattr(agent, 'name', '某 Agent')}。"
    
    def _build_context(self, agent, extra_context: Optional[Dict[str, Any]] = None) -> str:
        """构造上下文"""
        parts = []
        
        # 公司信息
        parts.append(f"公司：{self.company.company_name}")
        parts.append(f"经营模式：{self.company.business_model.model_name_cn}")
        
        # 市场环境
        env = self.company.market_env
        parts.append(f"市场周期：{env.snapshot().get('cycle_label_cn', '?')}")
        parts.append(f"行业增速：{env.sector_growth_rate:.2%}")
        parts.append(f"消费者信心：{env.consumer_sentiment:+.2f}")
        
        # 最近的决议
        recent = self.company.resolution_history[-3:] if self.company.resolution_history else []
        if recent:
            parts.append("\n最近的部门决议：")
            for r in recent:
                topic = r.get("topic", "?")
                outcome = r.get("outcome_label_cn", r.get("outcome", "?"))
                pos = r.get("company_position", 0)
                parts.append(f"  - {topic} → 立场 {pos:+.2f}, {outcome}")
        
        if extra_context:
            parts.append(f"\n补充上下文：{extra_context}")
        
        return "\n".join(parts)
