"""
OpinionReportGenerator - Generate public sentiment impact reports

Predicts sentiment timeline and identifies key influencers.
Recommends mitigation strategies for negative sentiment.

Implements: US-092
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

from .sentiment_tracker import SentimentTracker, SentimentDataPoint


@dataclass
class OpinionReport:
    """Public opinion impact report"""
    title: str
    current_sentiment: str
    sentiment_timeline: List[Dict[str, Any]] = field(default_factory=list)
    key_influencers: List[Dict[str, Any]] = field(default_factory=list)
    predicted_trajectory: str = ""
    mitigation_strategies: List[str] = field(default_factory=list)
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "current_sentiment": self.current_sentiment,
            "sentiment_timeline": self.sentiment_timeline,
            "key_influencers": self.key_influencers,
            "predicted_trajectory": self.predicted_trajectory,
            "mitigation_strategies": self.mitigation_strategies,
            "generated_at": self.generated_at,
        }


class OpinionReportGenerator:
    """
    Generates reports on public opinion impact.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def generate(
        self,
        sentiment_tracker: SentimentTracker,
        action_results: Optional[Dict[str, Any]] = None,
    ) -> OpinionReport:
        """
        Generate opinion report.
        
        Args:
            sentiment_tracker: Tracker with sentiment history
            action_results: Optional action results to analyze
            
        Returns:
            OpinionReport with analysis
        """
        current = sentiment_tracker.get_current_sentiment()
        history = sentiment_tracker.get_history()
        turning_points = sentiment_tracker.get_turning_points()
        momentum = sentiment_tracker.get_momentum()
        
        # Build timeline
        timeline = [p.to_dict() for p in history]
        
        # Identify key influencers (high influence agents with sentiment shifts)
        influencers = self._identify_influencers(history, action_results)
        
        # Predict trajectory
        trajectory = self._predict_trajectory(momentum, turning_points)
        
        # Mitigation strategies
        mitigation = self._recommend_mitigation(current, momentum)
        
        return OpinionReport(
            title="Public Opinion Impact Report",
            current_sentiment=current.sentiment.value if current else "neutral",
            sentiment_timeline=timeline,
            key_influencers=influencers,
            predicted_trajectory=trajectory,
            mitigation_strategies=mitigation,
        )
    
    def _identify_influencers(
        self,
        history: List[SentimentDataPoint],
        action_results: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Identify key influencers"""
        influencers = []
        
        if action_results:
            agents = action_results.get("agents", [])
            for agent in agents:
                if agent.get("influence_score", 0) > 0.7:
                    influencers.append({
                        "agent_id": agent.get("agent_id"),
                        "name": agent.get("name"),
                        "influence_score": agent.get("influence_score"),
                        "stance": agent.get("current_stance", "neutral"),
                    })
        
        return influencers[:5]  # Top 5
    
    def _predict_trajectory(
        self,
        momentum: float,
        turning_points: List[SentimentDataPoint],
    ) -> str:
        """Predict sentiment trajectory"""
        if momentum > 0.1:
            return "Sentiment trending positive"
        elif momentum < -0.1:
            return "Sentiment trending negative - intervention recommended"
        else:
            return "Sentiment stable"
    
    def _recommend_mitigation(
        self,
        current: Optional[SentimentDataPoint],
        momentum: float,
    ) -> List[str]:
        """Recommend mitigation strategies"""
        strategies = []
        
        if current and current.score < -0.3:
            strategies.append("Engage with key influencers directly")
            strategies.append("Prepare official statement addressing concerns")
            strategies.append("Consider transparency initiative")
        
        if momentum < -0.1:
            strategies.append("Monitor sentiment velocity closely")
            strategies.append("Prepare rapid response team")
        
        if not strategies:
            strategies.append("Continue current engagement strategy")
            strategies.append("Monitor for early warning signs")
        
        return strategies
