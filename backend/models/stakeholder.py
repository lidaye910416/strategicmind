"""
StakeholderModel - Strategic actors and relationships

This module defines stakeholder relationships for corporate dynamics,
including shareholders, management, board, regulators, and competitors.

NEW - Core for strategic simulation, not in MiroFish
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum


class StakeholderType(str, Enum):
    """Types of strategic stakeholders"""
    SHAREHOLDER = "SHAREHOLDER"
    BOARD_MEMBER = "BOARD_MEMBER"
    EXECUTIVE = "EXECUTIVE"
    COMPETITOR = "COMPETITOR"
    REGULATOR = "REGULATOR"
    PARTNER = "PARTNER"
    EMPLOYEE = "EMPLOYEE"
    CUSTOMER = "CUSTOMER"
    SUPPLIER = "SUPPLIER"
    CREDITOR = "CREDITOR"


class RelationshipType(str, Enum):
    """Types of relationships between stakeholders"""
    OWNERSHIP = "OWNERSHIP"
    CONTROL = "CONTROL"
    INFLUENCE = "INFLUENCE"
    COMPETITION = "COMPETITION"
    COOPERATION = "COOPERATION"
    REGULATION = "REGULATION"
    EMPLOYMENT = "EMPLOYMENT"
    SUPPLY = "SUPPLY"
    DEBT = "DEBT"
    ALLIANCE = "ALLIANCE"


@dataclass
class StakeholderInterest:
    """Financial and strategic goals of a stakeholder"""
    financial_goals: List[str] = field(default_factory=list)
    strategic_goals: List[str] = field(default_factory=list)
    risk_tolerance: float = 0.5  # 0.0 (averse) to 1.0 (seeking)
    time_horizon: str = "medium"  # short/medium/long
    red_lines: List[str] = field(default_factory=list)  # Unacceptable outcomes


@dataclass
class StakeholderModel:
    """
    Model of a strategic stakeholder.
    
    This represents a real-world stakeholder with their interests,
    relationships, and influence in strategic decisions.
    
    Attributes:
        stakeholder_id: Unique identifier
        name: Stakeholder name
        stakeholder_type: Type of stakeholder
        interests: Financial and strategic interests
        influence_weight: Weight in decision-making (0.0 to 1.0)
        relationships: Relationships with other stakeholders
        metadata: Additional stakeholder data
    """
    
    stakeholder_id: str
    name: str
    stakeholder_type: StakeholderType
    
    # Interests
    interests: StakeholderInterest = field(default_factory=StakeholderInterest)
    
    # Influence
    influence_weight: float = 0.5
    
    # Relationships
    relationships: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # other_id -> relationship data
    
    # Internal state
    current_position: Optional[str] = None  # Current stance
    historical_actions: List[Dict[str, Any]] = field(default_factory=list)
    
    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def add_relationship(
        self,
        other_id: str,
        relationship_type: RelationshipType,
        strength: float = 0.5,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Add or update a relationship with another stakeholder"""
        self.relationships[other_id] = {
            "type": relationship_type.value,
            "strength": strength,
            "metadata": metadata or {},
        }
    
    def get_relationship(self, other_id: str) -> Optional[Dict[str, Any]]:
        """Get relationship data with another stakeholder"""
        return self.relationships.get(other_id)
    
    def has_relationship_type(self, other_id: str, rel_type: RelationshipType) -> bool:
        """Check if relationship with other exists of specific type"""
        rel = self.relationships.get(other_id, {})
        return rel.get("type") == rel_type.value
    
    def get_aligned_stakeholders(self, relationship_types: List[RelationshipType]) -> List[str]:
        """Get stakeholders with specific relationship types"""
        types_str = [rt.value for rt in relationship_types]
        return [
            other_id for other_id, rel in self.relationships.items()
            if rel.get("type") in types_str
        ]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "stakeholder_id": self.stakeholder_id,
            "name": self.name,
            "stakeholder_type": self.stakeholder_type.value,
            "interests": {
                "financial_goals": self.interests.financial_goals,
                "strategic_goals": self.interests.strategic_goals,
                "risk_tolerance": self.interests.risk_tolerance,
                "time_horizon": self.interests.time_horizon,
                "red_lines": self.interests.red_lines,
            },
            "influence_weight": self.influence_weight,
            "relationships": self.relationships,
            "current_position": self.current_position,
            "historical_actions": self.historical_actions,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StakeholderModel':
        """Create from dictionary"""
        return cls(
            stakeholder_id=data["stakeholder_id"],
            name=data["name"],
            stakeholder_type=StakeholderType(data["stakeholder_type"]),
            interests=StakeholderInterest(**data.get("interests", {})),
            influence_weight=data.get("influence_weight", 0.5),
            relationships=data.get("relationships", {}),
            current_position=data.get("current_position"),
            historical_actions=data.get("historical_actions", []),
            metadata=data.get("metadata", {}),
        )


@dataclass
class StakeholderMap:
    """
    Collection of stakeholders and their relationships.
    
    This represents the complete stakeholder landscape for a strategic scenario.
    """
    
    stakeholders: Dict[str, StakeholderModel] = field(default_factory=dict)
    coalition_groups: Dict[str, List[str]] = field(default_factory=dict)  # coalition_id -> member_ids
    
    def add_stakeholder(self, stakeholder: StakeholderModel) -> None:
        """Add a stakeholder to the map"""
        self.stakeholders[stakeholder.stakeholder_id] = stakeholder
    
    def get_stakeholder(self, stakeholder_id: str) -> Optional[StakeholderModel]:
        """Get a stakeholder by ID"""
        return self.stakeholders.get(stakeholder_id)
    
    def get_stakeholders_by_type(self, st_type: StakeholderType) -> List[StakeholderModel]:
        """Get all stakeholders of a specific type"""
        return [
            s for s in self.stakeholders.values()
            if s.stakeholder_type == st_type
        ]
    
    def get_related_stakeholders(
        self,
        stakeholder_id: str,
        relationship_types: Optional[List[RelationshipType]] = None
    ) -> List[StakeholderModel]:
        """Get stakeholders related to a given stakeholder"""
        stakeholder = self.stakeholders.get(stakeholder_id)
        if not stakeholder:
            return []
        
        related = []
        for other_id in stakeholder.relationships:
            other = self.stakeholders.get(other_id)
            if other:
                if relationship_types:
                    if stakeholder.has_relationship_type(other_id, relationship_types[0]):
                        related.append(other)
                else:
                    related.append(other)
        
        return related
    
    def create_coalition(self, coalition_id: str, member_ids: List[str]) -> None:
        """Create a coalition of stakeholders"""
        self.coalition_groups[coalition_id] = member_ids
        
        # Update relationships within coalition
        for member_id in member_ids:
            member = self.stakeholders.get(member_id)
            if member:
                member.coalition_members = member_ids
    
    def get_coalition(self, coalition_id: str) -> List[StakeholderModel]:
        """Get all stakeholders in a coalition"""
        member_ids = self.coalition_groups.get(coalition_id, [])
        return [
            self.stakeholders[mid] for mid in member_ids
            if mid in self.stakeholders
        ]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "stakeholders": {
                sid: s.to_dict() for sid, s in self.stakeholders.items()
            },
            "coalition_groups": self.coalition_groups,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StakeholderMap':
        """Create from dictionary"""
        m = cls()
        for sid, sd in data.get("stakeholders", {}).items():
            m.add_stakeholder(StakeholderModel.from_dict(sd))
        m.coalition_groups = data.get("coalition_groups", {})
        return m
