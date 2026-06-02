"""
RiskAssessmentMatrix - Evaluate and categorize strategic risks

Provides probability/impact assessment with mitigation strategies.
Visualization data for frontend heatmap.

Implements: US-086
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from enum import Enum


class RiskCategory(str, Enum):
    """Categories of strategic risks"""
    STRATEGIC = "strategic"
    OPERATIONAL = "operational"
    FINANCIAL = "financial"
    COMPLIANCE = "compliance"
    REPUTATIONAL = "reputational"


@dataclass
class RiskFactor:
    """A strategic risk factor"""
    name: str
    category: RiskCategory
    probability: float  # 0.0 to 1.0
    impact: float  # 0.0 to 1.0
    risk_score: float  # probability * impact
    description: str
    mitigation_strategies: List[str] = field(default_factory=list)
    owner: str = ""
    status: str = "open"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category.value,
            "probability": self.probability,
            "impact": self.impact,
            "risk_score": self.risk_score,
            "description": self.description,
            "mitigation_strategies": self.mitigation_strategies,
            "owner": self.owner,
            "status": self.status,
        }


class RiskAssessmentMatrix:
    """
    Risk assessment matrix for strategic options.
    
    Visualizes risks on probability vs impact grid.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def evaluate(
        self,
        options: List[Any],
        context: Dict[str, Any],
    ) -> List[RiskFactor]:
        """
        Evaluate risks for strategic options.
        
        Args:
            options: List of strategic options
            context: Strategic context
            
        Returns:
            List of RiskFactor objects
        """
        risks = []
        
        for option in options:
            # Strategic risks
            if hasattr(option, 'name'):
                risks.append(RiskFactor(
                    name=f"Execution risk for {option.name}",
                    category=RiskCategory.STRATEGIC,
                    probability=0.4 if option.probability_of_success > 0.6 else 0.6,
                    impact=0.7,
                    risk_score=0.4 * 0.7,
                    description=f"Risk of failing to execute {option.name}",
                    mitigation_strategies=[
                        "Detailed implementation plan",
                        "Regular progress reviews",
                        "Contingency planning",
                    ],
                ))
            
            # Financial risks
            risks.append(RiskFactor(
                name="Budget overrun",
                category=RiskCategory.FINANCIAL,
                probability=0.3,
                impact=0.5,
                risk_score=0.15,
                description="Cost exceeds approved budget",
                mitigation_strategies=[
                    "Phased budget approval",
                    "Regular budget reviews",
                ],
            ))
        
        # Compliance risks (always present)
        risks.append(RiskFactor(
            name="Regulatory compliance",
            category=RiskCategory.COMPLIANCE,
            probability=0.2,
            impact=0.9,
            risk_score=0.18,
            description="Failure to comply with regulations",
            mitigation_strategies=[
                "Legal review before actions",
                "Compliance monitoring",
            ],
        ))
        
        return risks
    
    def get_visualization_data(
        self,
        risks: List[RiskFactor],
    ) -> Dict[str, Any]:
        """
        Get data for frontend risk matrix visualization.
        
        Returns data structured for heatmap display.
        """
        matrix = [[0 for _ in range(5)] for _ in range(5)]
        positioned = []
        
        for risk in risks:
            # Position on 5x5 grid (rounded)
            prob_idx = min(4, int(risk.probability * 5))
            impact_idx = min(4, int(risk.impact * 5))
            matrix[prob_idx][impact_idx] += 1
            
            positioned.append({
                "x": prob_idx,
                "y": impact_idx,
                "name": risk.name,
                "category": risk.category.value,
                "risk_score": risk.risk_score,
            })
        
        return {
            "matrix": matrix,
            "risks": positioned,
            "total_risks": len(risks),
            "high_risk_count": sum(1 for r in risks if r.risk_score > 0.5),
        }
