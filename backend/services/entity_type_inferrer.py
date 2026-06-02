"""
EntityTypeInferrer - Auto-infer entity_types from documents

When user doesn't specify entity types, LLM analyzes the document
and suggests relevant entity types.

Implements: US-054
"""

from typing import List, Optional
from dataclasses import dataclass

from ..interfaces.llm_provider import ILLMProvider
from ..models.seed_document import SeedDocument


@dataclass
class EntityTypeInference:
    """Inferred entity types from a document"""
    entity_types: List[str]
    confidence: float
    reasoning: str


class EntityTypeInferrer:
    """
    Auto-infers relevant entity types from seed documents.
    """
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
    
    async def infer(self, document: SeedDocument) -> EntityTypeInference:
        """
        Infer entity types from a document.
        
        Args:
            document: SeedDocument to analyze
            
        Returns:
            EntityTypeInference with suggested types
        """
        prompt = f"""Analyze the following document and identify the most relevant entity types for strategic analysis.

Document title: {document.title}
Document type: {document.doc_type.value}
Content (first 2000 chars): {document.content[:2000]}

Return 5-10 entity types that would be most useful for strategic analysis of this document.

Output JSON:
{{
    "entity_types": ["Person", "Organization", ...],
    "confidence": 0.0-1.0,
    "reasoning": "why these types are relevant"
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response (simplified)
        import json
        import re
        
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
                return EntityTypeInference(
                    entity_types=data.get("entity_types", []),
                    confidence=data.get("confidence", 0.5),
                    reasoning=data.get("reasoning", ""),
                )
            except json.JSONDecodeError:
                pass
        
        # Fallback
        return EntityTypeInference(
            entity_types=["Person", "Organization", "Location", "Event", "Concept"],
            confidence=0.3,
            reasoning="Default entity types (LLM parse failed)",
        )
