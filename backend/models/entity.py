"""
Entity dataclass - Generic entity representation

This model provides a generic entity representation that is not tied to
any specific storage backend (Zep, nano-GraphRAG, etc.).

Replaces: zep_entity_reader.EntityNode usage in ProfileGenerator
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from uuid import uuid4


@dataclass
class Entity:
    """
    Generic entity representation for knowledge graph.
    
    This is the core entity model used throughout the system,
    independent of any specific knowledge store implementation.
    
    Attributes:
        uuid: Unique identifier for the entity
        name: Entity name (required)
        entity_type: Type classification (e.g., "Person", "Organization", "Location")
        summary: Brief description or summary of the entity
        attributes: Additional attributes as key-value pairs
        metadata: Optional metadata (source, timestamps, etc.)
    """
    
    uuid: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    entity_type: str = ""
    summary: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate required fields"""
        if not self.name:
            raise ValueError("Entity name is required")
        if not self.entity_type:
            raise ValueError("Entity type is required")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            "uuid": self.uuid,
            "name": self.name,
            "entity_type": self.entity_type,
            "summary": self.summary,
            "attributes": self.attributes,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Entity':
        """Create Entity from dictionary"""
        return cls(
            uuid=data.get("uuid", str(uuid4())),
            name=data.get("name", ""),
            entity_type=data.get("entity_type", ""),
            summary=data.get("summary", ""),
            attributes=data.get("attributes", {}),
            metadata=data.get("metadata", {}),
        )
    
    def add_attribute(self, key: str, value: Any) -> None:
        """Add or update an attribute"""
        self.attributes[key] = value
    
    def get_attribute(self, key: str, default: Any = None) -> Any:
        """Get an attribute value"""
        return self.attributes.get(key, default)
