"""
SimulationStateManager - Manages simulation state persistence

This service replaces class variables in SimulationRunner with
proper encapsulation and state persistence.

Replaces: _run_states and _processes class variables
"""

import json
import os
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum


class RunState(str, Enum):
    """State of a simulation run"""
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class SimulationRunState:
    """State snapshot of a simulation run"""
    run_id: str
    state: RunState = RunState.PENDING
    current_round: int = 0
    total_rounds: int = 0
    agents_count: int = 0
    progress: float = 0.0  # 0.0 to 1.0
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SimulationRunState':
        return cls(**data)


class SimulationStateManager:
    """
    Manages simulation run states with persistence.
    
    This replaces the class variables in SimulationRunner with
    a proper state management service.
    
    Usage:
        manager = SimulationStateManager()
        manager.create("run_123")
        manager.update("run_123", state=RunState.RUNNING, current_round=1)
        state = manager.get("run_123")
        manager.snapshot("run_123")  # Persist to disk
    """
    
    def __init__(self, storage_path: str = "./data/simulation_states"):
        """
        Initialize state manager.
        
        Args:
            storage_path: Directory for state persistence
        """
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)
        
        # In-memory cache
        self._states: Dict[str, SimulationRunState] = {}
    
    def create(
        self,
        run_id: str,
        total_rounds: int = 10,
        agents_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SimulationRunState:
        """
        Create a new simulation run state.
        
        Args:
            run_id: Unique run identifier
            total_rounds: Total number of simulation rounds
            agents_count: Number of agents in simulation
            metadata: Optional initial metadata
            
        Returns:
            Created SimulationRunState
        """
        now = datetime.now().isoformat()
        state = SimulationRunState(
            run_id=run_id,
            state=RunState.PENDING,
            total_rounds=total_rounds,
            agents_count=agents_count,
            started_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
        
        self._states[run_id] = state
        return state
    
    def get(self, run_id: str) -> Optional[SimulationRunState]:
        """Get run state by ID"""
        return self._states.get(run_id)
    
    def update(
        self,
        run_id: str,
        state: Optional[RunState] = None,
        current_round: Optional[int] = None,
        progress: Optional[float] = None,
        error_message: Optional[str] = None,
        **metadata
    ) -> Optional[SimulationRunState]:
        """
        Update run state.
        
        Args:
            run_id: Run identifier
            state: New state (optional)
            current_round: Current round number
            progress: Progress value (0.0 to 1.0)
            error_message: Error message if failed
            **metadata: Additional metadata to update
            
        Returns:
            Updated state or None if not found
        """
        run_state = self._states.get(run_id)
        if not run_state:
            return None
        
        if state is not None:
            run_state.state = state
        if current_round is not None:
            run_state.current_round = current_round
            if run_state.total_rounds > 0:
                run_state.progress = current_round / run_state.total_rounds
        if progress is not None:
            run_state.progress = progress
        if error_message is not None:
            run_state.error_message = error_message
        
        # Update metadata
        run_state.metadata.update(metadata)
        
        # Update timestamp
        run_state.updated_at = datetime.now().isoformat()
        
        return run_state
    
    def complete(self, run_id: str) -> Optional[SimulationRunState]:
        """Mark run as completed"""
        return self.update(
            run_id,
            state=RunState.COMPLETED,
            progress=1.0,
            completed_at=datetime.now().isoformat(),
        )
    
    def fail(self, run_id: str, error: str) -> Optional[SimulationRunState]:
        """Mark run as failed"""
        return self.update(
            run_id,
            state=RunState.FAILED,
            error_message=error,
            completed_at=datetime.now().isoformat(),
        )
    
    def list_all(self) -> List[SimulationRunState]:
        """List all run states"""
        return list(self._states.values())
    
    def list_by_state(self, state: RunState) -> List[SimulationRunState]:
        """List runs by state"""
        return [s for s in self._states.values() if s.state == state]
    
    def snapshot(self, run_id: str) -> bool:
        """
        Persist run state to disk.
        
        Args:
            run_id: Run identifier
            
        Returns:
            True if persisted successfully
        """
        run_state = self._states.get(run_id)
        if not run_state:
            return False
        
        path = os.path.join(self.storage_path, f"{run_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(run_state.to_dict(), f, ensure_ascii=False)
        
        return True
    
    def load(self, run_id: str) -> Optional[SimulationRunState]:
        """
        Load run state from disk.
        
        Args:
            run_id: Run identifier
            
        Returns:
            Loaded state or None if not found
        """
        path = os.path.join(self.storage_path, f"{run_id}.json")
        if not os.path.exists(path):
            return None
        
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        state = SimulationRunState.from_dict(data)
        self._states[run_id] = state
        return state
    
    def delete(self, run_id: str) -> bool:
        """Delete run state"""
        if run_id in self._states:
            del self._states[run_id]
        
        # Also delete from disk
        path = os.path.join(self.storage_path, f"{run_id}.json")
        if os.path.exists(path):
            os.remove(path)
            return True
        
        return False
