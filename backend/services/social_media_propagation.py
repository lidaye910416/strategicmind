"""
SocialMediaPropagationLayer - Twitter/Reddit information spread

Social-media-style propagation for StrategicMind.
Models viral spread factors: followers, sentiment, timing.

Implements: US-090
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import random

from ..models.public_opinion_agent import PublicOpinionAgent, SentimentType


@dataclass
class SocialMediaEvent:
    """A social media propagation event"""
    post_id: str
    platform: str
    author_id: str
    content: str
    sentiment: SentimentType
    initial_reach: int
    final_reach: int
    viral_coefficient: float
    time_to_peak: int  # in simulated hours
    paid_amplification: bool = False


class SocialMediaPropagationLayer:
    """
    Models information spread on Twitter and Reddit.
    
    Features:
        - Tweet/repost chains
        - Reddit post/comment threads
        - Viral spread factors
        - Organic vs paid amplification
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.viral_threshold = self.config.get("viral_threshold", 1.5)
    
    def propagate_tweet(
        self,
        author: PublicOpinionAgent,
        content: str,
        sentiment: SentimentType,
        paid_boost: float = 1.0,
    ) -> SocialMediaEvent:
        """
        Simulate tweet propagation.
        
        Args:
            author: Tweet author
            content: Tweet content
            sentiment: Post sentiment
            paid_boost: Paid amplification factor (1.0 = none)
            
        Returns:
            SocialMediaEvent with propagation details
        """
        # Calculate initial reach based on follower count
        initial_reach = author.social_reach
        
        # Viral coefficient depends on sentiment, content quality, paid boost
        sentiment_factor = {
            SentimentType.POSITIVE: 1.3,
            SentimentType.NEGATIVE: 1.5,  # Negative content spreads more
            SentimentType.NEUTRAL: 1.0,
            SentimentType.MIXED: 1.1,
        }.get(sentiment, 1.0)
        
        viral_coeff = (
            author.influence_score
            * sentiment_factor
            * paid_boost
            * random.uniform(0.8, 1.2)
        )
        
        # Final reach with viral spread
        final_reach = int(initial_reach * viral_coeff)
        
        # Time to peak based on content type
        time_to_peak = random.randint(1, 12)  # 1-12 hours
        
        return SocialMediaEvent(
            post_id=f"tweet_{hash(content) % 100000}",
            platform="twitter",
            author_id=author.agent_id,
            content=content,
            sentiment=sentiment,
            initial_reach=initial_reach,
            final_reach=final_reach,
            viral_coefficient=viral_coeff,
            time_to_peak=time_to_peak,
            paid_amplification=paid_boost > 1.0,
        )
    
    def propagate_reddit_post(
        self,
        author: PublicOpinionAgent,
        content: str,
        subreddit: str,
    ) -> SocialMediaEvent:
        """Simulate Reddit post propagation"""
        # Reddit has different dynamics - less viral, more discussion
        initial_reach = author.social_reach // 10  # Smaller initial reach
        
        viral_coeff = author.influence_score * random.uniform(0.5, 1.0)
        final_reach = int(initial_reach * viral_coeff)
        
        return SocialMediaEvent(
            post_id=f"reddit_{hash(content + subreddit) % 100000}",
            platform="reddit",
            author_id=author.agent_id,
            content=content,
            sentiment=SentimentType.NEUTRAL,
            initial_reach=initial_reach,
            final_reach=final_reach,
            viral_coefficient=viral_coeff,
            time_to_peak=random.randint(2, 24),
        )
    
    def model_comment_thread(
        self,
        original_post: SocialMediaEvent,
        num_comments: int,
    ) -> List[Dict[str, Any]]:
        """Model a comment thread on a post"""
        comments = []
        for i in range(num_comments):
            comments.append({
                "comment_id": f"comment_{i}",
                "post_id": original_post.post_id,
                "depth": i // 5,
                "engagement": random.randint(0, original_post.final_reach // num_comments + 1),
            })
        return comments
