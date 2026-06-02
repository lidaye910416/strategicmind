"""
SentimentTracker - Track sentiment changes over time

Calculates sentiment momentum and velocity, identifies turning points.
Implements: US-091
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from collections import deque

from ..models.public_opinion_agent import SentimentType


@dataclass
class SentimentDataPoint:
    """A single sentiment measurement"""
    timestamp: str
    round_num: int
    sentiment: SentimentType
    score: float  # -1.0 to 1.0
    volume: int  # Number of mentions
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "round_num": self.round_num,
            "sentiment": self.sentiment.value,
            "score": self.score,
            "volume": self.volume,
        }


class SentimentTracker:
    """
    Tracks sentiment over time and identifies patterns.
    """
    
    def __init__(self, window_size: int = 10):
        self.window_size = window_size
        self._history: deque[SentimentDataPoint] = deque(maxlen=1000)
        self._turning_points: List[SentimentDataPoint] = []
    
    def record(
        self,
        score: float,
        volume: int = 1,
        round_num: int = 0,
    ) -> None:
        """Record a sentiment measurement"""
        # Classify sentiment
        if score > 0.3:
            sentiment = SentimentType.POSITIVE
        elif score < -0.3:
            sentiment = SentimentType.NEGATIVE
        elif abs(score) <= 0.1:
            sentiment = SentimentType.NEUTRAL
        else:
            sentiment = SentimentType.MIXED
        
        data_point = SentimentDataPoint(
            timestamp=datetime.now().isoformat(),
            round_num=round_num,
            sentiment=sentiment,
            score=score,
            volume=volume,
        )
        
        self._history.append(data_point)
        
        # Check for turning point
        if self._is_turning_point(data_point):
            self._turning_points.append(data_point)
    
    def get_momentum(self, lookback: int = 5) -> float:
        """Calculate sentiment momentum (recent trend)"""
        if len(self._history) < 2:
            return 0.0
        
        recent = list(self._history)[-lookback:]
        if len(recent) < 2:
            return 0.0
        
        # Calculate average rate of change
        changes = [
            recent[i].score - recent[i-1].score
            for i in range(1, len(recent))
        ]
        
        return sum(changes) / len(changes) if changes else 0.0
    
    def get_velocity(self, lookback: int = 3) -> float:
        """Calculate sentiment velocity (speed of change)"""
        momentum = self.get_momentum(lookback)
        return abs(momentum)  # Velocity is magnitude of momentum
    
    def get_turning_points(self) -> List[SentimentDataPoint]:
        """Get identified turning points"""
        return self._turning_points
    
    def get_current_sentiment(self) -> Optional[SentimentDataPoint]:
        """Get most recent sentiment"""
        return self._history[-1] if self._history else None
    
    def get_history(self) -> List[SentimentDataPoint]:
        """Get full sentiment history"""
        return list(self._history)
    
    def _is_turning_point(self, point: SentimentDataPoint) -> bool:
        """Check if a point is a sentiment turning point"""
        if len(self._history) < 3:
            return False
        
        # Check for sign change in recent trend
        recent = list(self._history)[-3:]
        scores = [p.score for p in recent]
        
        # Sign change = turning point
        if scores[0] > 0 and scores[2] < 0:
            return True
        if scores[0] < 0 and scores[2] > 0:
            return True
        
        return False
