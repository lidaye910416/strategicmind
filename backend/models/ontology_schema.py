"""
OntologySchema - Local ontology schema without Zep SDK

This model stores ontology definitions locally in project.metadata,
replacing Zep SDK's entity/edge models.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum


@dataclass
class AttributeSchema:
    """Schema definition for an entity attribute"""
    name: str
    type: str  # string, number, boolean, date, list
    description: str = ""
    required: bool = False
    default_value: Any = None
    examples: List[str] = field(default_factory=list)


@dataclass
class EntitySchema:
    """Schema definition for an entity type"""
    name: str
    description: str = ""
    attributes: List[AttributeSchema] = field(default_factory=list)
    examples: List[str] = field(default_factory=list)
    parent_type: Optional[str] = None  # For inheritance


@dataclass
class RelationSchema:
    """Schema definition for a relation type"""
    name: str
    description: str = ""
    source_types: List[str] = field(default_factory=list)  # Valid source entity types
    target_types: List[str] = field(default_factory=list)  # Valid target entity types
    attributes: List[AttributeSchema] = field(default_factory=list)
    is_directed: bool = True
    is_reflexive: bool = False


@dataclass
class OntologySchema:
    """
    Complete ontology schema for a project.
    
    This replaces Zep SDK's EntityModel/EdgeModel with local storage.
    
    Usage:
        schema = OntologySchema()
        schema.add_entity(EntitySchema(name="Company", description="..."))
        schema.add_relation(RelationSchema(name="WORKS_FOR", ...))
        
        # Serialize to JSON
        json_data = schema.to_dict()
        
        # Store in project.metadata
        project.metadata['ontology_schema'] = json_data
    """
    
    schema_id: str = ""
    name: str = "default"
    version: str = "1.0"
    description: str = ""
    
    entities: List[EntitySchema] = field(default_factory=list)
    relations: List[RelationSchema] = field(default_factory=list)
    
    # Metadata
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def add_entity(self, entity: EntitySchema) -> None:
        """Add an entity type to the schema"""
        # Remove existing with same name
        self.entities = [e for e in self.entities if e.name != entity.name]
        self.entities.append(entity)
    
    def add_relation(self, relation: RelationSchema) -> None:
        """Add a relation type to the schema"""
        self.relations = [r for r in self.relations if r.name != relation.name]
        self.relations.append(relation)
    
    def get_entity(self, name: str) -> Optional[EntitySchema]:
        """Get entity schema by name"""
        for entity in self.entities:
            if entity.name == name:
                return entity
        return None
    
    def get_relation(self, name: str) -> Optional[RelationSchema]:
        """Get relation schema by name"""
        for relation in self.relations:
            if relation.name == name:
                return relation
        return None
    
    def get_entity_types(self) -> List[str]:
        """Get list of entity type names"""
        return [e.name for e in self.entities]
    
    def get_relation_types(self) -> List[str]:
        """Get list of relation type names"""
        return [r.name for r in self.relations]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "schema_id": self.schema_id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "entity_types": [
                {
                    "name": e.name,
                    "description": e.description,
                    "attributes": [
                        {
                            "name": a.name,
                            "type": a.type,
                            "description": a.description,
                            "required": a.required,
                            "default_value": a.default_value,
                            "examples": a.examples,
                        }
                        for a in e.attributes
                    ],
                    "examples": e.examples,
                    "parent_type": e.parent_type,
                }
                for e in self.entities
            ],
            "edge_types": [
                {
                    "name": r.name,
                    "description": r.description,
                    "source_types": r.source_types,
                    "target_types": r.target_types,
                    "attributes": [
                        {
                            "name": a.name,
                            "type": a.type,
                            "description": a.description,
                            "required": a.required,
                        }
                        for a in r.attributes
                    ],
                    "is_directed": r.is_directed,
                    "is_reflexive": r.is_reflexive,
                }
                for r in self.relations
            ],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'OntologySchema':
        """Create from dictionary"""
        # Convert entity_types to EntitySchema
        entities = []
        for e_data in data.get("entity_types", []):
            attributes = [
                AttributeSchema(**a) for a in e_data.get("attributes", [])
            ]
            entities.append(EntitySchema(
                name=e_data["name"],
                description=e_data.get("description", ""),
                attributes=attributes,
                examples=e_data.get("examples", []),
                parent_type=e_data.get("parent_type"),
            ))
        
        # Convert edge_types to RelationSchema
        relations = []
        for r_data in data.get("edge_types", []):
            attributes = [
                AttributeSchema(**a) for a in r_data.get("attributes", [])
            ]
            relations.append(RelationSchema(
                name=r_data["name"],
                description=r_data.get("description", ""),
                source_types=r_data.get("source_types", []),
                target_types=r_data.get("target_types", []),
                attributes=attributes,
                is_directed=r_data.get("is_directed", True),
                is_reflexive=r_data.get("is_reflexive", False),
            ))
        
        return cls(
            schema_id=data.get("schema_id", ""),
            name=data.get("name", "default"),
            version=data.get("version", "1.0"),
            description=data.get("description", ""),
            entities=entities,
            relations=relations,
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
            metadata=data.get("metadata", {}),
        )
