"""
ISimulationBackend interface - Abstract interface for simulation backends

This interface allows swapping between different simulation implementations:
    - StrategicSimulationRunner: For strategic planning scenarios
    - (SocialMediaBackend, future): For social media simulation

The strategic backend is used for strategic scenarios where:
    - Information asymmetry exists
    - Hidden actions are possible
    - Belief tracking is required
    - Strategic博弈 (game theory) is the focus
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from enum import Enum


class SimulationStatus(str, Enum):
    """Simulation execution status"""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"


class ISimulationBackend(ABC):
    """
    Abstract interface for simulation backends.
    
    Implementations:
        - StrategicBackend: Strategic planning simulation
        - OasisBackend: Social media simulation (optional)
    
    Methods:
        run: Start simulation execution
        pause: Pause running simulation
        resume: Resume paused simulation
        stop: Stop and terminate simulation
        get_status: Get current simulation status
    """
    
    @abstractmethod
    async def run(
        self,
        config: Dict[str, Any],
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Start simulation execution.
        
        Args:
            config: Simulation configuration including:
                - agents: List of agent configurations
                - max_rounds: Maximum simulation rounds
                - simulated_hours: Hours to simulate
                - seed_documents: Initial documents
            progress_callback: Optional callback for progress updates
            
        Returns:
            Simulation results including:
                - final_state: Final simulation state
                - round_summaries: Summary of each round
                - agent_histories: Agent action histories
        """
        ...
    
    @abstractmethod
    async def pause(self) -> bool:
        """
        Pause a running simulation.
        
        Returns:
            True if paused successfully, False otherwise
        """
        ...
    
    @abstractmethod
    async def resume(self) -> bool:
        """
        Resume a paused simulation.
        
        Returns:
            True if resumed successfully, False otherwise
        """
        ...
    
    @abstractmethod
    async def stop(self) -> bool:
        """
        Stop and terminate the simulation.
        
        Returns:
            True if stopped successfully, False otherwise
        """
        ...
    
    @abstractmethod
    def get_status(self) -> SimulationStatus:
        """
        Get current simulation status.
        
        Returns:
            Current SimulationStatus enum value
        """
        ...
    
    @abstractmethod
    async def get_current_round(self) -> int:
        """
        Get the current round number.
        
        Returns:
            Current round number (1-indexed), or 0 if not started
        """
        ...
    
    @abstractmethod
    async def get_results(self) -> Dict[str, Any]:
        """
        Get simulation results so far.
        
        Returns:
            Partial or complete simulation results
        """
        ...
