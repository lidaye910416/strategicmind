"""
GraphBuilderService - Build knowledge graph from SeedDocuments

Uses IKnowledgeStore (injected) for graph operations.
Implements: US-022 (uses US-021 LocalKnowledgeStore)
"""

from typing import Dict, List, Any, Optional
import asyncio

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.seed_document import SeedDocument
from .entity_extractor import EntityExtractor


class GraphBuilderService:
    """
    Builds knowledge graph from seed documents.
    
    Workflow:
        1. Parse documents (SeedDocumentParser)
        2. Extract entities and relations (EntityExtractor)
        3. Store in knowledge graph (IKnowledgeStore)
        4. Build relationships
    """
    
    def __init__(
        self,
        entity_extractor: EntityExtractor,
        knowledge_store: IKnowledgeStore,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.entity_extractor = entity_extractor
        self.knowledge_store = knowledge_store
        self.config = config or {}
    
    async def build(
        self,
        seed_documents: List[SeedDocument],
        ontology: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Build graph from seed documents.
        
        Args:
            seed_documents: List of parsed documents
            ontology: Optional ontology schema
            
        Returns:
            Build statistics
        """
        all_entities = []
        all_relations = []
        
        for doc in seed_documents:
            content = doc.content
            
            # Extract entities
            entities = await self.entity_extractor.extract_entities(content, ontology)
            
            # Extract relations
            relations = await self.entity_extractor.extract_relations(
                content, entities, ontology
            )
            
            # Store entities
            for entity in entities:
                entity_id = await self.knowledge_store.insert_entity(
                    entity.to_dict(),
                    metadata={"source_doc": doc.doc_id, "doc_type": doc.doc_type.value}
                )
                entity.uuid = entity_id
                all_entities.append(entity)
            
            # Store relations
            for relation in relations:
                await self.knowledge_store.insert_relation({
                    "source_id": relation.source,
                    "target_id": relation.target,
                    "relation_type": relation.relation_type,
                    "attributes": relation.attributes,
                })
                all_relations.append(relation)
        
        return {
            "documents_processed": len(seed_documents),
            "entities_created": len(all_entities),
            "relations_created": len(all_relations),
        }
    
    async def search_context(
        self,
        query: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search the built graph for context"""
        return await self.knowledge_store.search(query, top_k=top_k)
