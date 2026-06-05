"""
部门间冲突解决器 - 解决多部门在战略议题上的立场冲突。

设计目的：
1. 模拟公司内部"销售 vs 财务"、"产品 vs 技术"等真实部门博弈
2. 把"议题 → 部门立场 → 加权议价 → 公司级决策"的过程形式化
3. 让报告里的"为什么选 A 不选 B"有可解释的因果链

核心算法：
- 每个部门基于 KPI 权重计算对议题的立场（-1 到 1）
- 立场 × 决策权 = 投票权重
- 加权平均得到公司级立场
- 根据公司级立场选择"采纳/拒绝/妥协"策略

Implements: US-204 部门冲突建模
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum

from ..models.department_agent import DepartmentAgent, DepartmentType, DEPARTMENT_NAMES_CN


class ResolutionOutcome(str, Enum):
    """议题解决结果"""
    ADOPTED = "ADOPTED"           # 采纳
    REJECTED = "REJECTED"         # 拒绝
    COMPROMISED = "COMPROMISED"   # 妥协
    DEFERRED = "DEFERRED"         # 暂缓


@dataclass
class DepartmentPosition:
    """部门在某个议题上的立场"""
    dept_type: DepartmentType
    dept_name: str
    position: float              # -1.0 强烈反对 到 1.0 强烈支持
    confidence: float            # 0-1，信心
    voting_weight: float         # 决策权 × 信心
    rationale: str = ""          # 立场理由


@dataclass
class TopicResolution:
    """一个议题的部门博弈结果"""
    topic: str
    positions: List[DepartmentPosition] = field(default_factory=list)
    company_position: float = 0.0
    outcome: ResolutionOutcome = ResolutionOutcome.DEFERRED
    winning_depts: List[DepartmentType] = field(default_factory=list)
    losing_depts: List[DepartmentType] = field(default_factory=list)
    summary: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "topic": self.topic,
            "positions": [
                {
                    "dept_type": p.dept_type.value,
                    "dept_name": p.dept_name,
                    "position": p.position,
                    "confidence": p.confidence,
                    "voting_weight": p.voting_weight,
                    "rationale": p.rationale,
                }
                for p in self.positions
            ],
            "company_position": self.company_position,
            "outcome": self.outcome.value,
            "outcome_label_cn": {
                "ADOPTED": "采纳",
                "REJECTED": "拒绝",
                "COMPROMISED": "妥协",
                "DEFERRED": "暂缓",
            }.get(self.outcome.value, "暂缓"),
            "winning_depts": [d.value for d in self.winning_depts],
            "losing_depts": [d.value for d in self.losing_depts],
            "summary": self.summary,
        }


class InterDepartmentResolver:
    """
    部门间冲突解决器。
    
    解决流程：
    1. 收集所有部门对议题的立场
    2. 计算加权平均的公司级立场
    3. 根据立场和分歧度决定结果
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.adoption_threshold = self.config.get("adoption_threshold", 0.3)
        self.rejection_threshold = self.config.get("rejection_threshold", -0.3)
        self.compromise_threshold = self.config.get("compromise_dissent_threshold", 0.5)
    
    def resolve(
        self,
        topic: str,
        departments: List[DepartmentAgent],
        external_pressure: float = 0.0,
        business_model_modifier: Optional[Dict[str, float]] = None,
    ) -> TopicResolution:
        """
        解决一个议题。
        
        Args:
            topic: 议题（如"是否投入 AI 中台研发"）
            departments: 公司所有部门 Agent
            external_pressure: 外部压力 -1 到 1（董事会/股东压力）
            business_model_modifier: 经营模式对各部门话语权的修正
            
        Returns:
            TopicResolution 包含所有部门立场和最终决议
        """
        positions: List[DepartmentPosition] = []
        business_model_modifier = business_model_modifier or {}
        
        for dept in departments:
            # 基础立场
            base_stance = dept.stance_on_topic(topic)
            
            # 经营模式对立场的影响
            power_mod = business_model_modifier.get(dept.department_type.value, 1.0)
            
            # 决策权
            effective_power = dept.decision_power * power_mod
            
            # 信心（决策权越高，信心越高）
            confidence = min(1.0, 0.5 + effective_power * 0.5)
            
            # 投票权重
            voting_weight = effective_power * confidence
            
            # 立场理由
            rationale = self._generate_rationale(dept, topic, base_stance)
            
            positions.append(DepartmentPosition(
                dept_type=dept.department_type,
                dept_name=DEPARTMENT_NAMES_CN.get(dept.department_type, "未知"),
                position=base_stance,
                confidence=confidence,
                voting_weight=voting_weight,
                rationale=rationale,
            ))
        
        # 计算加权平均立场
        total_weight = sum(p.voting_weight for p in positions)
        if total_weight > 0:
            company_position = sum(
                p.position * p.voting_weight for p in positions
            ) / total_weight
        else:
            company_position = 0.0
        
        # 加入外部压力
        company_position = (company_position * 0.85 + external_pressure * 0.15)
        company_position = max(-1.0, min(1.0, company_position))
        
        # 决定结果
        outcome = self._decide_outcome(positions, company_position)
        winning, losing = self._identify_winners_losers(positions, outcome)
        summary = self._generate_summary(topic, positions, outcome, company_position)
        
        return TopicResolution(
            topic=topic,
            positions=positions,
            company_position=company_position,
            outcome=outcome,
            winning_depts=winning,
            losing_depts=losing,
            summary=summary,
        )
    
    def _decide_outcome(
        self,
        positions: List[DepartmentPosition],
        company_position: float,
    ) -> ResolutionOutcome:
        """根据公司立场和分歧度决定结果"""
        # 分歧度 = 各部门立场的标准差
        if not positions:
            return ResolutionOutcome.DEFERRED
        
        mean_pos = sum(p.position for p in positions) / len(positions)
        variance = sum((p.position - mean_pos) ** 2 for p in positions) / len(positions)
        dissent = variance ** 0.5
        
        if company_position >= self.adoption_threshold:
            if dissent > self.compromise_threshold:
                return ResolutionOutcome.COMPROMISED
            return ResolutionOutcome.ADOPTED
        elif company_position <= self.rejection_threshold:
            if dissent > self.compromise_threshold:
                return ResolutionOutcome.DEFERRED
            return ResolutionOutcome.REJECTED
        else:
            if dissent > 0.6:
                return ResolutionOutcome.DEFERRED
            return ResolutionOutcome.COMPROMISED
    
    def _identify_winners_losers(
        self,
        positions: List[DepartmentPosition],
        outcome: ResolutionOutcome,
    ) -> tuple:
        if outcome in (ResolutionOutcome.ADOPTED, ResolutionOutcome.COMPROMISED):
            winners = [p.dept_type for p in positions if p.position > 0.2]
            losers = [p.dept_type for p in positions if p.position < -0.2]
        else:
            winners = [p.dept_type for p in positions if p.position < -0.2]
            losers = [p.dept_type for p in positions if p.position > 0.2]
        return winners, losers
    
    def _generate_rationale(
        self,
        dept: DepartmentAgent,
        topic: str,
        stance: float,
    ) -> str:
        """生成部门立场的简短理由"""
        if stance > 0.5:
            return f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '本部门')}基于 KPI 权重强烈支持"
        elif stance > 0.2:
            return f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '本部门')}倾向于支持"
        elif stance < -0.5:
            return f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '本部门')}基于 KPI 权重强烈反对"
        elif stance < -0.2:
            return f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '本部门')}倾向于反对"
        else:
            return f"{DEPARTMENT_NAMES_CN.get(dept.department_type, '本部门')}保持中立"
    
    def _generate_summary(
        self,
        topic: str,
        positions: List[DepartmentPosition],
        outcome: ResolutionOutcome,
        company_position: float,
    ) -> str:
        """生成决议摘要"""
        labels = {
            ResolutionOutcome.ADOPTED: "已采纳",
            ResolutionOutcome.REJECTED: "已拒绝",
            ResolutionOutcome.COMPROMISED: "已妥协",
            ResolutionOutcome.DEFERRED: "暂缓决定",
        }
        
        support = [p for p in positions if p.position > 0.2]
        oppose = [p for p in positions if p.position < -0.2]
        
        summary = f"议题「{topic}」"
        if support:
            names = "、".join(p.dept_name for p in support)
            summary += f"，{names}支持"
        if oppose:
            names = "、".join(p.dept_name for p in oppose)
            summary += f"，{names}反对"
        summary += f"。公司级立场={company_position:+.2f}，{labels.get(outcome, '暂缓')}"
        return summary
