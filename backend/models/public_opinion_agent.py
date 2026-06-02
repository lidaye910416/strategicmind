"""
PublicOpinionAgent - StrategicAgent extended with social media behavior

Combines strategic reasoning with public opinion dynamics.
Implements: US-089
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum
from .strategic_agent import StrategicAgent, AgentType


class SentimentType(str, Enum):
    """Sentiment categories"""
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"


@dataclass
class PublicOpinionAgent(StrategicAgent):
    """
    StrategicAgent extended with public opinion capabilities.
    
    Combines strategic reasoning with social media behavior modeling.
    """
    
    # Public opinion attributes
    sentiment: SentimentType = SentimentType.NEUTRAL
    influence_score: float = 0.5  # Social influence
    social_reach: int = 0  # Number of followers
    platform_preference: str = "twitter"  # twitter or reddit
    
    # Social-specific actions
    social_actions: List[str] = field(default_factory=lambda: [
        "CREATE_POST", "LIKE_POST", "REPOST", "COMMENT",
    ])
    
    def __post_init__(self):
        # Set agent type if not provided
        if self.agent_type not in [
            AgentType.MEDIA, AgentType.ADVOCACY
        ]:
            self.agent_type = AgentType.MEDIA
        super().__post_init__()
    
    def to_dict(self) -> Dict[str, Any]:
        data = super().to_dict()
        data.update({
            "sentiment": self.sentiment.value,
            "influence_score": self.influence_score,
            "social_reach": self.social_reach,
            "platform_preference": self.platform_preference,
            "social_actions": self.social_actions,
        })
        return data
