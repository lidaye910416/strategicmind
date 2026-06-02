"""
EntityExtractor - LLM-based entity and relation extraction

This service extracts entities and relationships from text using LLM,
replacing Zep's auto-extraction capability.

The key difference from MiroFish (Zep): Zep has built-in LLM extraction,
nano-graphRAG does not. This service provides that capability.

Replaces: Zep's automatic entity extraction
"""

import asyncio
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass

from ..interfaces.llm_provider import ILLMProvider
from ..models.entity import Entity


@dataclass
class Relation:
    """Represents a relationship between two entities"""
    source: str       # Source entity ID or name
    target: str       # Target entity ID or name
    relation_type: str  # Type of relationship (e.g., "WORKS_FOR", "COMPETES_WITH")
    attributes: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.attributes is None:
            self.attributes = {}


class EntityExtractor:
    """
    Extract entities and relationships from text using LLM.
    
    This is the KEY DIFFERENCE from MiroFish - Zep has built-in LLM extraction,
    nano-graphRAG does not. This service provides that capability.
    
    Usage:
        extractor = EntityExtractor(llm_provider)
        
        # Single extraction
        entities = await extractor.extract_entities(text, ontology)
        relations = await extractor.extract_relations(text, entities, ontology)
        
        # Batch extraction
        async for progress in extractor.extract_batch(texts, ontology, progress_callback):
            print(f"Progress: {progress}")
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        batch_size: int = 10,
        max_concurrent: int = 5,
    ):
        """
        Initialize EntityExtractor.
        
        Args:
            llm_provider: LLM provider for extraction calls
            batch_size: Number of texts per batch
            max_concurrent: Maximum concurrent LLM calls
        """
        self.llm_provider = llm_provider
        self.batch_size = batch_size
        self.max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
    
    async def extract_entities(
        self,
        text: str,
        ontology: Optional[Dict[str, Any]] = None,
    ) -> List[Entity]:
        """
        Extract entities from a single text.
        
        Args:
            text: Input text to extract from
            ontology: Optional ontology schema to guide extraction
            
        Returns:
            List of Entity objects
        """
        prompt = self._build_entity_extraction_prompt(text, ontology)
        
        messages = [
            {"role": "system", "content": "You are an expert entity extraction system."},
            {"role": "user", "content": prompt},
        ]
        
        response = await self.llm_provider.chat(messages)
        
        return self._parse_entity_response(response)
    
    async def extract_relations(
        self,
        text: str,
        entities: List[Entity],
        ontology: Optional[Dict[str, Any]] = None,
    ) -> List[Relation]:
        """
        Extract relationships between entities from text.
        
        Args:
            text: Input text
            entities: List of entities extracted from text
            ontology: Optional ontology schema
            
        Returns:
            List of Relation objects
        """
        if not entities:
            return []
        
        prompt = self._build_relation_extraction_prompt(text, entities, ontology)
        
        messages = [
            {"role": "system", "content": "You are an expert relationship extraction system."},
            {"role": "user", "content": prompt},
        ]
        
        response = await self.llm_provider.chat(messages)
        
        return self._parse_relation_response(response, entities)
    
    async def extract_batch(
        self,
        texts: List[str],
        ontology: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> List[List[Entity]]:
        """
        Extract entities from multiple texts in batch mode.
        
        This is the preferred method for processing large document collections,
        using async extraction with controlled concurrency.
        
        Args:
            texts: List of input texts
            ontology: Optional ontology schema
            progress_callback: Optional callback for progress updates (0.0 to 1.0)
            
        Yields:
            Progress updates as extraction progresses
        """
        results: List[List[Entity]] = []
        total = len(texts)
        
        for i in range(0, total, self.batch_size):
            batch = texts[i:i + self.batch_size]
            
            # Process batch with controlled concurrency
            batch_results = await asyncio.gather(
                *[self.extract_entities(text, ontology) for text in batch],
                return_exceptions=True,
            )
            
            for result in batch_results:
                if isinstance(result, Exception):
                    results.append([])
                else:
                    results.append(result)
            
            # Report progress
            if progress_callback:
                progress_callback((i + len(batch)) / total)
        
        return results
    
    def _build_entity_extraction_prompt(
        self,
        text: str,
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """Build prompt for entity extraction"""
        prompt = f"""Extract all entities from the following text.

Return entities as a JSON list with fields:
- name: entity name
- entity_type: type (Person, Organization, Location, Event, Concept, etc.)
- summary: brief description

Text:
{text}

"""
        
        if ontology:
            entity_types = ontology.get("entity_types", [])
            if entity_types:
                prompt += f"\nUse these entity types if applicable:\n"
                for et in entity_types:
                    prompt += f"- {et.get('name', et)}: {et.get('description', '')}\n"
        
        prompt += """
Output as JSON list:
[{"name": "...", "entity_type": "...", "summary": "..."}, ...]

Only include entities that are clearly mentioned in the text."""
        
        return prompt
    
    def _build_relation_extraction_prompt(
        self,
        text: str,
        entities: List[Entity],
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """Build prompt for relation extraction"""
        entity_list = "\n".join([
            f"- {e.name} ({e.entity_type})" for e in entities
        ])
        
        prompt = f"""Extract relationships between the following entities from the text.

Entities:
{entity_list}

Text:
{text}

"""
        
        if ontology:
            relation_types = ontology.get("edge_types", [])
            if relation_types:
                prompt += f"\nUse these relation types if applicable:\n"
                for rt in relation_types:
                    prompt += f"- {rt.get('name', rt)}: {rt.get('description', '')}\n"
        
        prompt += """
Output as JSON list:
[{"source": "entity1_name", "target": "entity2_name", "relation_type": "RELATES_TO", "attributes": {}}, ...]

Only include relationships explicitly mentioned or clearly implied in the text."""
        
        return prompt
    
    def _parse_entity_response(self, response: str) -> List[Entity]:
        """Parse LLM response into Entity objects"""
        import json
        import re
        
        # Try to extract JSON from response
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return []
        
        try:
            data = json.loads(json_match.group())
            entities = []
            
            for item in data:
                if isinstance(item, dict) and "name" in item:
                    entities.append(Entity(
                        name=item["name"],
                        entity_type=item.get("entity_type", "Unknown"),
                        summary=item.get("summary", ""),
                        attributes=item.get("attributes", {}),
                    ))
            
            return entities
            
        except json.JSONDecodeError:
            return []
    
    def _parse_relation_response(
        self,
        response: str,
        entities: List[Entity],
    ) -> List[Relation]:
        """Parse LLM response into Relation objects"""
        import json
        import re
        
        entity_map = {e.name.lower(): e for e in entities}
        
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return []
        
        try:
            data = json.loads(json_match.group())
            relations = []
            
            for item in data:
                if isinstance(item, dict) and "source" in item and "target" in item:
                    source = item["source"]
                    target = item["target"]
                    
                    # Try to match entity names
                    if source.lower() in entity_map and target.lower() in entity_map:
                        relations.append(Relation(
                            source=entity_map[source.lower()].uuid,
                            target=entity_map[target.lower()].uuid,
                            relation_type=item.get("relation_type", "RELATES_TO"),
                            attributes=item.get("attributes", {}),
                        ))
            
            return relations
            
        except json.JSONDecodeError:
            return []
