"""
KnowledgeEnricher - Enrich entities with background information

Pluggable data source interface (default: mock, can swap to web search).

Implements: US-028
"""

from typing import Dict, List, Any, Optional
from abc import ABC, abstractmethod
import asyncio


class IKnowledgeSource(ABC):
    """Abstract knowledge source"""
    
    @abstractmethod
    async def query(self, query: str) -> List[str]:
        """Query for information"""
        ...


class MockKnowledgeSource(IKnowledgeSource):
    """Mock knowledge source returning predefined data"""
    
    def __init__(self):
        self.data = {}
    
    async def query(self, query: str) -> List[str]:
        return [f"Mock background info for: {query}"]


class KnowledgeEnricher:
    """
    Enriches entities and events with background information.
    
    Usage:
        enricher = KnowledgeEnricher(source=MockKnowledgeSource())
        context = await enricher.enrich_entity(entity)
    """
    
    def __init__(self, source: Optional[IKnowledgeSource] = None):
        self.source = source or MockKnowledgeSource()
    
    async def enrich_entity(self, entity: Dict[str, Any]) -> List[str]:
        """Enrich an entity with background context"""
        query = f"{entity.get('name', '')} {entity.get('entity_type', '')}"
        return await self.source.query(query)
    
    async def enrich_event(self, event: Dict[str, Any]) -> List[str]:
        """Enrich an event with related background"""
        query = f"event: {event.get('description', '')}"
        return await self.source.query(query)
    
    async def enrich_batch(
        self,
        items: List[Dict[str, Any]],
        item_type: str = "entity",
    ) -> Dict[str, List[str]]:
        """Enrich multiple items in batch"""
        results = {}
        for item in items:
            key = item.get("name") or item.get("id", "unknown")
            if item_type == "entity":
                results[key] = await self.enrich_entity(item)
            else:
                results[key] = await self.enrich_event(item)
        return results
