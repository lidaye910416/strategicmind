"""
BusinessMetricsTracker - Track metrics changes from agent behavior

Following MiroFish pattern: metrics emerge from actions, not formulas.
LLM determines metric changes based on action context.

Implements: US-096
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
import asyncio

from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_action_result import StrategicActionResult


@dataclass
class BusinessMetrics:
    """Business metric snapshot"""
    revenue_outlook: float = 0.0  # -1.0 to 1.0
    profit_margin_outlook: float = 0.0
    market_sentiment: float = 0.0
    competitive_position: float = 0.0
    timestamp: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "revenue_outlook": self.revenue_outlook,
            "profit_margin_outlook": self.profit_margin_outlook,
            "market_sentiment": self.market_sentiment,
            "competitive_position": self.competitive_position,
            "timestamp": self.timestamp,
        }


class BusinessMetricsTracker:
    """
    Tracks business metrics that emerge from agent behavior.
    
    Example flow:
        executive announces cost cut → market reacts → metrics change
    """
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
        self._history: List[BusinessMetrics] = []
        self._current = BusinessMetrics()
    
    async def update(
        self,
        action_results: List[StrategicActionResult],
        market_context: Optional[Dict[str, Any]] = None,
    ) -> BusinessMetrics:
        """
        Update metrics based on action results.
        
        Args:
            action_results: Results from agent actions
            market_context: Optional market context
            
        Returns:
            Updated BusinessMetrics
        """
        # Build prompt for LLM
        actions_summary = [
            {
                "type": r.action.action_type.value,
                "description": r.action.public_description[:200],
            }
            for r in action_results
        ]
        
        prompt = f"""Based on the following strategic actions, determine how business metrics would change.

Actions taken:
{actions_summary}

Market context: {market_context or 'No additional context'}

Output JSON with metric changes (each is -1.0 to 1.0, where -1 is very negative, +1 is very positive):
{{
    "revenue_outlook": 0.0,
    "profit_margin_outlook": 0.0,
    "market_sentiment": 0.0,
    "competitive_position": 0.0
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response
        import json
        import re
        
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
                new_metrics = BusinessMetrics(
                    revenue_outlook=self._current.revenue_outlook + data.get("revenue_outlook", 0),
                    profit_margin_outlook=self._current.profit_margin_outlook + data.get("profit_margin_outlook", 0),
                    market_sentiment=self._current.market_sentiment + data.get("market_sentiment", 0),
                    competitive_position=self._current.competitive_position + data.get("competitive_position", 0),
                )
                # Clamp values
                new_metrics.revenue_outlook = max(-1.0, min(1.0, new_metrics.revenue_outlook))
                new_metrics.profit_margin_outlook = max(-1.0, min(1.0, new_metrics.profit_margin_outlook))
                new_metrics.market_sentiment = max(-1.0, min(1.0, new_metrics.market_sentiment))
                new_metrics.competitive_position = max(-1.0, min(1.0, new_metrics.competitive_position))
                
                self._current = new_metrics
                self._history.append(new_metrics)
            except json.JSONDecodeError:
                pass
        
        return self._current
    
    def get_current(self) -> BusinessMetrics:
        """Get current metrics"""
        return self._current
    
    def get_history(self) -> List[BusinessMetrics]:
        """Get metric history"""
        return self._history
