"""
AsyncProfileGenerator - Batch concurrent profile generation

Generate 1000 agents in <5 minutes using asyncio.Semaphore.
Implements: US-038
"""

import asyncio
import time
from typing import List, Dict, Any, Optional

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent
from .strategic_profile_generator import StrategicProfileGenerator


class AsyncProfileGenerator:
    """
    Asynchronous batch profile generator.
    
    Uses asyncio.Semaphore to control concurrency and prevent
    overwhelming the LLM provider.
    
    Usage:
        generator = AsyncProfileGenerator(knowledge_store, llm)
        agents = await generator.generate_batch(entities, semaphore=30)
    """
    
    def __init__(
        self,
        knowledge_store: IKnowledgeStore,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.knowledge_store = knowledge_store
        self.llm_provider = llm_provider
        self.config = config or {}
        self.semaphore_limit = self.config.get("semaphore_limit", 30)
    
    async def generate_batch(
        self,
        entities: List[Dict[str, Any]],
        semaphore: int = 30,
    ) -> List[StrategicAgent]:
        """
        Generate profiles for multiple entities concurrently.
        
        Args:
            entities: List of entity dicts
            semaphore: Max concurrent LLM calls
            
        Returns:
            List of generated StrategicAgent objects
        """
        start_time = time.time()
        sem = asyncio.Semaphore(semaphore)
        generator = StrategicProfileGenerator(self.knowledge_store, self.llm_provider)
        
        async def _generate_with_semaphore(entity: Dict) -> Optional[StrategicAgent]:
            async with sem:
                try:
                    return await generator.generate(entity)
                except Exception:
                    return None
        
        agents = await asyncio.gather(
            *[_generate_with_semaphore(e) for e in entities],
            return_exceptions=False,
        )
        
        # Filter None results
        valid_agents = [a for a in agents if a is not None]
        
        elapsed = time.time() - start_time
        return valid_agents
