"""
ValuationModel - Financial projections for strategic decisions

Supports DCF, comparable company analysis, precedent transactions.
Provides base, upside, downside scenarios.

Implements: US-084
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from enum import Enum


class ScenarioType(str, Enum):
    """Valuation scenarios"""
    BASE_CASE = "base_case"
    UPSIDE_CASE = "upside_case"
    DOWNSIDE_CASE = "downside_case"


@dataclass
class FinancialProjection:
    """Financial projection output"""
    method: str
    base_value: float
    upside_value: float
    downside_value: float
    years: int
    yearly_projections: List[Dict[str, float]] = field(default_factory=list)
    assumptions: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "method": self.method,
            "base_value": self.base_value,
            "upside_value": self.upside_value,
            "downside_value": self.downside_value,
            "years": self.years,
            "yearly_projections": self.yearly_projections,
            "assumptions": self.assumptions,
        }


class ValuationModel:
    """
    Financial valuation and projection model.
    
    Methods:
        - DCF (Discounted Cash Flow)
        - Comparable company analysis
        - Precedent transactions
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.discount_rate = self.config.get("discount_rate", 0.10)
        self.terminal_growth = self.config.get("terminal_growth", 0.03)
    
    def project(
        self,
        simulation_results: Dict[str, Any],
        years: int = 5,
    ) -> FinancialProjection:
        """
        Project financial outcomes.
        
        Args:
            simulation_results: Results from strategic simulation
            years: Number of years to project
            
        Returns:
            FinancialProjection with scenarios
        """
        # Get base financial metrics
        base_revenue = self._extract_revenue(simulation_results)
        growth_rate = self._extract_growth_rate(simulation_results)
        
        # Calculate scenarios
        base_value = self._dcf_projection(base_revenue, growth_rate, years)
        upside_value = self._dcf_projection(base_revenue, growth_rate + 0.05, years)
        downside_value = self._dcf_projection(base_revenue, max(0, growth_rate - 0.05), years)
        
        # Year-by-year projections
        yearly = []
        for year in range(1, years + 1):
            yearly.append({
                "year": year,
                "base_revenue": base_revenue * ((1 + growth_rate) ** year),
                "upside_revenue": base_revenue * ((1 + growth_rate + 0.05) ** year),
                "downside_revenue": base_revenue * ((1 + max(0, growth_rate - 0.05)) ** year),
            })
        
        return FinancialProjection(
            method="DCF",
            base_value=base_value,
            upside_value=upside_value,
            downside_value=downside_value,
            years=years,
            yearly_projections=yearly,
            assumptions={
                "discount_rate": self.discount_rate,
                "terminal_growth": self.terminal_growth,
                "growth_rate": growth_rate,
            },
        )
    
    def comparable_company_analysis(
        self,
        target_metrics: Dict[str, float],
        comparable_multiples: Dict[str, float],
    ) -> FinancialProjection:
        """Valuation using comparable companies"""
        revenue = target_metrics.get("revenue", 0)
        multiple = comparable_multiples.get("ev_revenue", 1.0)
        
        base_value = revenue * multiple
        upside_value = base_value * 1.2
        downside_value = base_value * 0.8
        
        return FinancialProjection(
            method="comparable_company",
            base_value=base_value,
            upside_value=upside_value,
            downside_value=downside_value,
            years=1,
        )
    
    def precedent_transactions(
        self,
        target_metrics: Dict[str, float],
        transaction_multiples: List[Dict[str, float]],
    ) -> FinancialProjection:
        """Valuation from precedent transactions"""
        revenue = target_metrics.get("revenue", 0)
        
        if not transaction_multiples:
            multiple = 1.0
        else:
            avg_multiple = sum(t.get("ev_revenue", 1.0) for t in transaction_multiples) / len(transaction_multiples)
            multiple = avg_multiple
        
        base_value = revenue * multiple
        return FinancialProjection(
            method="precedent_transactions",
            base_value=base_value,
            upside_value=base_value * 1.15,
            downside_value=base_value * 0.85,
            years=1,
        )
    
    def _extract_revenue(self, results: Dict) -> float:
        """Extract revenue from results"""
        # Placeholder - in production, would parse from financial data
        return 100_000_000.0  # 100M base
    
    def _extract_growth_rate(self, results: Dict) -> float:
        """Extract growth rate from results"""
        return 0.10  # 10% baseline
    
    def _dcf_projection(
        self,
        base_revenue: float,
        growth_rate: float,
        years: int,
    ) -> float:
        """Calculate DCF projection"""
        total_value = 0.0
        for year in range(1, years + 1):
            future_revenue = base_revenue * ((1 + growth_rate) ** year)
            # Assume 15% profit margin
            cash_flow = future_revenue * 0.15
            # Discount to present
            discount_factor = 1 / ((1 + self.discount_rate) ** year)
            total_value += cash_flow * discount_factor
        
        # Add terminal value
        terminal_cf = base_revenue * ((1 + growth_rate) ** years) * 0.15
        terminal_value = terminal_cf * (1 + self.terminal_growth) / (self.discount_rate - self.terminal_growth)
        discount_factor = 1 / ((1 + self.discount_rate) ** years)
        total_value += terminal_value * discount_factor
        
        return total_value
