"""
StrategicContext - Financial and market environment modeling

This model represents the external environment for strategic decisions,
including market indicators, sector trends, and financial metrics.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum
from datetime import datetime


class ScenarioType(str, Enum):
    """Financial scenario types"""
    BULLISH = "bullish"
    BASELINE = "baseline"
    BEARISH = "bearish"


@dataclass
class MarketIndicators:
    """Market indicator data"""
    index_level: float = 0.0
    index_change: float = 0.0  # Percentage
    volatility: float = 0.0   # VIX-like
    volume: float = 0.0
    sentiment: float = 0.5    # 0.0 (bearish) to 1.0 (bullish)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "index_level": self.index_level,
            "index_change": self.index_change,
            "volatility": self.volatility,
            "volume": self.volume,
            "sentiment": self.sentiment,
        }


@dataclass
class SectorTrend:
    """Sector-specific trend data"""
    sector: str
    trend: float  # -1.0 (declining) to 1.0 (growing)
    outlook: str  # short-term, medium-term, long-term
    key_factors: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "sector": self.sector,
            "trend": self.trend,
            "outlook": self.outlook,
            "key_factors": self.key_factors,
        }


@dataclass
class RegulatoryEnvironment:
    """Regulatory environment data"""
    jurisdiction: str = ""
    policy_stance: str = ""  # restrictive, neutral, supportive
    pending_regulations: List[str] = field(default_factory=list)
    enforcement_level: float = 0.5  # 0.0 (lax) to 1.0 (strict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "jurisdiction": self.jurisdiction,
            "policy_stance": self.policy_stance,
            "pending_regulations": self.pending_regulations,
            "enforcement_level": self.enforcement_level,
        }


@dataclass
class FinancialMetrics:
    """Financial metrics for valuation"""
    revenue_growth: float = 0.0  # YoY growth rate
    profit_margin: float = 0.0    # Net margin
    valuation_multiple: float = 0.0  # P/E or similar
    debt_to_equity: float = 0.0
    current_ratio: float = 1.0
    free_cash_flow: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "revenue_growth": self.revenue_growth,
            "profit_margin": self.profit_margin,
            "valuation_multiple": self.valuation_multiple,
            "debt_to_equity": self.debt_to_equity,
            "current_ratio": self.current_ratio,
            "free_cash_flow": self.free_cash_flow,
        }


@dataclass
class StrategicContext:
    """
    Context for strategic decisions.
    
    This model captures the external environment including:
        - Market conditions
        - Sector trends
        - Regulatory environment
        - Financial metrics
        - Scenario projections
    
    Usage:
        context = StrategicContext()
        context.market = MarketIndicators(index_level=3000, sentiment=0.6)
        context.generate_scenarios()
    """
    
    # Context metadata
    context_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    data_source: str = ""
    
    # Environment components
    market: MarketIndicators = field(default_factory=MarketIndicators)
    sector_trends: List[SectorTrend] = field(default_factory=list)
    regulatory: RegulatoryEnvironment = field(default_factory=RegulatoryEnvironment)
    financials: FinancialMetrics = field(default_factory=FinancialMetrics)
    
    # Scenario modeling
    base_scenario: ScenarioType = ScenarioType.BASELINE
    
    # Additional context
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def generate_scenarios(
        self,
        bullish_modifier: float = 0.2,
        bearish_modifier: float = -0.2,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Generate bullish, baseline, and bearish scenarios.
        
        Args:
            bullish_modifier: Modifier for bullish scenario
            bearish_modifier: Modifier for bearish scenario
            
        Returns:
            Dict with scenario variations
        """
        base_growth = self.financials.revenue_growth
        
        return {
            "bullish": {
                "revenue_growth": base_growth + bullish_modifier,
                "profit_margin": self.financials.profit_margin + 0.05,
                "market_sentiment": min(1.0, self.market.sentiment + 0.2),
            },
            "baseline": {
                "revenue_growth": base_growth,
                "profit_margin": self.financials.profit_margin,
                "market_sentiment": self.market.sentiment,
            },
            "bearish": {
                "revenue_growth": base_growth + bearish_modifier,
                "profit_margin": max(0, self.financials.profit_margin - 0.05),
                "market_sentiment": max(0, self.market.sentiment - 0.2),
            },
        }
    
    def get_sector_trend(self, sector: str) -> Optional[SectorTrend]:
        """Get trend for a specific sector"""
        for trend in self.sector_trends:
            if trend.sector.lower() == sector.lower():
                return trend
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "context_id": self.context_id,
            "timestamp": self.timestamp,
            "data_source": self.data_source,
            "market": self.market.to_dict(),
            "sector_trends": [t.to_dict() for t in self.sector_trends],
            "regulatory": self.regulatory.to_dict(),
            "financials": self.financials.to_dict(),
            "base_scenario": self.base_scenario.value,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrategicContext':
        return cls(
            context_id=data.get("context_id", ""),
            data_source=data.get("data_source", ""),
            market=MarketIndicators(**data.get("market", {})),
            sector_trends=[SectorTrend(**t) for t in data.get("sector_trends", [])],
            regulatory=RegulatoryEnvironment(**data.get("regulatory", {})),
            financials=FinancialMetrics(**data.get("financials", {})),
            base_scenario=ScenarioType(data.get("base_scenario", "baseline")),
            metadata=data.get("metadata", {}),
        )
