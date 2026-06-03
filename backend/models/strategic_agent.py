"""
StrategicAgent and related models - Core domain models for strategic simulation

This module defines the domain models for the strategic simulation engine,
including agent profiles, belief states, and interest profiles.

These models are the StrategicMind agent profiles for strategic scenarios.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Set
from enum import Enum
from uuid import uuid4


class AgentType(str, Enum):
    """
    Strategic agent types representing different stakeholders.
    
    These types define the role and perspective of each agent in the simulation.
    """
    # Core strategic actors
    POLICY_MAKER = "POLICY_MAKER"       # Government policy makers, regulators
    CORPORATE_EXEC = "CORPORATE_EXEC"   # Corporate executives, management
    INSTITUTIONAL_INVESTOR = "INSTITIONAL_INVESTOR"  # Fund managers, banks
    ANALYST = "ANALYST"                 # Financial analysts, consultants
    MEDIA = "MEDIA"                     # Journalists, media outlets
    ADVOCACY = "ADVOCACY"               # Advocacy groups, NGOs
    RATING_AGENCY = "RATING_AGENCY"    # Credit rating agencies
    INTERNATIONAL_ORG = "INTERNATIONAL_ORG"  # International organizations
    
    # Corporate stakeholder subtypes
    SHAREHOLDER = "SHAREHOLDER"         # Company shareholders
    BOARD_MEMBER = "BOARD_MEMBER"       # Board of directors
    COMPETITOR = "COMPETITOR"           # Competing firms
    PARTNER = "PARTNER"                 # Business partners
    EMPLOYEE = "EMPLOYEE"               # Company employees
    REGULATOR = "REGULATOR"             # Industry regulators
    
    def __str__(self) -> str:
        return self.value


@dataclass
class BeliefPosition:
    """A single belief position on a specific topic"""
    topic: str                    # Topic/issue identifier
    position: float               # Position on spectrum (-1.0 to 1.0)
    confidence: float = 1.0       # Confidence in this belief (0.0 to 1.0)
    evidence: List[str] = field(default_factory=list)  # Supporting evidence
    source: str = ""              # Source of this belief


@dataclass 
class FactBelief:
    """Belief about a factual matter (may be inaccurate)"""
    fact_id: str                  # Reference to the fact
    believed: bool = True         # Whether the agent believes this fact
    accuracy: float = 1.0         # Perceived accuracy (vs actual)
    updated_round: int = 0        # Last round this belief was updated


@dataclass
class TrustLevel:
    """Trust level toward another agent"""
    agent_id: str
    trust_score: float            # -1.0 (hostile) to 1.0 (fully trusted)
    last_updated: int = 0


@dataclass
class Expectation:
    """Agent's expectation about future events"""
    event_id: str
    expected_outcome: str
    probability: float          # 0.0 to 1.0
    round_created: int = 0


@dataclass
class BeliefState:
    """
    Agent's belief state tracking positions, facts, trust, and expectations.
    
    This is the core belief model for tracking how agent views evolve
    throughout the simulation.
    """
    positions: Dict[str, BeliefPosition] = field(default_factory=dict)  # topic -> position
    fact_beliefs: Dict[str, FactBelief] = field(default_factory=dict)    # fact_id -> belief
    trust_levels: Dict[str, TrustLevel] = field(default_factory=dict)    # agent_id -> trust
    expectations: Dict[str, Expectation] = field(default_factory=dict)  # event_id -> expectation
    
    def update_position(
        self, 
        topic: str, 
        new_position: float, 
        confidence: float = 1.0,
        evidence: Optional[List[str]] = None,
        source: str = ""
    ) -> None:
        """Update or create a belief position on a topic"""
        self.positions[topic] = BeliefPosition(
            topic=topic,
            position=new_position,
            confidence=confidence,
            evidence=evidence or [],
            source=source,
        )
    
    def get_position(self, topic: str) -> Optional[float]:
        """Get current position on a topic"""
        pos = self.positions.get(topic)
        return pos.position if pos else None
    
    def update_trust(self, agent_id: str, trust_score: float) -> None:
        """Update trust level toward another agent"""
        self.trust_levels[agent_id] = TrustLevel(
            agent_id=agent_id,
            trust_score=max(-1.0, min(1.0, trust_score)),
            last_updated=0,  # Will be set by simulation loop
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "positions": {k: {
                "topic": v.topic,
                "position": v.position,
                "confidence": v.confidence,
                "evidence": v.evidence,
                "source": v.source,
            } for k, v in self.positions.items()},
            "fact_beliefs": {k: {
                "fact_id": v.fact_id,
                "believed": v.believed,
                "accuracy": v.accuracy,
                "updated_round": v.updated_round,
            } for k, v in self.fact_beliefs.items()},
            "trust_levels": {k: {
                "agent_id": v.agent_id,
                "trust_score": v.trust_score,
                "last_updated": v.last_updated,
            } for k, v in self.trust_levels.items()},
            "expectations": {k: {
                "event_id": v.event_id,
                "expected_outcome": v.expected_outcome,
                "probability": v.probability,
                "round_created": v.round_created,
            } for k, v in self.expectations.items()},
        }


