"""
IKnowledgeStore interface - Abstract interface for knowledge storage

This interface allows profile generation to query any knowledge store
(Zep, nano-GraphRAG, LightRAG) through the same interface.

Replaces: Zep SDK entity reader calls
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional


class IKnowledgeStore(ABC):
    """
    Abstract interface for knowledge storage and retrieval.
    
    This interface abstracts the underlying knowledge storage technology,
    allowing seamless switching between:
        - LocalKnowledgeStore: Using nano-graphRAG
        - ZepKnowledgeStore: Using Zep Cloud (future)
        - LightRAGStore: Using LightRAG (future)
    
    Methods:
        search: Semantic search for entities and context
        get_entity: Retrieve a specific entity by ID
        insert_entity: Insert a new entity
        get_neighbors: Get neighboring entities (graph traversal)
        get_entity_context: Get full context for an entity
    """
    
    @abstractmethod
    async def search(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Semantic search for entities and context.
        
        Args:
            query: Search query string
            top_k: Number of results to return
            filters: Optional metadata filters
            
        Returns:
            List of search results with scores and metadata
        """
        ...
    
    @abstractmethod
    async def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a specific entity by ID.
        
        Args:
            entity_id: Unique entity identifier
            
        Returns:
            Entity data dict or None if not found
        """
        ...
    
    @abstractmethod
    async def insert_entity(
        self,
        entity: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Insert a new entity into the knowledge store.
        
        Args:
            entity: Entity data with at least 'name' and 'entity_type'
            metadata: Optional metadata for the entity
            
        Returns:
            The ID of the inserted entity
        """
        ...
    
    @abstractmethod
    async def insert_relation(
        self,
        relation: Dict[str, Any]
    ) -> str:
        """
        Insert a relation between entities.
        
        Args:
            relation: Relation data with 'source_id', 'target_id', 'relation_type'
            
        Returns:
            The ID of the inserted relation
        """
        ...
    
    @abstractmethod
    async def get_neighbors(
        self,
        entity_id: str,
        relation_types: Optional[List[str]] = None,
        depth: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Get neighboring entities through graph traversal.
        
        Args:
            entity_id: Starting entity ID
            relation_types: Filter by specific relation types (optional)
            depth: Traversal depth (default 1 = direct neighbors)
            
        Returns:
            List of neighboring entity data
        """
        ...
    
    @abstractmethod
    async def get_entity_context(
        self,
        entity_id: str,
        max_context: int = 5
    ) -> str:
        """
        Get full context for an entity as a text string.
        
        Useful for building prompts with entity context.
        
        Args:
            entity_id: Entity identifier
            max_context: Maximum number of related entities to include
            
        Returns:
            Formatted context string with entity and neighbors
        """
        ...
