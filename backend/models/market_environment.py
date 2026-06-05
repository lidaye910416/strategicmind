"""
市场环境 Agent - 持续的市场环境驱动，影响所有部门和业务指标。

设计目的：
1. 替代 ExternalShockSimulator 的"离散事件触发"模式
2. 提供持续的"市场冷/热"、"政策紧/松"、"技术新/旧"等环境信号
3. 部门 Agent 在决策前先 query 市场环境
4. 业务指标根据市场环境持续调整

Implements: US-202 市场环境建模
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any
from enum import Enum
import math
import random


class MarketCycle(str, Enum):
    """市场周期"""
    BOOM = "BOOM"               # 繁荣
    EXPANSION = "EXPANSION"     # 扩张
    PEAK = "PEAK"               # 见顶
    CONTRACTION = "CONTRACTION" # 收缩
    TROUGH = "TROUGH"           # 谷底
    RECOVERY = "RECOVERY"       # 复苏


class PolicyStance(str, Enum):
    """政策立场"""
    SUPPORTIVE = "SUPPORTIVE"   # 鼓励
    NEUTRAL = "NEUTRAL"         # 中性
    RESTRICTIVE = "RESTRICTIVE" # 限制


MARKET_CYCLE_LABELS_CN: Dict[MarketCycle, str] = {
    MarketCycle.BOOM: "繁荣期",
    MarketCycle.EXPANSION: "扩张期",
    MarketCycle.PEAK: "见顶期",
    MarketCycle.CONTRACTION: "收缩期",
    MarketCycle.TROUGH: "谷底期",
    MarketCycle.RECOVERY: "复苏期",
}

POLICY_STANCE_LABELS_CN: Dict[PolicyStance, str] = {
    PolicyStance.SUPPORTIVE: "鼓励",
    PolicyStance.NEUTRAL: "中性",
    PolicyStance.RESTRICTIVE: "限制",
}


@dataclass
class MarketEnvironmentAgent:
    """
    市场环境 Agent。
    
    持续维护一组市场环境指标，每个推演回合根据走势更新。
    """
    
    # 行业环境
    sector_growth_rate: float = 0.08        # 行业年增速（默认 8%）
    market_size_billion: float = 100.0      # 行业市场规模（亿元）
    competition_intensity: float = 0.5      # 竞争激烈度 0-1
    
    # 政策环境
    policy_stance: PolicyStance = PolicyStance.NEUTRAL
    policy_pressure: float = 0.3            # 政策压力 0-1
    policy_change_probability: float = 0.05  # 每轮政策变化概率
    
    # 资本环境
    capital_availability: float = 0.6       # 资金可获得性 0-1
    interest_rate_level: float = 0.04       # 利率水平
    
    # 技术环境
    tech_maturity: float = 0.6              # 技术成熟度 0-1
    innovation_pace: float = 0.5            # 创新节奏 0-1
    
    # 客户/消费者环境
    consumer_sentiment: float = 0.5         # 消费者信心 -1 到 1
    customer_price_sensitivity: float = 0.5  # 价格敏感度 0-1
    
    # 市场周期
    current_cycle: MarketCycle = MarketCycle.EXPANSION
    cycle_position: float = 0.0             # 0-1 周期内位置
    
    # 季度/年度时间
    fiscal_quarter: int = 1
    fiscal_year_offset: int = 0
    
    # 历史
    history: List[Dict[str, Any]] = field(default_factory=list)
    
    def quarterly_update(self, random_seed: int = None) -> Dict[str, Any]:
        """
        推进一个季度，更新市场环境。
        
        Returns:
            本次更新的环境变更摘要
        """
        if random_seed is not None:
            rng = random.Random(random_seed)
        else:
            rng = random
        
        changes = {}
        
        # 行业增速波动
        growth_shock = rng.gauss(0, 0.01)
        old_growth = self.sector_growth_rate
        self.sector_growth_rate = max(-0.10, min(0.30, self.sector_growth_rate + growth_shock))
        changes["sector_growth_rate"] = {
            "from": old_growth, "to": self.sector_growth_rate,
        }
        
        # 周期推进
        self.cycle_position = (self.cycle_position + 0.083) % 1.0  # 1 季 = 1/4 年
        self.current_cycle = self._infer_cycle()
        
        # 政策变化（低概率）
        if rng.random() < self.policy_change_probability:
            old_stance = self.policy_stance
            self.policy_stance = rng.choice(list(PolicyStance))
            self.policy_pressure = max(0, min(1, self.policy_pressure + rng.gauss(0, 0.1)))
            changes["policy"] = {"from": old_stance.value, "to": self.policy_stance.value}
        
        # 消费者情绪漂移
        self.consumer_sentiment = max(-1, min(1,
            self.consumer_sentiment + rng.gauss(0, 0.05)))
        
        # 资金可获得性跟随利率
        self.capital_availability = max(0, min(1,
            0.7 - self.interest_rate_level * 5 + rng.gauss(0, 0.05)))
        
        # 时间推进
        self.fiscal_quarter = (self.fiscal_quarter % 4) + 1
        if self.fiscal_quarter == 1:
            self.fiscal_year_offset += 1
        
        # 记录历史
        snapshot = self.snapshot()
        snapshot["changes"] = changes
        self.history.append(snapshot)
        
        return changes
    
    def _infer_cycle(self) -> MarketCycle:
        """根据增速推断市场周期"""
        if self.sector_growth_rate > 0.15:
            return MarketCycle.BOOM
        elif self.sector_growth_rate > 0.08:
            return MarketCycle.EXPANSION
        elif self.sector_growth_rate > 0.04:
            return MarketCycle.PEAK
        elif self.sector_growth_rate > 0.0:
            return MarketCycle.CONTRACTION
        elif self.sector_growth_rate > -0.05:
            return MarketCycle.TROUGH
        else:
            return MarketCycle.RECOVERY
    
    def affect_department(self, dept_kpi_weights: Dict[str, float]) -> Dict[str, float]:
        """
        计算市场环境对部门 KPI 的影响。
        
        Args:
            dept_kpi_weights: 部门 KPI 权重
            
        Returns:
            每个 KPI 的修正系数（-0.3 到 +0.3）
        """
        impact = {}
        
        # 行业增速影响所有增长类 KPI
        growth_boost = (self.sector_growth_rate - 0.05) * 2
        impact["营收"] = max(-0.3, min(0.3, growth_boost))
        impact["用户增长"] = max(-0.3, min(0.3, growth_boost * 1.2))
        
        # 竞争激烈度对毛利率有负面影响
        impact["毛利率"] = -self.competition_intensity * 0.2
        
        # 资金可获得性影响创新/研发
        impact["研发投入"] = (self.capital_availability - 0.5) * 0.3
        impact["创新"] = (self.capital_availability - 0.5) * 0.2 + \
                         (self.innovation_pace - 0.5) * 0.2
        
        # 政策压力影响合规和扩张
        impact["合规"] = -self.policy_pressure * 0.1
        impact["风险控制"] = -self.policy_pressure * 0.1
        
        # 消费者情绪影响客户类 KPI
        impact["客户满意度"] = self.consumer_sentiment * 0.15
        
        # 价格敏感度影响利润率
        impact["毛利率"] += self.customer_price_sensitivity * 0.15
        
        return impact
    
    def snapshot(self) -> Dict[str, Any]:
        return {
            "sector_growth_rate": self.sector_growth_rate,
            "market_size_billion": self.market_size_billion,
            "competition_intensity": self.competition_intensity,
            "policy_stance": self.policy_stance.value,
            "policy_pressure": self.policy_pressure,
            "capital_availability": self.capital_availability,
            "interest_rate_level": self.interest_rate_level,
            "tech_maturity": self.tech_maturity,
            "innovation_pace": self.innovation_pace,
            "consumer_sentiment": self.consumer_sentiment,
            "customer_price_sensitivity": self.customer_price_sensitivity,
            "current_cycle": self.current_cycle.value,
            "cycle_label_cn": MARKET_CYCLE_LABELS_CN.get(self.current_cycle, ""),
            "fiscal_quarter": self.fiscal_quarter,
            "fiscal_year_offset": self.fiscal_year_offset,
        }
    
    def to_dict(self) -> Dict[str, Any]:
        return self.snapshot()