@dataclass
class InterestProfile:
    """
    Agent's interests and constraints guiding decision-making.
    
    This defines what the agent cares about and their risk tolerance.
    """
    primary_interests: List[str] = field(default_factory=list)   # Core interests
    secondary_interests: List[str] = field(default_factory=list) # Secondary concerns
    red_lines: List[str] = field(default_factory=list)           # Unacceptable positions
    risk_tolerance: float = 0.5                                 # 0.0 (averse) to 1.0 (seeking)
    time_horizon: str = "medium"                                 # short/medium/long
    financial_goals: List[str] = field(default_factory=list)    # Financial objectives
    strategic_goals: List[str] = field(default_factory=list)     # Strategic objectives


@dataclass
class StrategicAgent:
    """
    Strategic agent representing a stakeholder in the simulation.
    
    This is the core agent model for strategic simulation, replacing
    StrategicMind agent profiles with a focus on:
        - Belief tracking and evolution
        - Interest alignment
        - Action repertoire
        - Relationship mapping
    
    Attributes:
        agent_id: Unique identifier
        name: Agent display name
        agent_type: Type classification (AgentType enum)
        beliefs: Current belief state
        interests: Interest profile
        known_facts: Facts the agent knows about
        private_info: Private information not shared with others
        influence_weight: Weight in collective decision-making (0.0 to 1.0)
        action_repertoire: Available actions this agent can take
        credibility: Reliability of agent's statements (0.0 to 1.0)
        relationships: Relationships with other agents
        coalition_members: IDs of agents in same coalition
        round_activated: Last round the agent took action
    """
    
    agent_id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    agent_type: AgentType = AgentType.CORPORATE_EXEC
    
    # Belief state
    beliefs: BeliefState = field(default_factory=BeliefState)
    
    # Interest profile
    interests: InterestProfile = field(default_factory=InterestProfile)
    
    # Knowledge
    known_facts: Set[str] = field(default_factory=set)  # Fact IDs agent knows
    private_info: Dict[str, Any] = field(default_factory=dict)  # Hidden information
    
    # Influence
    influence_weight: float = 0.5
    
    # Action capabilities
    action_repertoire: List[str] = field(default_factory=list)
    
    # Credibility
    credibility: float = 0.8
    
    # Relationships
    relationships: Dict[str, float] = field(default_factory=dict)  # agent_id -> relationship (-1 to 1)
    coalition_members: List[str] = field(default_factory=list)
    
    # State tracking
    round_activated: int = 0
    
    def __post_init__(self):
        """Validate agent data"""
        if not self.name:
            raise ValueError("Agent name is required")
        if not self.action_repertoire:
            # Default action repertoire based on agent type
            self.action_repertoire = self._get_default_actions()
    
    def _get_default_actions(self) -> List[str]:
        """Get default actions based on agent type"""
        base_actions = [
            "MAKE_STATEMENT",
            "PRIVATE_MEETING",
            "PROPOSE_DEAL",
        ]
        
        type_specific = {
            AgentType.CORPORATE_EXEC: ["TRADE_ASSET", "FILE_DOCUMENT"],
            AgentType.INSTITUTIONAL_INVESTOR: ["TRADE_ASSET", "ACCUMULATE_POSITION"],
            AgentType.POLICY_MAKER: ["PUBLISH_REPORT", "COORDINATE_POSITION"],
            AgentType.RATING_AGENCY: ["RATING_ACTION", "PUBLISH_REPORT"],
            AgentType.MEDIA: ["SPREAD_NARRATIVE", "SHARE_INTEL"],
        }
        
        return base_actions + type_specific.get(self.agent_type, [])
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "agent_type": self.agent_type.value,
            "beliefs": self.beliefs.to_dict(),
            "interests": {
                "primary_interests": self.interests.primary_interests,
                "secondary_interests": self.interests.secondary_interests,
                "red_lines": self.interests.red_lines,
                "risk_tolerance": self.interests.risk_tolerance,
                "time_horizon": self.interests.time_horizon,
            },
            "known_facts": list(self.known_facts),
            "private_info": self.private_info,
            "influence_weight": self.influence_weight,
            "action_repertoire": self.action_repertoire,
            "credibility": self.credibility,
            "relationships": self.relationships,
            "coalition_members": self.coalition_members,
            "round_activated": self.round_activated,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrategicAgent':
        """Create StrategicAgent from dictionary"""
        return cls(
            agent_id=data.get("agent_id", str(uuid4())),
            name=data.get("name", ""),
            agent_type=AgentType(data.get("agent_type", "CORPORATE_EXEC")),
            beliefs=BeliefState(**data.get("beliefs", {})),
            interests=InterestProfile(**data.get("interests", {})),
            known_facts=set(data.get("known_facts", [])),
            private_info=data.get("private_info", {}),
            influence_weight=data.get("influence_weight", 0.5),
            action_repertoire=data.get("action_repertoire", []),
            credibility=data.get("credibility", 0.8),
            relationships=data.get("relationships", {}),
            coalition_members=data.get("coalition_members", []),
            round_activated=data.get("round_activated", 0),
        )
