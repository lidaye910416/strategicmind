"""
LocalKnowledgeStore - IKnowledgeStore implementation using nano-graphRAG

This service combines nano-graphRAG storage with our custom EntityExtractor
LLM-based extraction layer.

The key difference from MiroFish: Zep has built-in extraction, we must
integrate our own EntityExtractor with nano-graphRAG.

Replaces: Zep Cloud knowledge store
"""

import os
import json
from typing import List, Dict, Any, Optional
from uuid import uuid4

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.graph_store import IGraphStore
from ..interfaces.llm_provider import ILLMProvider
from .entity_extractor import EntityExtractor


class LocalKnowledgeStore(IKnowledgeStore):
    """
    Local knowledge store implementation using nano-graphRAG.
    
    This combines:
        - nano-graphRAG for storage and retrieval
        - EntityExtractor for LLM-based entity extraction
    
    Attributes:
        graph_store: The underlying graph store (nano-graphRAG)
        entity_extractor: LLM-based entity extractor
        storage_path: Local file storage path
    """
    
    def __init__(
        self,
        graph_store: IGraphStore,
        llm_provider: ILLMProvider,
        storage_path: str = "./data/knowledge_graphs",
    ):
        """
        Initialize LocalKnowledgeStore.
        
        Args:
            graph_store: Underlying graph store for storage
            llm_provider: LLM provider for entity extraction
            storage_path: Path for local file storage
        """
        self.graph_store = graph_store
        self.entity_extractor = EntityExtractor(llm_provider)
        self.storage_path = storage_path
        
        # Ensure storage directory exists
        os.makedirs(storage_path, exist_ok=True)
    
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
        # Delegate to graph store search
        results = await self.graph_store.search(
            graph_id="default",
            query=query,
            top_k=top_k,
            filters=filters,
        )
        
        return results
    
    async def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a specific entity by ID.
        
        Args:
            entity_id: Unique entity identifier
            
        Returns:
            Entity data dict or None if not found
        """
        nodes = await self.graph_store.get_nodes(
            graph_id="default",
            node_ids=[entity_id],
            limit=1,
        )
        
        if nodes:
            return nodes[0]
        return None
    
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
        # Ensure entity has an ID
        entity_id = entity.get("uuid", str(uuid4()))
        entity["uuid"] = entity_id
        
        # Add metadata
        if metadata:
            entity["metadata"] = metadata
        
        # Store the entity
        entity_file = os.path.join(self.storage_path, f"{entity_id}.json")
        with open(entity_file, "w", encoding="utf-8") as f:
            json.dump(entity, f, ensure_ascii=False)
        
        return entity_id
    
    async def insert_relation(self, relation: Dict[str, Any]) -> str:
        """
        Insert a relation between entities.
        
        Args:
            relation: Relation data with 'source_id', 'target_id', 'relation_type'
            
        Returns:
            The ID of the inserted relation
        """
        relation_id = relation.get("uuid", str(uuid4()))
        relation["uuid"] = relation_id
        
        # Store the relation
        relation_file = os.path.join(self.storage_path, f"relation_{relation_id}.json")
        with open(relation_file, "w", encoding="utf-8") as f:
            json.dump(relation, f, ensure_ascii=False)
        
        return relation_id
    
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
        # Get edges from this entity
        edges = await self.graph_store.get_edges(
            graph_id="default",
            source_id=entity_id,
            limit=100,
        )
        
        # Filter by relation type if specified
        if relation_types:
            edges = [e for e in edges if e.get("relation_type") in relation_types]
        
        # Get target entity IDs
        target_ids = [e.get("target_id") or e.get("target") for e in edges]
        target_ids = [tid for tid in target_ids if tid]
        
        # Get neighbor entities
        neighbors = await self.graph_store.get_nodes(
            graph_id="default",
            node_ids=target_ids,
            limit=len(target_ids) if target_ids else 100,
        )
        
        return neighbors
    
    async def get_entity_context(
        self,
        entity_id: str,
        max_context: int = 5
    ) -> str:
        """
        Get full context for an entity as a text string.
        
        Args:
            entity_id: Entity identifier
            max_context: Maximum number of related entities to include
            
        Returns:
            Formatted context string with entity and neighbors
        """
        entity = await self.get_entity(entity_id)
        if not entity:
            return ""
        
        # Build context
        context = f"Entity: {entity.get('name', 'Unknown')}"
        if entity.get('entity_type'):
            context += f" ({entity.get('entity_type')})"
        if entity.get('summary'):
            context += f"\nSummary: {entity.get('summary')}"
        
        # Add neighbors
        neighbors = await self.get_neighbors(entity_id, depth=1)
        if neighbors and max_context > 0:
            context += f"\n\nRelated entities:"
            for i, neighbor in enumerate(neighbors[:max_context]):
                name = neighbor.get('name', 'Unknown')
                ntype = neighbor.get('entity_type', '')
                summary = neighbor.get('summary', '')[:100]
                context += f"\n  - {name}"
                if ntype:
                    context += f" ({ntype})"
                if summary:
                    context += f": {summary}..."
        
        return context
    
    async def insert_texts(
        self,
        texts: List[str],
        metadata: Optional[List[Dict[str, Any]]] = None,
        ontology: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Insert texts with automatic entity extraction.
        
        This is the main method for bulk text insertion with extraction.
        
        Args:
            texts: List of text strings to process
            metadata: Optional metadata for each text
            ontology: Optional ontology schema for guided extraction
            
        Returns:
            Summary of insertion results
        """
        all_entities = []
        all_relations = []
        
        # Extract entities and relations from each text
        for i, text in enumerate(texts):
            # Extract entities
            entities = await self.entity_extractor.extract_entities(text, ontology)
            
            # Extract relations
            relations = await self.entity_extractor.extract_relations(text, entities, ontology)
            
            # Insert entities
            for entity in entities:
                entity_id = await self.insert_entity(entity.to_dict())
                all_entities.append({"id": entity_id, "name": entity.name})
            
            # Insert relations
            for relation in relations:
                relation_id = await self.insert_relation({
                    "source_id": relation.source,
                    "target_id": relation.target,
                    "relation_type": relation.relation_type,
                    "attributes": relation.attributes,
                })
                all_relations.append({"id": relation_id, **relation.__dict__})
        
        return {
            "entities_count": len(all_entities),
            "relations_count": len(all_relations),
            "entities": all_entities,
            "relations": all_relations,
        }
