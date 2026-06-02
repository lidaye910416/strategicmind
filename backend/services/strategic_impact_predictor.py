"""
StrategicImpactPredictor - Combine strategic + opinion predictions

Generates impact score with confidence intervals.
Identifies risks from negative public sentiment.

Implements: US-094
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
import statistics

from .sentiment_tracker import SentimentTracker


@dataclass
class ImpactPrediction:
    """Predicted impact of strategic action"""
    impact_score: float  # -1.0 to 1.0
    confidence_interval: tuple  # (low, high)
    strategic_component: float
    opinion_component: float
    risks: List[Dict[str, Any]] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "impact_score": self.impact_score,
            "confidence_interval": list(self.confidence_interval),
            "strategic_component": self.strategic_component,
            "opinion_component": self.opinion_component,
            "risks": self.risks,
        }


class StrategicImpactPredictor:
    """
    Predicts combined impact of strategic actions considering
    both business and public opinion factors.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.strategic_weight = self.config.get("strategic_weight", 0.6)
        self.opinion_weight = self.config.get("opinion_weight", 0.4)
    
    def predict(
        self,
        strategic_recommendations: List[Dict[str, Any]],
        sentiment_tracker: SentimentTracker,
    ) -> ImpactPrediction:
        """
        Predict combined impact.
        
        Args:
            strategic_recommendations: Strategic recommendations
            sentiment_tracker: Current sentiment tracker
            
        Returns:
            ImpactPrediction with score and risks
        """
        # Calculate strategic component
        strategic_score = self._calculate_strategic_score(strategic_recommendations)
        
        # Calculate opinion component
        opinion_score = self._calculate_opinion_score(sentiment_tracker)
        
        # Combine
        combined = (
            self.strategic_weight * strategic_score
            + self.opinion_weight * opinion_score
        )
        
        # Calculate confidence interval
        ci = self._calculate_confidence_interval(strategic_score, opinion_score)
        
        # Identify risks
        risks = self._identify_risks(sentiment_tracker, strategic_recommendations)
        
        return ImpactPrediction(
            impact_score=combined,
            confidence_interval=ci,
            strategic_component=strategic_score,
            opinion_component=opinion_score,
            risks=risks,
        )
    
    def _calculate_strategic_score(
        self,
        recommendations: List[Dict[str, Any]],
    ) -> float:
        """Calculate strategic component score"""
        if not recommendations:
            return 0.0
        
        scores = [
            r.get("expected_value", 0.5) * r.get("probability_of_success", 0.5)
            for r in recommendations
        ]
        return sum(scores) / len(scores)
    
    def _calculate_opinion_score(
        self,
        sentiment_tracker: SentimentTracker,
    ) -> float:
        """Calculate opinion component score"""
        current = sentiment_tracker.get_current_sentiment()
        if not current:
            return 0.0
        return current.score
    
    def _calculate_confidence_interval(
        self,
        strategic: float,
        opinion: float,
    ) -> tuple:
        """Calculate confidence interval"""
        mean = (strategic + opinion) / 2
        std = abs(strategic - opinion) / 2
        return (mean - 1.96 * std, mean + 1.96 * std)
    
    def _identify_risks(
        self,
        sentiment_tracker: SentimentTracker,
        recommendations: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Identify risks from sentiment and strategy"""
        risks = []
        
        current = sentiment_tracker.get_current_sentiment()
        momentum = sentiment_tracker.get_momentum()
        
        if current and current.score < -0.3:
            risks.append({
                "type": "reputational",
                "severity": abs(current.score),
                "description": "Negative public sentiment may amplify strategic impact",
            })
        
        if momentum < -0.1:
            risks.append({
                "type": "sentiment_velocity",
                "severity": abs(momentum),
                "description": "Sentiment trending negative - high risk of escalation",
            })
        
        for rec in recommendations:
            if rec.get("probability_of_success", 0.5) < 0.3:
                risks.append({
                    "type": "execution",
                    "severity": 1.0 - rec.get("probability_of_success", 0.5),
                    "description": f"Low success probability for: {rec.get('name', 'Unknown')}",
                })
        
        return risks
