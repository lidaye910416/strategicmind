"""
StrategicSimulationRunner - OASIS-free entry point for strategic simulation

This is the main entry point for running strategic simulations,
integrating BeliefEngine, SimulationLoop, and PropagationLayer.
"""

from typing import Dict, List, Any, Optional, Callable
import asyncio

from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent
from .belief_engine import BeliefEngine
from .simulation_loop import SimulationLoop
from .propagation_layer import PropagationLayer


class StrategicSimulationRunner:
    """
    Main runner for strategic simulations.
    
    This replaces OASIS for strategic scenarios, providing:
        - Belief tracking
        - Strategic decision-making
        - Information propagation
        - State management
    
    Usage:
        runner = StrategicSimulationRunner(llm_provider)
        await runner.run(config)
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.llm_provider = llm_provider
        self.config = config or {}
        
        # Core components
        self.belief_engine = BeliefEngine()
        self.propagation_layer = PropagationLayer(config=self.config)
        self.simulation_loop = SimulationLoop(
            belief_engine=self.belief_engine,
            propagation_layer=self.propagation_layer,
            llm_provider=llm_provider,
            config=self.config,
        )
        
        # State
        self._agents: List[StrategicAgent] = []
        self._status = "idle"
        self._current_round = 0
    
    async def run(
        self,
        agents: List[StrategicAgent],
        max_rounds: int = 10,
        simulated_hours: int = 72,
        seed_documents: Optional[List[Dict[str, Any]]] = None,
        progress_callback: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        """Run the strategic simulation"""
        self._agents = agents
        self._status = "running"
        
        try:
            results = await self.simulation_loop.run(
                agents=agents,
                max_rounds=max_rounds,
                simulated_hours=simulated_hours,
                seed_documents=seed_documents,
                progress_callback=progress_callback,
            )
            
            self._status = "completed"
            return results
            
        except Exception as e:
            self._status = "failed"
            raise e
    
    def pause(self) -> bool:
        """Pause simulation"""
        if self._status == "running":
            self._status = "paused"
            return True
        return False
    
    def resume(self) -> bool:
        """Resume simulation"""
        if self._status == "paused":
            self._status = "running"
            return True
        return False
    
    def stop(self) -> bool:
        """Stop simulation"""
        self._status = "stopped"
        return True
    
    def get_status(self) -> str:
        """Get current status"""
        return self._status
    
    def get_current_round(self) -> int:
        """Get current round"""
        return self._current_round
