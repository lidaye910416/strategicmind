"""
BeliefEngine - Belief state tracking and updating

This service tracks and updates each agent's belief state across simulation
rounds, enabling belief evolution based on new information.

This is a core component of the strategic simulation engine, replacing
the lack of belief tracking in simpler simulators.
"""

from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass
from enum import Enum

from ..models.strategic_agent import StrategicAgent, BeliefState, BeliefPosition, FactBelief, TrustLevel


@dataclass
class BeliefUpdate:
    """Record of a belief change"""
    agent_id: str
    topic: str
    old_position: Optional[float]
    new_position: float
    confidence: float
    update_source: str
    round_num: int
    evidence: List[str]


class ConvergenceResult:
    """Result of convergence check"""
    def __init__(self, converged: bool, max_spread: float, details: str):
        self.converged = converged
        self.max_spread = max_spread
        self.details = details
    
    def to_dict(self) -> Dict:
        return {
            "converged": self.converged,
            "max_spread": self.max_spread,
            "details": self.details,
        }


class BeliefEngine:
    """
    Engine for tracking and updating agent beliefs.
    
    This engine manages belief state evolution across simulation rounds,
    supporting:
        - Position updates based on new information
        - Trust level adjustments
        - Convergence detection
        - Divergence identification
    
    Usage:
        engine = BeliefEngine()
        
        # Update belief
        update = engine.update_belief(
            agent_id="agent_1",
            topic="market_trend",
            new_value=0.8,
            update_source="news_report",
        )
        
        # Check convergence
        result = engine.check_convergence("market_trend", [agent1, agent2, agent3])
        
        # Get divergent agents
        divergent = engine.get_divergent_agents("market_trend", threshold=0.3)
    """
    
    def __init__(self):
        """Initialize BeliefEngine"""
        # Store belief history for analysis
        self._belief_history: Dict[str, List[BeliefUpdate]] = {}
    
    def update_belief(
        self,
        agent_id: str,
        topic: str,
        new_value: float,
        update_source: str,
        round_num: int = 0,
        confidence: float = 1.0,
        evidence: Optional[List[str]] = None,
        agent: Optional[StrategicAgent] = None,
    ) -> BeliefUpdate:
        """
        Update an agent's belief on a topic.
        
        Args:
            agent_id: Agent identifier
            topic: Topic/issue being updated
            new_value: New position value (-1.0 to 1.0)
            update_source: Source of the update (e.g., "news", "action", "meeting")
            round_num: Current simulation round
            confidence: Confidence in the update (0.0 to 1.0)
            evidence: Supporting evidence for the update
            agent: Optional agent object to update directly
            
        Returns:
            BeliefUpdate record of the change
        """
        # Get old position
        old_position = None
        if agent and topic in agent.beliefs.positions:
            old_position = agent.beliefs.positions[topic].position
        
        # Clamp new value to valid range
        new_value = max(-1.0, min(1.0, new_value))
        
        # Create update record
        update = BeliefUpdate(
            agent_id=agent_id,
            topic=topic,
            old_position=old_position,
            new_position=new_value,
            confidence=confidence,
            update_source=update_source,
            round_num=round_num,
            evidence=evidence or [],
        )
        
        # Update agent's belief state if agent provided
        if agent:
            agent.beliefs.update_position(
                topic=topic,
                new_position=new_value,
                confidence=confidence,
                evidence=evidence or [],
                source=update_source,
            )
        
        # Record in history
        if agent_id not in self._belief_history:
            self._belief_history[agent_id] = []
        self._belief_history[agent_id].append(update)
        
        return update
    
    def get_agent_beliefs(self, agent: StrategicAgent) -> BeliefState:
        """
        Get current belief state of an agent.
        
        Args:
            agent: StrategicAgent to query
            
        Returns:
            Current BeliefState
        """
        return agent.beliefs
    
    def get_belief_changes(
        self,
        agent_id: str,
        since_round: int = 0
    ) -> List[BeliefUpdate]:
        """
        Get belief changes for an agent since a specific round.
        
        Args:
            agent_id: Agent identifier
            since_round: Only return changes after this round (0 = all)
            
        Returns:
            List of BeliefUpdate records
        """
        history = self._belief_history.get(agent_id, [])
        if since_round > 0:
            return [u for u in history if u.round_num > since_round]
        return history
    
    def check_convergence(
        self,
        topic: str,
        agents: List[StrategicAgent],
        threshold: float = 0.2,
    ) -> ConvergenceResult:
        """
        Check if agents have converged on a topic.
        
        Convergence is measured by the spread of positions.
        If max(position) - min(position) <= threshold, agents are converged.
        
        Args:
            topic: Topic to check
            agents: List of agents to check
            threshold: Maximum acceptable spread (default 0.2)
            
        Returns:
            ConvergenceResult with convergence status
        """
        positions = []
        
        for agent in agents:
            pos = agent.beliefs.get_position(topic)
            if pos is not None:
                positions.append(pos)
        
        if len(positions) < 2:
            return ConvergenceResult(
                converged=True,
                max_spread=0.0,
                details="Not enough agents with positions on this topic",
            )
        
        max_pos = max(positions)
        min_pos = min(positions)
        spread = max_pos - min_pos
        
        converged = spread <= threshold
        
        details = f"Position spread: {spread:.3f} (threshold: {threshold:.3f})"
        if converged:
            details += f" - CONVERGED on '{topic}'"
        else:
            details += f" - DIVERGENT on '{topic}'"
        
        return ConvergenceResult(
            converged=converged,
            max_spread=spread,
            details=details,
        )
    
    def get_divergent_agents(
        self,
        topic: str,
        agents: List[StrategicAgent],
        threshold: float = 0.3,
    ) -> List[str]:
        """
        Get agents with divergent positions on a topic.
        
        An agent is considered divergent if their position differs
        significantly from the median position.
        
        Args:
            topic: Topic to check
            agents: List of agents to check
            threshold: Minimum deviation from median to be considered divergent
            
        Returns:
            List of agent IDs with divergent positions
        """
        positions = []
        agent_positions: Dict[str, float] = {}
        
        for agent in agents:
            pos = agent.beliefs.get_position(topic)
            if pos is not None:
                positions.append(pos)
                agent_positions[agent.agent_id] = pos
        
        if len(positions) < 2:
            return []
        
        # Calculate median
        sorted_positions = sorted(positions)
        n = len(sorted_positions)
        if n % 2 == 0:
            median = (sorted_positions[n//2 - 1] + sorted_positions[n//2]) / 2
        else:
            median = sorted_positions[n//2]
        
        # Find divergent agents
        divergent_ids = []
        for agent_id, pos in agent_positions.items():
            if abs(pos - median) > threshold:
                divergent_ids.append(agent_id)
        
        return divergent_ids
    
    def update_trust(
        self,
        agent: StrategicAgent,
        target_id: str,
        trust_delta: float,
        round_num: int = 0,
    ) -> None:
        """
        Update trust level between two agents.
        
        Args:
            agent: Agent whose trust is being updated
            target_id: ID of the agent being trusted/distrusted
            trust_delta: Change in trust (-1.0 to 1.0)
            round_num: Current round number
        """
        current = agent.beliefs.trust_levels.get(target_id)
        
        if current:
            new_score = current.trust_score + trust_delta
        else:
            new_score = trust_delta
        
        # Clamp to valid range
        new_score = max(-1.0, min(1.0, new_score))
        
        agent.beliefs.update_trust(target_id, new_score)
        
        # Update last_updated if tracking
        if target_id in agent.beliefs.trust_levels:
            agent.beliefs.trust_levels[target_id].last_updated = round_num
    
    def apply_action_effects(
        self,
        agent: StrategicAgent,
        action_type: str,
        target_positions: Dict[str, float],
        round_num: int,
    ) -> List[BeliefUpdate]:
        """
        Apply the belief effects of another agent's action.
        
        This is called when an agent observes another agent's action
        and may update their beliefs based on it.
        
        Args:
            agent: Agent whose beliefs may be updated
            action_type: Type of action observed
            target_positions: Belief positions influenced by this action
            round_num: Current simulation round
            
        Returns:
            List of belief updates applied
        """
        updates = []
        
        # Update trust based on action type
        trust_effects = {
            "MAKE_STATEMENT": 0.05,
            "PUBLISH_REPORT": 0.1,
            "PRIVATE_MEETING": -0.05,
            "LEAK_INFORMATION": -0.15,
            "TRADE_ASSET": 0.0,
            "PROPOSE_DEAL": 0.1,
        }
        
        for topic, position_change in target_positions.items():
            # Apply position update
            current_pos = agent.beliefs.get_position(topic) or 0.0
            new_pos = current_pos + position_change
            
            update = self.update_belief(
                agent_id=agent.agent_id,
                topic=topic,
                new_value=new_pos,
                update_source=f"action_{action_type}",
                round_num=round_num,
                confidence=0.8,  # Observed actions have high confidence
            )
            updates.append(update)
        
        return updates
    
    def get_belief_summary(self, agent: StrategicAgent) -> Dict:
        """
        Get a summary of an agent's belief state.
        
        Args:
            agent: Agent to summarize
            
        Returns:
            Dictionary with belief summary
        """
        positions = agent.beliefs.positions
        
        return {
            "agent_id": agent.agent_id,
            "agent_name": agent.name,
            "total_positions": len(positions),
            "topics": list(positions.keys()),
            "avg_confidence": sum(p.confidence for p in positions.values()) / max(len(positions), 1),
            "trust_relationships": len(agent.beliefs.trust_levels),
            "expectations": len(agent.beliefs.expectations),
        }
    
    def clear_history(self) -> None:
        """Clear belief history (for new simulation)"""
        self._belief_history.clear()
