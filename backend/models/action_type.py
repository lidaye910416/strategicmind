"""
ActionType and StrategicAction - Action models for strategic simulation

This module defines the action schema for strategic decisions,
including public actions, private actions, and deliberation.

These models replace OASIS social media action types with strategic
action types focused on business and policy decisions.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Set
from enum import Enum
from datetime import datetime


class ActionType(str, Enum):
    """
    Strategic action types covering various categories:
    
    - Public statements: Publicly visible communications
    - Private actions: Hidden from public view
    - Deliberative: Negotiation and coordination
    - Market actions: Financial and trading decisions
    - Information: Intelligence gathering and sharing
    - Coalition: Formation and management of alliances
    """
    
    # Public statement actions
    MAKE_STATEMENT = "MAKE_STATEMENT"
    PUBLISH_REPORT = "PUBLISH_REPORT"
    FILE_DOCUMENT = "FILE_DOCUMENT"
    
    # Private actions (hidden from public)
    PRIVATE_MEETING = "PRIVATE_MEETING"
    LEAK_INFORMATION = "LEAK_INFORMATION"
    CONCEALED_TRADE = "CONCEALED_TRADE"
    
    # Deliberative actions
    PROPOSE_DEAL = "PROPOSE_DEAL"
    COORDINATE_POSITION = "COORDINATE_POSITION"
    NEGOTIATE = "NEGOTIATE"
    
    # Market actions
    TRADE_ASSET = "TRADE_ASSET"
    ACCUMULATE_POSITION = "ACCUMULATE_POSITION"
    RATING_ACTION = "RATING_ACTION"
    
    # Information actions
    SHARE_INTEL = "SHARE_INTEL"
    SPREAD_NARRATIVE = "SPREAD_NARRATIVE"
    GATHER_INTEL = "GATHER_INTEL"
    
    # Coalition actions
    FORM_COALITION = "FORM_COALITION"
    JOIN_COALITION = "JOIN_COALITION"
    LEAVE_COALITION = "LEAVE_COALITION"
    
    def is_public(self) -> bool:
        """Check if this action type is publicly visible"""
        return self in {
            ActionType.MAKE_STATEMENT,
            ActionType.PUBLISH_REPORT,
            ActionType.FILE_DOCUMENT,
            ActionType.TRADE_ASSET,  # Some trades are public
            ActionType.RATING_ACTION,
            ActionType.SPREAD_NARRATIVE,
        }
    
    def requires_disclosure(self) -> bool:
        """Check if this action requires regulatory disclosure"""
        return self in {
            ActionType.TRADE_ASSET,
            ActionType.ACCUMULATE_POSITION,
            ActionType.FILE_DOCUMENT,
        }
    
    def __str__(self) -> str:
        return self.value


class PropagationChannel(str, Enum):
    """Channels through which actions propagate to other agents"""
    DIRECT = "DIRECT"              # Direct communication
    MEDIA = "MEDIA"               # Traditional media
    SOCIAL_MEDIA = "SOCIAL_MEDIA"  # Social platforms
    MARKET_SIGNAL = "MARKET_SIGNAL"  # Market indicators
    RUMOR = "RUMOR"               # Informal gossip
    OFFICIAL = "OFFICIAL"         # Official channels


@dataclass
class ActionConstraints:
    """Constraints on what actions an agent can take"""
    max_actions_per_round: int = 3
    requires_approval: bool = False
    disclosure_requirements: List[str] = field(default_factory=list)
    regulatory_constraints: Dict[str, Any] = field(default_factory=dict)


@dataclass
class StrategicAction:
    """
    A strategic action taken by an agent.
    
    This is the core action model for strategic simulation,
    capturing both public and private aspects of agent decisions.
    
    Attributes:
        action_type: Type of action being taken
        actor_id: ID of the agent taking the action
        public_description: Description visible to others
        target_ids: IDs of agents targeted by this action
        private_intent: Hidden intent/goal of the action
        secret_terms: Confidential terms of the action
        round_num: Simulation round when action was taken
        is_hidden: Whether action is hidden from public
        propagation_channels: How this action spreads
        metadata: Additional action metadata
    """
    
    action_type: ActionType
    actor_id: str
    
    # Public information
    public_description: str = ""
    target_ids: List[str] = field(default_factory=list)
    
    # Private information
    private_intent: str = ""
    secret_terms: Dict[str, Any] = field(default_factory=dict)
    
    # Execution context
    round_num: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    is_hidden: bool = False
    
    # Propagation
    propagation_channels: List[PropagationChannel] = field(
        default_factory=lambda: [PropagationChannel.DIRECT]
    )
    
    # Results
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "action_type": self.action_type.value,
            "actor_id": self.actor_id,
            "public_description": self.public_description,
            "target_ids": self.target_ids,
            "private_intent": self.private_intent,
            "secret_terms": self.secret_terms,
            "round_num": self.round_num,
            "timestamp": self.timestamp,
            "is_hidden": self.is_hidden,
            "propagation_channels": [c.value for c in self.propagation_channels],
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrategicAction':
        """Create StrategicAction from dictionary"""
        return cls(
            action_type=ActionType(data.get("action_type", "MAKE_STATEMENT")),
            actor_id=data.get("actor_id", ""),
            public_description=data.get("public_description", ""),
            target_ids=data.get("target_ids", []),
            private_intent=data.get("private_intent", ""),
            secret_terms=data.get("secret_terms", {}),
            round_num=data.get("round_num", 0),
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            is_hidden=data.get("is_hidden", False),
            propagation_channels=[
                PropagationChannel(c) for c in data.get("propagation_channels", ["DIRECT"])
            ],
            metadata=data.get("metadata", {}),
        )


@dataclass
class ActionResult:
    """
    Result of executing a strategic action.
    
    This captures the outcome of an action including belief updates,
    relationship changes, and observable effects.
    
    Attributes:
        success: Whether the action succeeded
        public_outcome: Observable outcome to others
        private_outcome: Hidden outcome only visible to actor
        belief_updates: Changes to agent beliefs
        relationship_changes: Changes to agent relationships
        metadata: Additional result metadata
    """
    
    success: bool = True
    public_outcome: str = ""
    private_outcome: str = ""
    
    # Belief changes caused by this action
    belief_updates: Dict[str, List[str]] = field(default_factory=dict)  # agent_id -> list of belief changes
    
    # Relationship changes
    relationship_changes: Dict[str, float] = field(default_factory=dict)  # agent_id -> delta
    
    # Observable effects
    observable_effects: List[str] = field(default_factory=list)
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "success": self.success,
            "public_outcome": self.public_outcome,
            "private_outcome": self.private_outcome,
            "belief_updates": self.belief_updates,
            "relationship_changes": self.relationship_changes,
            "observable_effects": self.observable_effects,
            "metadata": self.metadata,
        }
