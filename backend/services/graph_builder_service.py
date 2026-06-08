"""
GraphBuilderService - Build knowledge graph from SeedDocuments

Uses IKnowledgeStore (injected) for graph operations.
Implements: US-022 (uses US-021 LocalKnowledgeStore)
"""

from typing import Dict, List, Any, Optional, Callable
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
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Build graph from seed documents.

        Args:
            seed_documents: List of parsed documents
            ontology: Optional ontology schema
            progress_callback: Optional callback invoked with
                ``{"type": "entity_emerged", "entity": {...}, "doc_id": "..."}``
                for each newly-stored entity (used to drive SSE ``entity_emerged``
                events for the real-time EntityDanmaku component).

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
                # should-tier: per-entity callback for live SSE emit
                if progress_callback is not None:
                    try:
                        ent_dict = entity.to_dict() if hasattr(entity, "to_dict") else {
                            "id": getattr(entity, "uuid", None),
                            "name": getattr(entity, "name", None),
                            "type": getattr(entity, "entity_type", None),
                        }
                        progress_callback({
                            "type": "entity_emerged",
                            "entity": {
                                "id": entity_id or ent_dict.get("id"),
                                "name": ent_dict.get("name"),
                                "label": ent_dict.get("name") or ent_dict.get("label"),
                                "type": ent_dict.get("type") or ent_dict.get("entity_type"),
                                "source_doc": doc.doc_id,
                            },
                            "doc_id": doc.doc_id,
                        })
                    except Exception:
                        # Callback failure must not break build pipeline
                        pass

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
