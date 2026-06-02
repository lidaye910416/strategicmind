"""
PropagationLayer - Information spread modeling

This layer models how information spreads through the agent network,
supporting multiple propagation channels.
"""

from typing import Dict, List, Any, Optional, Set
from dataclasses import dataclass
from enum import Enum

from ..models.action_type import StrategicAction, PropagationChannel
from ..models.strategic_agent import StrategicAgent


@dataclass
class PropagationEvent:
    """An event of information propagation"""
    action: StrategicAction
    channel: PropagationChannel
    source_id: str
    target_ids: List[str]
    content: str
    round_num: int
    is_public: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action.to_dict(),
            "channel": self.channel.value,
            "source_id": self.source_id,
            "target_ids": self.target_ids,
            "content": self.content,
            "round_num": self.round_num,
            "is_public": self.is_public,
        }


@dataclass
class KnowledgeBoundary:
    """An agent's knowledge boundary at a point in time"""
    agent_id: str
    known_facts: Set[str]
    round_num: int


class PropagationLayer:
    """
    Models information spread through the agent network.
    
    This layer handles multiple propagation channels:
        - DIRECT: Direct communication between agents
        - MEDIA: Traditional media reporting
        - SOCIAL_MEDIA: Social platform传播
        - MARKET_SIGNAL: Market indicator signals
        - RUMOR: Informal gossip
        - OFFICIAL: Official channels
    
    Usage:
        propagation = PropagationLayer()
        events = propagation.propagate(action, agents, config)
        boundary = propagation.get_agent_knowledge_boundary(agent_id, round)
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize PropagationLayer.
        
        Args:
            config: Optional configuration
        """
        self.config = config or {}
        self._knowledge_boundaries: Dict[str, List[KnowledgeBoundary]] = {}
        self._propagation_history: List[PropagationEvent] = []
        
        # Channel weights
        self.channel_weights = {
            PropagationChannel.DIRECT: 0.9,
            PropagationChannel.MEDIA: 0.7,
            PropagationChannel.SOCIAL_MEDIA: 0.6,
            PropagationChannel.MARKET_SIGNAL: 0.5,
            PropagationChannel.RUMOR: 0.3,
            PropagationChannel.OFFICIAL: 0.8,
        }
    
    def propagate(
        self,
        action: StrategicAction,
        agents: List[StrategicAgent],
        config: Optional[Dict[str, Any]] = None
    ) -> List[PropagationEvent]:
        """
        Propagate an action through the network.
        
        Args:
            action: The action to propagate
            agents: All agents in the simulation
            config: Optional propagation configuration
            
        Returns:
            List of PropagationEvent objects
        """
        events = []
        config = config or {}
        
        # Determine which agents receive the information
        target_agents = self._get_target_agents(action, agents, config)
        
        # Propagate through each channel
        for channel in action.propagation_channels:
            weight = self.channel_weights.get(channel, 0.5)
            
            # Filter agents by channel
            channel_targets = self._filter_by_channel(target_agents, channel, action)
            
            if channel_targets:
                event = PropagationEvent(
                    action=action,
                    channel=channel,
                    source_id=action.actor_id,
                    target_ids=[a.agent_id for a in channel_targets],
                    content=action.public_description,
                    round_num=action.round_num,
                    is_public=action.is_hidden is False,
                )
                events.append(event)
                self._propagation_history.append(event)
        
        # Update knowledge boundaries
        self._update_knowledge_boundaries(action, target_agents)
        
        return events
    
    def _get_target_agents(
        self,
        action: StrategicAction,
        agents: List[StrategicAgent],
        config: Dict[str, Any]
    ) -> List[StrategicAgent]:
        """Determine which agents should receive the action"""
        # If action has explicit targets, prioritize them
        if action.target_ids:
            target_ids_set = set(action.target_ids)
            return [a for a in agents if a.agent_id in target_ids_set]
        
        # Otherwise, use influence-based targeting
        min_influence = config.get("min_influence", 0.1)
        return [a for a in agents if a.influence_weight >= min_influence]
    
    def _filter_by_channel(
        self,
        agents: List[StrategicAgent],
        channel: PropagationChannel,
        action: StrategicAction
    ) -> List[StrategicAgent]:
        """Filter agents based on channel relevance"""
        # Agent type affinity to channels
        channel_affinity = {
            PropagationChannel.DIRECT: ["*"],  # All agents
            PropagationChannel.MEDIA: ["MEDIA", "ANALYST", "ADVOCACY"],
            PropagationChannel.SOCIAL_MEDIA: ["*"],  # All agents
            PropagationChannel.MARKET_SIGNAL: ["INSTITUTIONAL_INVESTOR", "CORPORATE_EXEC"],
            PropagationChannel.RUMOR: ["*"],
            PropagationChannel.OFFICIAL: ["POLICY_MAKER", "REGULATOR"],
        }
        
        relevant_types = channel_affinity.get(channel, ["*"])
        
        if "*" in relevant_types:
            return agents
        
        return [
            a for a in agents
            if a.agent_type.value in relevant_types or str(a.agent_type) in relevant_types
        ]
    
    def _update_knowledge_boundaries(
        self,
        action: StrategicAction,
        agents: List[StrategicAgent]
    ) -> None:
        """Update knowledge boundaries for agents who received the action"""
        # Extract fact IDs from action (simplified - real implementation would parse)
        fact_ids = self._extract_fact_ids(action)
        
        for agent in agents:
            if agent.agent_id not in self._knowledge_boundaries:
                self._knowledge_boundaries[agent.agent_id] = []
            
            # Add current knowledge state
            boundary = KnowledgeBoundary(
                agent_id=agent.agent_id,
                known_facts=agent.known_facts | set(fact_ids),
                round_num=action.round_num,
            )
            self._knowledge_boundaries[agent.agent_id].append(boundary)
    
    def _extract_fact_ids(self, action: StrategicAction) -> List[str]:
        """Extract fact IDs from action metadata"""
        # Simplified - real implementation would parse action content
        return action.metadata.get("fact_ids", [])
    
    def get_agent_knowledge_boundary(
        self,
        agent_id: str,
        round_num: Optional[int] = None
    ) -> Set[str]:
        """
        Get the facts known to an agent at a given round.
        
        Args:
            agent_id: Agent identifier
            round_num: Specific round (None = latest)
            
        Returns:
            Set of known fact IDs
        """
        boundaries = self._knowledge_boundaries.get(agent_id, [])
        
        if not boundaries:
            return set()
        
        if round_num is None:
            # Return latest
            return boundaries[-1].known_facts
        
        # Find boundary at or before the round
        for boundary in reversed(boundaries):
            if boundary.round_num <= round_num:
                return boundary.known_facts
        
        return set()
    
    def get_propagation_events(
        self,
        round_start: int = 0,
        round_end: Optional[int] = None
    ) -> List[PropagationEvent]:
        """Get propagation events in a round range"""
        events = []
        for event in self._propagation_history:
            if event.round_num >= round_start:
                if round_end is None or event.round_num <= round_end:
                    events.append(event)
        return events
    
    def get_channel_statistics(self) -> Dict[str, int]:
        """Get statistics by channel"""
        stats = {c.value: 0 for c in PropagationChannel}
        for event in self._propagation_history:
            stats[event.channel.value] += 1
        return stats
    
    def clear(self) -> None:
        """Clear propagation state"""
        self._knowledge_boundaries.clear()
        self._propagation_history.clear()
