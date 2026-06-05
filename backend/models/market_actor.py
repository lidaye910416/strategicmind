"""
客户/竞争对手 Agent 模型 - 把客户和竞争对手作为独立的推演参与者。

设计目的：
1. 客户 Agent 决定是否购买、续约、流失
2. 竞争对手 Agent 决定是否打价格战、推出新产品
3. 让推演更接近"双边市场"的真实博弈

Implements: US-203 客户/竞品建模
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum
from uuid import uuid4

from .strategic_agent import StrategicAgent, AgentType, BeliefState, InterestProfile


class CustomerSegment(str, Enum):
    """客户细分"""
    GOVERNMENT = "GOVERNMENT"           # 政府客户
    STATE_OWNED = "STATE_OWNED"         # 国企客户
    PRIVATE_ENTERPRISE = "PRIVATE_ENTERPRISE"  # 民企客户
    FOREIGN = "FOREIGN"                 # 外资客户
    SMB = "SMB"                         # 中小企业
    CONSUMER = "CONSUMER"               # 个人消费者
    DEVELOPER = "DEVELOPER"             # 开发者/技术客户


CUSTOMER_SEGMENT_LABELS_CN: Dict[CustomerSegment, str] = {
    CustomerSegment.GOVERNMENT: "政府客户",
    CustomerSegment.STATE_OWNED: "国企客户",
    CustomerSegment.PRIVATE_ENTERPRISE: "民企客户",
    CustomerSegment.FOREIGN: "外资客户",
    CustomerSegment.SMB: "中小企业",
    CustomerSegment.CONSUMER: "个人消费者",
    CustomerSegment.DEVELOPER: "开发者客户",
}


@dataclass
class CustomerAgent(StrategicAgent):
    """
    客户 Agent - 模拟客户在推演中的购买/续约/流失决策。
    """
    
    segment: CustomerSegment = CustomerSegment.PRIVATE_ENTERPRISE
    
    # 购买行为
    purchase_intent: float = 0.5      # 购买意向 0-1
    price_sensitivity: float = 0.5    # 价格敏感度 0-1
    switching_cost: float = 0.3       # 切换成本 0-1（越高越难换供应商）
    
    # 当前供应商
    current_supplier: str = ""        # 当前供应商名字
    contract_remaining_months: int = 0
    satisfaction_score: float = 0.6    # 对当前供应商的满意度 0-1
    
    # 历史
    purchase_history: List[Dict[str, Any]] = field(default_factory=list)
    churned: bool = False
    churn_reason: str = ""
    
    def __post_init__(self):
        if not self.name:
            self.name = f"{CUSTOMER_SEGMENT_LABELS_CN.get(self.segment, '客户')}-{str(self.agent_id)[:6]}"
        self.agent_type = AgentType.CUSTOMER if hasattr(AgentType, 'CUSTOMER') else AgentType.PARTNER
        if not self.action_repertoire:
            self.action_repertoire = ["MAKE_STATEMENT", "PROPOSE_DEAL", "PRIVATE_MEETING", "LEAVE_COALITION"]
    
    def evaluate_offer(self, price: float, quality: float, brand: float) -> Dict[str, Any]:
        """
        评估供应商报价。
        
        Returns:
            评估结果：是否接受、综合评分
        """
        # 综合效用 = 质量/价格权重 + 品牌 + 切换成本影响
        price_utility = (1.0 - self.price_sensitivity) * quality * 0.6
        brand_utility = brand * 0.3
        switching_penalty = -self.switching_cost * 0.4
        
        # 当前供应商满意度影响
        stay_utility = self.satisfaction_score * 0.7
        switch_utility = price_utility + brand_utility + switching_penalty
        
        return {
            "will_switch": switch_utility > stay_utility,
            "switch_utility": switch_utility,
            "stay_utility": stay_utility,
            "purchase_intent_change": (switch_utility - stay_utility) * 0.2,
        }
    
    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base.update({
            "agent_kind": "customer",
            "segment": self.segment.value,
            "segment_name_cn": CUSTOMER_SEGMENT_LABELS_CN.get(self.segment, ""),
            "purchase_intent": self.purchase_intent,
            "price_sensitivity": self.price_sensitivity,
            "switching_cost": self.switching_cost,
            "current_supplier": self.current_supplier,
            "contract_remaining_months": self.contract_remaining_months,
            "satisfaction_score": self.satisfaction_score,
            "churned": self.churned,
        })
        return base


class CompetitorStrategy(str, Enum):
    """竞品策略类型"""
    PRICE_WAR = "PRICE_WAR"             # 价格战
    INNOVATION = "INNOVATION"           # 创新领先
    DIFFERENTIATION = "DIFFERENTIATION" # 差异化
    COOPERATION = "COOPERATION"         # 合作共存
    FOLLOWER = "FOLLOWER"               # 跟随
    DEFENSIVE = "DEFENSIVE"             # 防御


COMPETITOR_STRATEGY_LABELS_CN: Dict[CompetitorStrategy, str] = {
    CompetitorStrategy.PRICE_WAR: "价格战",
    CompetitorStrategy.INNOVATION: "创新领先",
    CompetitorStrategy.DIFFERENTIATION: "差异化",
    CompetitorStrategy.COOPERATION: "合作共存",
    CompetitorStrategy.FOLLOWER: "跟随",
    CompetitorStrategy.DEFENSIVE: "防御",
}


@dataclass
class CompetitorAgent(StrategicAgent):
    """
    竞争对手 Agent - 模拟竞争对手在推演中的策略行为。
    """
    
    name_label: str = ""                    # 竞品名称（区别于 name）
    market_share: float = 0.10              # 市场份额 0-1
    aggressiveness: float = 0.5             # 攻击性 0-1
    tech_parity: float = 0.7                # 技术对等度 0-1（vs 我们）
    
    strategy: CompetitorStrategy = CompetitorStrategy.FOLLOWER
    
    # 财务
    revenue_estimate: float = 0.0           # 营收估计（亿元）
    rd_spend_ratio: float = 0.10            # 研发投入占比
    
    # 近期动作历史
    recent_actions: List[Dict[str, Any]] = field(default_factory=list)
    
    def __post_init__(self):
        if not self.name:
            self.name = self.name_label or f"竞品-{str(self.agent_id)[:6]}"
        self.agent_type = AgentType.COMPETITOR
        if not self.action_repertoire:
            self.action_repertoire = [
                "MAKE_STATEMENT", "PRIVATE_MEETING", "TRADE_ASSET",
                "ACCUMULATE_POSITION", "SPREAD_NARRATIVE", "PROPOSE_DEAL",
            ]
    
    def predict_response(self, our_action_type: str) -> Dict[str, Any]:
        """
        预测竞品对我方某个动作的可能反应。
        """
        if self.strategy == CompetitorStrategy.PRICE_WAR:
            return {
                "likely_response": "PRICE_CUT",
                "severity": self.aggressiveness,
                "time_horizon_days": 30,
                "description": "竞品可能采取激进的价格跟随策略",
            }
        elif self.strategy == CompetitorStrategy.INNOVATION:
            return {
                "likely_response": "ACCELERATE_RD",
                "severity": self.aggressiveness * 0.7,
                "time_horizon_days": 90,
                "description": "竞品可能加速研发以维持技术领先",
            }
        elif self.strategy == CompetitorStrategy.FOLLOWER:
            return {
                "likely_response": "COPY",
                "severity": 0.3,
                "time_horizon_days": 60,
                "description": "竞品可能采取跟随策略",
            }
        elif self.strategy == CompetitorStrategy.DIFFERENTIATION:
            return {
                "likely_response": "EMPHASIZE_DIFF",
                "severity": 0.4,
                "time_horizon_days": 45,
                "description": "竞品可能强调其差异化优势",
            }
        else:
            return {
                "likely_response": "OBSERVE",
                "severity": 0.1,
                "time_horizon_days": 90,
                "description": "竞品可能持观望态度",
            }
    
    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base.update({
            "agent_kind": "competitor",
            "name_label": self.name_label,
            "market_share": self.market_share,
            "aggressiveness": self.aggressiveness,
            "tech_parity": self.tech_parity,
            "strategy": self.strategy.value,
            "strategy_label_cn": COMPETITOR_STRATEGY_LABELS_CN.get(self.strategy, ""),
            "revenue_estimate": self.revenue_estimate,
            "rd_spend_ratio": self.rd_spend_ratio,
        })
        return base
