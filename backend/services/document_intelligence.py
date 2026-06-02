"""
DocumentIntelligence - Extract structured information from documents

Implements US-027
"""

from typing import Dict, List, Any, Optional
from ..interfaces.llm_provider import ILLMProvider
from ..models.seed_document import SeedDocument, DocumentType, Fact, EntityMention, TimelineEvent, Claim


class DocumentIntelligence:
    """
    Extracts facts, entities, timeline, and claims from documents.
    
    Usage:
        intelligence = DocumentIntelligence(llm_provider)
        seed_doc = await intelligence.extract(document)
        citation_graph = await intelligence.build_citation_graph(documents)
    """
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
    
    async def extract(self, document: Dict[str, Any]) -> SeedDocument:
        """
        Extract structured information from a document.
        
        Args:
            document: Dict with 'title', 'content', 'doc_type', etc.
            
        Returns:
            SeedDocument with extracted_facts, key_entities, timeline, claims
        """
        # Detect document type
        doc_type = self._detect_doc_type(document)
        
        # Extract using LLM
        prompt = self._build_extraction_prompt(document)
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response (simplified)
        seed_doc = SeedDocument(
            doc_id=document.get("id", ""),
            title=document.get("title", ""),
            content=document.get("content", ""),
            doc_type=doc_type,
        )
        
        # TODO: Parse actual entities, facts, timeline, claims from response
        # For now, add placeholder structure
        seed_doc.metadata["raw_response"] = response
        
        return seed_doc
    
    def _detect_doc_type(self, document: Dict[str, Any]) -> DocumentType:
        """Detect the type of document"""
        content = document.get("content", "").lower()
        title = document.get("title", "").lower()
        
        text = f"{title} {content}"
        
        if any(k in text for k in ["announcement", "press release", "official"]):
            return DocumentType.NEWS
        elif any(k in text for k in ["annual report", "quarterly", "financial"]):
            return DocumentType.FINANCIAL
        elif any(k in text for k in ["regulation", "rule", "policy", "sec"]):
            return DocumentType.REGULATORY
        elif any(k in text for k in ["research", "study", "paper"]):
            return DocumentType.ACADEMIC
        elif any(k in text for k in ["tweet", "post", "social"]):
            return DocumentType.SOCIAL_MEDIA
        
        return DocumentType.UNKNOWN
    
    def _build_extraction_prompt(self, document: Dict[str, Any]) -> str:
        """Build prompt for extraction"""
        return f"""Extract structured information from the following document.

Title: {document.get('title', '')}
Content: {document.get('content', '')[:5000]}

Output JSON with:
{{
    "key_entities": [
        {{"text": "entity name", "entity_type": "Person/Organization/etc", "start_pos": 0, "end_pos": 10}}
    ],
    "extracted_facts": [
        {{"id": "fact1", "statement": "fact description", "subject": "...", "predicate": "...", "object": "..."}}
    ],
    "timeline": [
        {{"id": "event1", "event_type": "announcement/acquisition/etc", "description": "...", "participants": [...]}}
    ],
    "claims": [
        {{"id": "claim1", "claim_type": "factual/opinion/prediction", "content": "...", "claimant": "..."}}
    ]
}}"""
    
    async def build_citation_graph(
        self,
        documents: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Build document relationship DAG.
        
        Args:
            documents: List of document dicts
            
        Returns:
            Document relationship graph
        """
        nodes = []
        edges = []
        
        for i, doc in enumerate(documents):
            nodes.append({
                "doc_id": doc.get("id", f"doc_{i}"),
                "title": doc.get("title", ""),
            })
        
        # Find relationships (same entities, citations, etc.)
        for i in range(len(documents)):
            for j in range(i + 1, len(documents)):
                # Simple heuristic: if documents share entity names
                entities_i = set(self._extract_quick_entities(documents[i]))
                entities_j = set(self._extract_quick_entities(documents[j]))
                
                shared = entities_i & entities_j
                if len(shared) >= 2:
                    edges.append({
                        "source": documents[i].get("id", f"doc_{i}"),
                        "target": documents[j].get("id", f"doc_{j}"),
                        "relationship": "shares_entities",
                        "weight": len(shared),
                    })
        
        return {
            "nodes": nodes,
            "edges": edges,
        }
    
    def _extract_quick_entities(self, doc: Dict[str, Any]) -> List[str]:
        """Quick entity extraction for comparison"""
        # Simple approach - extract capitalized words
        import re
        text = doc.get("content", "") + " " + doc.get("title", "")
        return re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', text)[:20]
