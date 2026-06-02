"""
CompetitiveResponseSimulator - Model competitor responses to actions

Predicts how competitors might respond to strategic moves.
Implements: US-087
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from enum import Enum


class CompetitorType(str, Enum):
    """Types of competitor behavior"""
    AGGRESSIVE = "aggressive"
    DEFENSIVE = "defensive"
    OPPORTUNISTIC = "opportunistic"


@dataclass
class ResponseScenario:
    """Predicted competitor response"""
    competitor_type: CompetitorType
    action_type: str
    description: str
    probability: float
    impact_on_us: float
    counter_actions: List[str]


class CompetitiveResponseSimulator:
    """
    Simulates how competitors might respond to our actions.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def predict(
        self,
        our_action: Dict[str, Any],
        competitor_profiles: List[Dict[str, Any]],
    ) -> List[ResponseScenario]:
        """
        Predict competitor responses.
        
        Args:
            our_action: The action we plan to take
            competitor_profiles: List of competitor profile dicts
            
        Returns:
            List of predicted ResponseScenarios
        """
        scenarios = []
        
        for competitor in competitor_profiles:
            comp_type = self._classify_competitor(competitor)
            
            if comp_type == CompetitorType.AGGRESSIVE:
                scenarios.append(ResponseScenario(
                    competitor_type=comp_type,
                    action_type="RETALIATE",
                    description=f"{competitor.get('name', 'Competitor')} will likely retaliate aggressively",
                    probability=0.7,
                    impact_on_us=0.6,
                    counter_actions=[
                        "Strengthen coalition",
                        "Pre-emptive PR",
                        "Legal preparation",
                    ],
                ))
            elif comp_type == CompetitorType.DEFENSIVE:
                scenarios.append(ResponseScenario(
                    competitor_type=comp_type,
                    action_type="FORTIFY",
                    description=f"{competitor.get('name', 'Competitor')} will likely fortify their position",
                    probability=0.6,
                    impact_on_us=0.3,
                    counter_actions=[
                        "Target their customers",
                        "Lock in key partnerships",
                    ],
                ))
            else:  # Opportunistic
                scenarios.append(ResponseScenario(
                    competitor_type=comp_type,
                    action_type="EXPLOIT",
                    description=f"{competitor.get('name', 'Competitor')} may exploit perceived weakness",
                    probability=0.5,
                    impact_on_us=0.4,
                    counter_actions=[
                        "Maintain strong messaging",
                        "Quick response team",
                    ],
                ))
        
        return scenarios
    
    def _classify_competitor(
        self,
        profile: Dict[str, Any],
    ) -> CompetitorType:
        """Classify competitor by behavior type"""
        behavior = profile.get("behavior", "neutral").lower()
        risk_tolerance = profile.get("risk_tolerance", 0.5)
        
        if behavior == "aggressive" or risk_tolerance > 0.7:
            return CompetitorType.AGGRESSIVE
        elif behavior == "defensive" or risk_tolerance < 0.3:
            return CompetitorType.DEFENSIVE
        return CompetitorType.OPPORTUNISTIC
