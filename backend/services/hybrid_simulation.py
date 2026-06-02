"""
HybridSimulation - Combine strategic + public opinion agents

Supports modes: strategic_only, opinion_only, hybrid.
Implements: US-093
"""

from typing import Dict, List, Any, Optional
from enum import Enum
import asyncio

from ..models.strategic_agent import StrategicAgent
from ..models.public_opinion_agent import PublicOpinionAgent
from ..interfaces.llm_provider import ILLMProvider
from .simulation_loop import SimulationLoop
from .belief_engine import BeliefEngine
from .propagation_layer import PropagationLayer
from .social_media_propagation import SocialMediaPropagationLayer
from .sentiment_tracker import SentimentTracker


class SimulationMode(str, Enum):
    """Hybrid simulation modes"""
    STRATEGIC_ONLY = "strategic_only"
    OPINION_ONLY = "opinion_only"
    HYBRID = "hybrid"


class HybridSimulationEngine:
    """
    Engine that runs hybrid simulations with both strategic and
    public opinion agents.
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.llm_provider = llm_provider
        self.config = config or {}
        
        # Components
        self.belief_engine = BeliefEngine()
        self.strategic_propagation = PropagationLayer()
        self.social_propagation = SocialMediaPropagationLayer()
        self.sentiment_tracker = SentimentTracker()
    
    async def run(
        self,
        strategic_agents: List[StrategicAgent],
        opinion_agents: List[PublicOpinionAgent],
        mode: SimulationMode = SimulationMode.HYBRID,
        max_rounds: int = 10,
    ) -> Dict[str, Any]:
        """
        Run hybrid simulation.
        
        Args:
            strategic_agents: Strategic actors
            opinion_agents: Public opinion agents
            mode: Simulation mode
            max_rounds: Maximum rounds
            
        Returns:
            Combined simulation results
        """
        results = {
            "mode": mode.value,
            "rounds": [],
            "strategic_results": {},
            "opinion_results": {},
        }
        
        all_agents = []
        
        if mode in (SimulationMode.STRATEGIC_ONLY, SimulationMode.HYBRID):
            all_agents.extend(strategic_agents)
        
        if mode in (SimulationMode.OPINION_ONLY, SimulationMode.HYBRID):
            all_agents.extend(opinion_agents)
        
        # Run simulation loop
        sim_loop = SimulationLoop(
            belief_engine=self.belief_engine,
            propagation_layer=self.strategic_propagation,
            llm_provider=self.llm_provider,
            config=self.config,
        )
        
        sim_results = await sim_loop.run(all_agents, max_rounds=max_rounds)
        results["strategic_results"] = sim_results
        
        # In hybrid mode, also run opinion propagation
        if mode == SimulationMode.HYBRID:
            # Strategic actions trigger opinion responses
            for round_data in sim_results.get("round_results", []):
                round_num = round_data.get("round_num", 0)
                
                # Calculate aggregate sentiment
                avg_sentiment = self._calculate_aggregate_sentiment(opinion_agents)
                self.sentiment_tracker.record(
                    score=avg_sentiment,
                    round_num=round_num,
                )
            
            results["opinion_results"] = {
                "sentiment_history": [
                    p.to_dict() for p in self.sentiment_tracker.get_history()
                ],
                "momentum": self.sentiment_tracker.get_momentum(),
            }
        
        return results
    
    def _calculate_aggregate_sentiment(
        self,
        opinion_agents: List[PublicOpinionAgent],
    ) -> float:
        """Calculate aggregate sentiment from opinion agents"""
        if not opinion_agents:
            return 0.0
        
        sentiment_values = {
            "positive": 1.0,
            "negative": -1.0,
            "neutral": 0.0,
            "mixed": 0.0,
        }
        
        total = sum(
            sentiment_values.get(a.sentiment.value, 0) * a.influence_score
            for a in opinion_agents
        )
        weight_sum = sum(a.influence_score for a in opinion_agents)
        
        return total / weight_sum if weight_sum else 0.0
