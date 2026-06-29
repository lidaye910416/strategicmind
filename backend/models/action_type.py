"""
ActionType and StrategicAction - Action models for strategic simulation

This module defines the action schema for strategic decisions,
including public actions, private actions, and deliberation.

These models are the StrategicMind action types for strategic
action types focused on business and policy decisions.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Set
from enum import Enum
from datetime import datetime
import uuid


# Twitter-like cap for public-facing post content surfaced in reports.
# Tests (`test_action_taxonomy.py::test_post_content_length_enforced`)
# assert ValueError on over-cap strings.
MAX_POST_CONTENT_LEN: int = 280


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
    """Channels through which actions propagate to other agents.

    Aliases (for backward compatibility with callers that used the
    v1 channel names):
      - PEER is an alias of SOCIAL_MEDIA  (both share the "SOCIAL_MEDIA" value)
      - MARKET is an alias of MARKET_SIGNAL (both share the "MARKET_SIGNAL" value)
    Use :meth:`coerce_channels` to normalize a heterogeneous input list
    of strings and/or enum values into a deduplicated, alias-resolved list.
    """
    DIRECT = "DIRECT"              # Direct communication
    MEDIA = "MEDIA"               # Traditional media
    SOCIAL_MEDIA = "SOCIAL_MEDIA"  # Social platforms
    # Alias of SOCIAL_MEDIA (same value). Inserted as the canonical
    # name in coerce_channels output so callers can rely on a single
    # canonical enum per string value.
    PEER = "SOCIAL_MEDIA"          # Canonical name for SOCIAL_MEDIA
    MARKET_SIGNAL = "MARKET_SIGNAL"  # Market indicators
    # Alias of MARKET_SIGNAL (same value).
    MARKET = "MARKET_SIGNAL"       # Canonical name for MARKET_SIGNAL
    RUMOR = "RUMOR"               # Informal gossip
    OFFICIAL = "OFFICIAL"         # Official channels

    @classmethod
    def coerce_channels(cls, values):
        """Normalize a heterogeneous list into deduplicated canonical enums.

        Accepts strings (case-insensitive match against enum values) and
        PropagationChannel instances. Aliases (PEER ↔ SOCIAL_MEDIA,
        MARKET ↔ MARKET_SIGNAL) collapse to the canonical enum. Unknown
        values are dropped silently.
        """
        if not values:
            return []

        # Map any incoming token (string or enum) → canonical enum.
        # Build a reverse lookup: every enum's value (the underlying
        # string) maps to the canonical enum, preferring PEER over
        # SOCIAL_MEDIA and MARKET over MARKET_SIGNAL.
        by_value: Dict[str, "PropagationChannel"] = {}
        for member in cls:
            # Skip non-canonical aliases when building the reverse map;
            # we want SOCIAL_MEDIA → PEER and MARKET_SIGNAL → MARKET.
            if member in (cls.PEER, cls.MARKET):
                continue
            by_value[member.value] = member
        # Now add canonical names (PEER, MARKET) as preferred.
        by_value[cls.PEER.value] = cls.PEER
        by_value[cls.MARKET.value] = cls.MARKET

        seen: Set["PropagationChannel"] = set()
        result: List["PropagationChannel"] = []
        for v in values:
            if isinstance(v, cls):
                # Normalize alias enum values to their canonical form.
                if v in (cls.SOCIAL_MEDIA, cls.PEER):
                    canon = cls.PEER
                elif v in (cls.MARKET_SIGNAL, cls.MARKET):
                    canon = cls.MARKET
                else:
                    canon = v
            else:
                key = str(v).upper()
                canon = by_value.get(key)
                if canon is None:
                    continue
            if canon in seen:
                continue
            seen.add(canon)
            result.append(canon)
        return result


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
    # Auto-generated uuid4 unique id. Stored on construction so each
    # action can be referenced by id (e.g. `in_reply_to` chains).
    action_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    # Public information
    public_description: str = ""
    target_ids: List[str] = field(default_factory=list)
    post_content: str = ""  # surfaced in reports; capped at MAX_POST_CONTENT_LEN
    post_author_name: str = ""  # display name of the actor (e.g. "张三")

    # Private information
    private_intent: str = ""
    secret_terms: Dict[str, Any] = field(default_factory=dict)
    evidence: List[str] = field(default_factory=list)  # supporting evidence refs

    # Execution context
    round_num: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    is_hidden: bool = False

    # Propagation
    propagation_channels: List[PropagationChannel] = field(
        default_factory=lambda: [PropagationChannel.DIRECT]
    )
    in_reply_to: Optional[str] = None  # prior action_id this replies to

    # Results
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Enforce post_content cap (Twitter-like 280 chars). Tests
        # (`backend/tests/unit/test_action_taxonomy.py::test_post_content_length_enforced`)
        # assert ValueError on over-cap strings. Public actions are
        # surfaced in reports, so 280 is the platform norm.
        if self.post_content and len(self.post_content) > MAX_POST_CONTENT_LEN:
            raise ValueError(
                f"post_content length {len(self.post_content)} > MAX_POST_CONTENT_LEN ({MAX_POST_CONTENT_LEN})"
            )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "action_id": self.action_id,
            "action_type": self.action_type.value,
            "actor_id": self.actor_id,
            "public_description": self.public_description,
            "target_ids": self.target_ids,
            "post_content": self.post_content,
            "post_author_name": self.post_author_name,
            "private_intent": self.private_intent,
            "secret_terms": self.secret_terms,
            "evidence": list(self.evidence),
            "round_num": self.round_num,
            "timestamp": self.timestamp,
            "is_hidden": self.is_hidden,
            "propagation_channels": [c.value for c in self.propagation_channels],
            "in_reply_to": self.in_reply_to,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrategicAction':
        """Create StrategicAction from dictionary"""
        # Default action_id only when the payload omits it; preserve
        # existing ids on round-trip so in_reply_to chains stay intact.
        action_id = data.get("action_id") or str(uuid.uuid4())
        return cls(
            action_id=action_id,
            action_type=ActionType(data.get("action_type", "MAKE_STATEMENT")),
            actor_id=data.get("actor_id", ""),
            public_description=data.get("public_description", ""),
            target_ids=data.get("target_ids", []),
            post_content=data.get("post_content", ""),
            post_author_name=data.get("post_author_name", ""),
            private_intent=data.get("private_intent", ""),
            secret_terms=data.get("secret_terms", {}),
            evidence=list(data.get("evidence", [])),
            round_num=data.get("round_num", 0),
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            is_hidden=data.get("is_hidden", False),
            propagation_channels=[
                PropagationChannel(c) for c in data.get("propagation_channels", ["DIRECT"])
            ],
            in_reply_to=data.get("in_reply_to"),
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
