"""
SeedDocument and related dataclasses

These models define the schema for document intelligence output,
including facts, entity mentions, timeline events, and claims.

Replaces: ad-hoc document parsing
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum
from datetime import datetime


class DocumentType(str, Enum):
    """Type of source document"""
    NEWS = "news"
    REPORT = "report"
    SOCIAL_MEDIA = "social_media"
    ACADEMIC = "academic"
    REGULATORY = "regulatory"
    FINANCIAL = "financial"
    UNKNOWN = "unknown"


class ClaimType(str, Enum):
    """Type of claim in document"""
    FACTUAL = "factual"
    OPINION = "opinion"
    PREDICTION = "prediction"
    COMMITMENT = "commitment"
    HYPOTHESIS = "hypothesis"


@dataclass
class EntityMention:
    """Entity mention in a document"""
    text: str
    entity_type: str
    start_pos: int
    end_pos: int
    confidence: float = 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "entity_type": self.entity_type,
            "start_pos": self.start_pos,
            "end_pos": self.end_pos,
            "confidence": self.confidence,
        }


@dataclass
class Fact:
    """A factual statement extracted from document"""
    id: str
    statement: str
    subject: str
    predicate: str
    object: str
    confidence: float = 1.0
    source_quote: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "statement": self.statement,
            "subject": self.subject,
            "predicate": self.predicate,
            "object": self.object,
            "confidence": self.confidence,
            "source_quote": self.source_quote,
            "metadata": self.metadata,
        }


@dataclass
class TimelineEvent:
    """Event extracted from document"""
    id: str
    event_type: str
    description: str
    timestamp: Optional[datetime] = None
    participants: List[str] = field(default_factory=list)
    location: Optional[str] = None
    impact: str = ""
    confidence: float = 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "event_type": self.event_type,
            "description": self.description,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "participants": self.participants,
            "location": self.location,
            "impact": self.impact,
            "confidence": self.confidence,
        }


@dataclass
class Claim:
    """A claim made in the document"""
    id: str
    claim_type: ClaimType
    content: str
    claimant: str  # Who made the claim
    supporting_evidence: List[str] = field(default_factory=list)
    contradicting_evidence: List[str] = field(default_factory=list)
    veracity: Optional[float] = None  # 0.0 (false) to 1.0 (true)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "claim_type": self.claim_type.value,
            "content": self.content,
            "claimant": self.claimant,
            "supporting_evidence": self.supporting_evidence,
            "contradicting_evidence": self.contradicting_evidence,
            "veracity": self.veracity,
            "metadata": self.metadata,
        }


@dataclass
class SeedDocument:
    """
    Parsed seed document with extracted intelligence.
    
    This is the core document model after intelligence processing,
    containing:
        - Document metadata
        - Extracted facts
        - Key entities
        - Timeline events
        - Claims
    
    Usage:
        doc = SeedDocumentParser.parse(file_path)
        pipeline.process([doc])
    """
    
    # Document metadata
    doc_id: str
    title: str
    content: str
    doc_type: DocumentType = DocumentType.UNKNOWN
    source_url: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.now)
    
    # Extracted intelligence
    extracted_facts: List[Fact] = field(default_factory=list)
    key_entities: List[EntityMention] = field(default_factory=list)
    timeline: List[TimelineEvent] = field(default_factory=list)
    claims: List[Claim] = field(default_factory=list)
    
    # Analysis metadata
    language: str = "unknown"
    confidence: float = 1.0
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "content": self.content,
            "doc_type": self.doc_type.value,
            "source_url": self.source_url,
            "author": self.author,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "created_at": self.created_at.isoformat(),
            "extracted_facts": [f.to_dict() for f in self.extracted_facts],
            "key_entities": [e.to_dict() for e in self.key_entities],
            "timeline": [t.to_dict() for t in self.timeline],
            "claims": [c.to_dict() for c in self.claims],
            "language": self.language,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SeedDocument':
        """Create SeedDocument from dictionary"""
        from uuid import uuid4
        
        return cls(
            doc_id=data.get("doc_id", str(uuid4())),
            title=data.get("title", ""),
            content=data.get("content", ""),
            doc_type=DocumentType(data.get("doc_type", "unknown")),
            source_url=data.get("source_url"),
            author=data.get("author"),
            published_at=datetime.fromisoformat(data["published_at"]) if data.get("published_at") else None,
            extracted_facts=[Fact(**f) for f in data.get("extracted_facts", [])],
            key_entities=[EntityMention(**e) for e in data.get("key_entities", [])],
            timeline=[TimelineEvent(**t) for t in data.get("timeline", [])],
            claims=[Claim(**c) for c in data.get("claims", [])],
            language=data.get("language", "unknown"),
            confidence=data.get("confidence", 1.0),
            metadata=data.get("metadata", {}),
        )
    
    def get_entity_names(self) -> List[str]:
        """Get list of entity names from key_entities"""
        return [e.text for e in self.key_entities]
    
    def get_fact_statements(self) -> List[str]:
        """Get list of fact statements"""
        return [f.statement for f in self.extracted_facts]
