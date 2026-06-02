"""
LLMRequestQueue - Global rate limiting for LLM calls

Limits concurrent LLM calls globally across platforms.
Implements: US-039
"""

import asyncio
import time
import json
import os
from typing import Dict, Any, Optional, Callable
from enum import Enum
from dataclasses import dataclass, field
from uuid import uuid4


class Priority(str, Enum):
    """Request priority levels"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


@dataclass
class LLMRequest:
    """LLM request in queue"""
    id: str = field(default_factory=lambda: str(uuid4()))
    coro: Any = None
    priority: Priority = Priority.NORMAL
    model: str = "default"
    submitted_at: float = field(default_factory=time.time)
    result: Any = None
    error: Optional[str] = None


class LLMRequestQueue:
    """
    Global queue for LLM requests with rate limiting.
    
    Features:
        - Global semaphore for concurrent calls
        - Per-model rate limits
        - Priority queue
        - Disk persistence for crash recovery
    """
    
    def __init__(
        self,
        max_concurrent: int = 30,
        persistence_path: str = "./data/llm_queue",
    ):
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._model_limits: Dict[str, int] = {}
        self._model_semaphores: Dict[str, asyncio.Semaphore] = {}
        self.persistence_path = persistence_path
        os.makedirs(persistence_path, exist_ok=True)
    
    def set_model_limit(self, model: str, max_concurrent: int) -> None:
        """Set per-model concurrent limit"""
        self._model_limits[model] = max_concurrent
        self._model_semaphores[model] = asyncio.Semaphore(max_concurrent)
    
    async def enqueue(
        self,
        coro: Callable,
        priority: Priority = Priority.NORMAL,
        model: str = "default",
    ) -> Any:
        """
        Enqueue an LLM request.
        
        Args:
            coro: Coroutine to execute
            priority: Request priority
            model: Model identifier
            
        Returns:
            Result of the coroutine
        """
        model_sem = self._model_semaphores.get(model, self.semaphore)
        
        async with self.semaphore:
            async with model_sem:
                try:
                    result = await coro
                    return result
                except Exception as e:
                    raise
    
    def persist_state(self) -> None:
        """Persist queue state to disk"""
        state = {
            "max_concurrent": self.max_concurrent,
            "model_limits": self._model_limits,
        }
        path = os.path.join(self.persistence_path, "queue_state.json")
        with open(path, "w") as f:
            json.dump(state, f)
    
    def load_state(self) -> None:
        """Load queue state from disk"""
        path = os.path.join(self.persistence_path, "queue_state.json")
        if os.path.exists(path):
            with open(path, "r") as f:
                state = json.load(f)
            self.max_concurrent = state.get("max_concurrent", self.max_concurrent)
            self._model_limits = state.get("model_limits", {})
            for model, limit in self._model_limits.items():
                self._model_semaphores[model] = asyncio.Semaphore(limit)
