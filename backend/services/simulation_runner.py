"""
SimulationRunner - Refactored as Facade

Reduces SimulationRunner from 1768 lines to ~200 lines by delegating
work to ISimulationBackend, SimulationStateManager, and SimulationIPC.

Implements: US-016
"""

from typing import Dict, Any, Optional, List, Callable
import asyncio

from ..interfaces.simulation_backend import ISimulationBackend, SimulationStatus
from .simulation_state_manager import SimulationStateManager, RunState
from .simulation_ipc import SimulationIPC, CommandType


class SimulationRunner:
    """
    Facade for simulation execution.
    
    Delegates work to:
        - ISimulationBackend: actual simulation logic
        - SimulationStateManager: state persistence
        - SimulationIPC: event bus for control
    
    This reduces complexity by separating concerns.
    """
    
    def __init__(
        self,
        backend: ISimulationBackend,
        state_manager: Optional[SimulationStateManager] = None,
        ipc: Optional[SimulationIPC] = None,
    ):
        self.backend = backend
        self.state_manager = state_manager or SimulationStateManager()
        self.ipc = ipc or SimulationIPC()
    
    async def start(
        self,
        run_id: str,
        config: Dict[str, Any],
        progress_callback: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        """Start a simulation run"""
        self.state_manager.create(
            run_id=run_id,
            total_rounds=config.get("max_rounds", 10),
            agents_count=len(config.get("agents", [])),
        )
        self.state_manager.update(run_id, state=RunState.RUNNING)
        
        await self.ipc.publish("event", {"run_id": run_id, "event": "started"})
        
        try:
            results = await self.backend.run(config, progress_callback)
            self.state_manager.complete(run_id)
            self.state_manager.snapshot(run_id)
            await self.ipc.publish("event", {"run_id": run_id, "event": "completed"})
            return results
        except Exception as e:
            self.state_manager.fail(run_id, str(e))
            await self.ipc.publish("event", {"run_id": run_id, "event": "failed", "error": str(e)})
            raise
    
    async def pause(self, run_id: str) -> bool:
        """Pause a running simulation"""
        success = await self.backend.pause()
        if success:
            self.state_manager.update(run_id, state=RunState.PAUSED)
            await self.ipc.publish("event", {"run_id": run_id, "event": "paused"})
        return success
    
    async def resume(self, run_id: str) -> bool:
        """Resume a paused simulation"""
        success = await self.backend.resume()
        if success:
            self.state_manager.update(run_id, state=RunState.RUNNING)
            await self.ipc.publish("event", {"run_id": run_id, "event": "resumed"})
        return success
    
    async def stop(self, run_id: str) -> bool:
        """Stop a running simulation"""
        success = await self.backend.stop()
        self.state_manager.update(run_id, state=RunState.STOPPED)
        await self.ipc.publish("event", {"run_id": run_id, "event": "stopped"})
        return success
    
    def get_status(self, run_id: str) -> SimulationStatus:
        """Get simulation status"""
        state = self.state_manager.get(run_id)
        if not state:
            return SimulationStatus.IDLE
        
        status_map = {
            RunState.PENDING: SimulationStatus.IDLE,
            RunState.RUNNING: SimulationStatus.RUNNING,
            RunState.PAUSED: SimulationStatus.PAUSED,
            RunState.COMPLETED: SimulationStatus.COMPLETED,
            RunState.FAILED: SimulationStatus.FAILED,
        }
        return status_map.get(state.state, SimulationStatus.IDLE)
    
    async def get_current_round(self, run_id: str) -> int:
        """Get current round number"""
        return await self.backend.get_current_round()
    
    def get_state(self, run_id: str):
        """Get run state"""
        return self.state_manager.get(run_id)
