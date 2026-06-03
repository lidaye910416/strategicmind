"""
StrategicBackend - ISimulationBackend implementation for strategic scenarios

Strategic backend for strategic scenarios with:
    - Belief tracking
    - Information asymmetry
    - Strategic game theory

Implements: ISimulationBackend
"""

from typing import Dict, Any, Optional, List, Callable
import asyncio

from ..interfaces.simulation_backend import ISimulationBackend, SimulationStatus
from ..interfaces.llm_provider import ILLMProvider
from .belief_engine import BeliefEngine
from .simulation_loop import SimulationLoop
from .propagation_layer import PropagationLayer


class StrategicBackend(ISimulationBackend):
    """
    Strategic simulation backend implementing ISimulationBackend.
    
    This backend wraps the core strategic simulation components:
        - BeliefEngine: Tracks agent belief evolution
        - SimulationLoop: Executes simulation rounds
        - PropagationLayer: Manages information spread
    
    Usage:
        backend = StrategicBackend(llm_provider, config)
        await backend.run(simulation_config)
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize StrategicBackend.
        
        Args:
            llm_provider: LLM provider for agent decision-making
            config: Optional configuration dict
        """
        self.llm_provider = llm_provider
        self.config = config or {}
        
        # Core components
        self.belief_engine = BeliefEngine()
        self.propagation_layer = PropagationLayer()
        self.simulation_loop = SimulationLoop(
            belief_engine=self.belief_engine,
            propagation_layer=self.propagation_layer,
            llm_provider=llm_provider,
            config=self.config,
        )
        
        # State
        self._status = SimulationStatus.IDLE
        self._current_round = 0
        self._results: Dict[str, Any] = {}
        self._progress_callback: Optional[Callable] = None
    
    async def run(
        self,
        config: Dict[str, Any],
        progress_callback: Optional[Callable[[Dict], None]] = None
    ) -> Dict[str, Any]:
        """
        Start simulation execution.
        
        Args:
            config: Simulation configuration
            progress_callback: Optional callback for progress updates
            
        Returns:
            Simulation results
        """
        self._status = SimulationStatus.RUNNING
        self._progress_callback = progress_callback
        
        try:
            # Run simulation loop
            results = await self.simulation_loop.run(
                agents=config.get("agents", []),
                max_rounds=config.get("max_rounds", 10),
                simulated_hours=config.get("simulated_hours", 72),
                seed_documents=config.get("seed_documents", []),
            )
            
            self._results = results
            self._current_round = results.get("current_round", 0)
            self._status = SimulationStatus.COMPLETED
            
            return results
            
        except Exception as e:
            self._status = SimulationStatus.FAILED
            raise e
    
    async def pause(self) -> bool:
        """Pause running simulation"""
        if self._status == SimulationStatus.RUNNING:
            self._status = SimulationStatus.PAUSED
            return True
        return False
    
    async def resume(self) -> bool:
        """Resume paused simulation"""
        if self._status == SimulationStatus.PAUSED:
            self._status = SimulationStatus.RUNNING
            return True
        return False
    
    async def stop(self) -> bool:
        """Stop simulation"""
        self._status = SimulationStatus.STOPPED
        return True
    
    def get_status(self) -> SimulationStatus:
        """Get current status"""
        return self._status
    
    async def get_current_round(self) -> int:
        """Get current round number"""
        return self._current_round
    
    async def get_results(self) -> Dict[str, Any]:
        """Get simulation results"""
        return self._results
