"""
SemanticChunker - Semantic document splitting

This service splits documents by semantic unit instead of fixed size,
providing better context for graph building.

Each chunk has a type label: narrative, claim, quote, event, background
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum
import re


class ChunkType(str, Enum):
    """Type of semantic chunk"""
    NARRATIVE = "narrative"      # Regular narrative text
    CLAIM = "claim"             # Statement of fact or opinion
    QUOTE = "quote"             # Direct quotation
    EVENT = "event"             # Event description
    BACKGROUND = "background"  # Background/contextual information
    TRANSITION = "transition"   # Transition/summary sections


@dataclass
class Chunk:
    """A semantic chunk from a document"""
    chunk_id: str
    content: str
    chunk_type: ChunkType
    start_pos: int
    end_pos: int
    parent_chunk_id: Optional[str] = None
    confidence: float = 1.0
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "content": self.content,
            "chunk_type": self.chunk_type.value,
            "start_pos": self.start_pos,
            "end_pos": self.end_pos,
            "parent_chunk_id": self.parent_chunk_id,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


class SemanticChunker:
    """
    Splits documents by semantic unit.
    
    This provides better context for graph building than fixed-size chunking
    by preserving semantic boundaries like sentences, paragraphs, and sections.
    
    Usage:
        chunker = SemanticChunker()
        chunks = chunker.chunk(document)
        for chunk in chunks:
            print(f"{chunk.chunk_type}: {chunk.content[:50]}...")
    """
    
    def __init__(
        self,
        min_chunk_size: int = 100,
        max_chunk_size: int = 1000,
        overlap: int = 50,
    ):
        """
        Initialize SemanticChunker.
        
        Args:
            min_chunk_size: Minimum chunk size in characters
            max_chunk_size: Maximum chunk size in characters
            overlap: Overlap between chunks for context preservation
        """
        self.min_chunk_size = min_chunk_size
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap
        
        # Patterns for detecting chunk types
        self._patterns = {
            ChunkType.QUOTE: re.compile(r'[""\'][""\']?[^\n""\'"]+[""\'][""\']?'),
            ChunkType.EVENT: re.compile(r'\b(?:announce|launch|acquire|merge|launch|report|reveal|disclose)\b', re.IGNORECASE),
            ChunkType.CLAIM: re.compile(r'\b(?:believe|think|expect|predict|forecast|estimate)\b', re.IGNORECASE),
            ChunkType.BACKGROUND: re.compile(r'^(?:background|history|context|about|previously)\s*:', re.IGNORECASE | re.MULTILINE),
        }
    
    def chunk(self, document: str) -> List[Chunk]:
        """
        Split document into semantic chunks.
        
        Args:
            document: Document text to chunk
            
        Returns:
            List of Chunk objects
        """
        from uuid import uuid4
        
        chunks = []
        
        # Split by paragraphs first
        paragraphs = self._split_paragraphs(document)
        
        current_chunk = ""
        current_start = 0
        chunk_count = 0
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            para_start = document.find(para, current_start)
            para_end = para_start + len(para)
            
            # Check if adding this paragraph exceeds max size
            if len(current_chunk) + len(para) > self.max_chunk_size and current_chunk:
                # Determine chunk type
                chunk_type = self._classify_chunk(current_chunk)
                
                chunks.append(Chunk(
                    chunk_id=str(uuid4()),
                    content=current_chunk.strip(),
                    chunk_type=chunk_type,
                    start_pos=current_start,
                    end_pos=current_start + len(current_chunk),
                    confidence=self._calculate_confidence(current_chunk, chunk_type),
                ))
                
                chunk_count += 1
                
                # Start new chunk with overlap
                overlap_text = current_chunk[-self.overlap:] if len(current_chunk) > self.overlap else current_chunk
                current_chunk = overlap_text + "\n" + para
                current_start = para_start - (len(current_chunk) - len(para) - len(overlap_text))
            else:
                if current_chunk:
                    current_chunk += "\n" + para
                else:
                    current_chunk = para
                    current_start = para_start
        
        # Add final chunk
        if current_chunk.strip():
            chunk_type = self._classify_chunk(current_chunk)
            chunks.append(Chunk(
                chunk_id=str(uuid4()),
                content=current_chunk.strip(),
                chunk_type=chunk_type,
                start_pos=current_start,
                end_pos=current_start + len(current_chunk),
                confidence=self._calculate_confidence(current_chunk, chunk_type),
            ))
        
        return chunks
    
    def _split_paragraphs(self, document: str) -> List[str]:
        """Split document into paragraphs"""
        # Split by double newline or single newline followed by whitespace
        paragraphs = re.split(r'\n\s*\n|\n(?=[A-Z])', document)
        return [p.strip() for p in paragraphs if p.strip()]
    
    def _classify_chunk(self, content: str) -> ChunkType:
        """Classify the type of a chunk based on content"""
        for chunk_type, pattern in self._patterns.items():
            if pattern.search(content):
                return chunk_type
        
        # Check for section headers
        if re.match(r'^(?:##?\s*)?[A-Z][A-Z\s]+:?$', content.split('\n')[0]):
            if 'background' in content.lower() or 'context' in content.lower():
                return ChunkType.BACKGROUND
            if 'event' in content.lower() or 'timeline' in content.lower():
                return ChunkType.EVENT
        
        return ChunkType.NARRATIVE
    
    def _calculate_confidence(self, content: str, chunk_type: ChunkType) -> float:
        """Calculate confidence score for the chunk"""
        confidence = 0.8  # Base confidence
        
        # Increase confidence for well-formed content
        if len(content) >= self.min_chunk_size:
            confidence += 0.1
        
        # Decrease confidence for very short chunks
        if len(content) < self.min_chunk_size:
            confidence -= 0.2
        
        # Higher confidence for clear type classification
        if chunk_type in [ChunkType.QUOTE, ChunkType.EVENT]:
            confidence += 0.1
        
        return max(0.0, min(1.0, confidence))
