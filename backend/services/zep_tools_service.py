"""
ZepToolsService - Refactored to use IGraphStore interface

This service replaces direct Zep SDK calls with IGraphStore interface,
enabling testability and provider independence.

Replaces: Direct Zep SDK usage throughout the codebase
Implements: US-008
"""

import asyncio
from typing import Dict, Any, List, Optional

from ..interfaces.graph_store import IGraphStore


class ZepToolsService:
    """
    Service for Zep-like graph operations using IGraphStore.
    
    This refactor replaces direct Zep SDK calls with the abstract
    IGraphStore interface, enabling:
        - Easy testing with MockGraphStore
        - Provider switching (Zep/Local)
        - Reduced external dependencies
    
    Usage:
        # Production
        service = ZepToolsService(graph_store=LocalGraphStore())
        
        # Testing
        service = ZepToolsService(graph_store=MockGraphStore())
    """
    
    def __init__(self, graph_store: IGraphStore):
        """
        Initialize ZepToolsService with IGraphStore.
        
        Args:
            graph_store: IGraphStore implementation
        """
        self.graph_store = graph_store
    
    async def search(self, graph_id: str, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """
        Search the knowledge graph.
        
        Args:
            graph_id: Graph identifier
            query: Search query
            top_k: Number of results
            
        Returns:
            List of search results
        """
        return await self.graph_store.search(
            graph_id=graph_id,
            query=query,
            top_k=top_k,
        )
    
    async def get_entity(self, graph_id: str, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific entity by ID.
        
        Args:
            graph_id: Graph identifier
            entity_id: Entity ID
            
        Returns:
            Entity data or None
        """
        nodes = await self.graph_store.get_nodes(
            graph_id=graph_id,
            node_ids=[entity_id],
            limit=1,
        )
        return nodes[0] if nodes else None
    
    async def insert_text(self, graph_id: str, text: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Insert text into the graph.
        
        Args:
            graph_id: Graph identifier
            text: Text to insert
            metadata: Optional metadata
            
        Returns:
            Insertion results
        """
        return await self.graph_store.insert_texts(
            graph_id=graph_id,
            texts=[text],
            metadata=[metadata] if metadata else None,
        )
    
    async def get_neighbors(self, graph_id: str, entity_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get neighboring entities.
        
        Args:
            graph_id: Graph identifier
            entity_id: Source entity ID
            limit: Max neighbors
            
        Returns:
            List of neighbor nodes
        """
        edges = await self.graph_store.get_edges(
            graph_id=graph_id,
            source_id=entity_id,
            limit=limit,
        )
        
        # Get target node IDs
        target_ids = [e.get("target_id") or e.get("target") for e in edges]
        target_ids = [tid for tid in target_ids if tid]
        
        if not target_ids:
            return []
        
        return await self.graph_store.get_nodes(
            graph_id=graph_id,
            node_ids=target_ids,
            limit=len(target_ids),
        )
    
    async def create_graph(self, graph_id: str, config: Optional[Dict[str, Any]] = None) -> bool:
        """
        Create a new graph.
        
        Args:
            graph_id: Graph identifier
            config: Optional configuration
            
        Returns:
            True if created
        """
        return self.graph_store.create_graph(graph_id, config)
    
    async def delete_graph(self, graph_id: str) -> bool:
        """
        Delete a graph.
        
        Args:
            graph_id: Graph identifier
            
        Returns:
            True if deleted
        """
        return await self.graph_store.delete_graph(graph_id)
