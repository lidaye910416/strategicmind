"""
BeliefEngine - Belief state tracking and updating

This service tracks and updates each agent's belief state across simulation
rounds, enabling belief evolution based on new information.

This is a core component of the strategic simulation engine, replacing
the lack of belief tracking in simpler simulators.
"""

import logging
from typing import Any, Dict, List, Optional, Set, Tuple
from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel, Field, ValidationError, field_validator

from ..models.strategic_agent import StrategicAgent, BeliefState, BeliefPosition, FactBelief, TrustLevel

logger = logging.getLogger(__name__)


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


# ---------------------------------------------------------------------------
# BeliefEffectProposal — pydantic-validated LLM-side belief/trust deltas.
# ---------------------------------------------------------------------------


class BeliefEffectProposal(BaseModel):
    """LLM 同步返回的 belief / trust 变化建议, 替代 v1 硬编码 trust_effects.

    Bug #2 root cause 2.3: v1 ``_update_beliefs`` 写死 ``new_value=0.5``,
    把 LLM 给的 ``target_positions`` 全部丢弃; ``trust_effects`` 是常量表.
    本 dataclass 让 LLM 同时返回 position_deltas + trust_deltas, 由
    ``apply_action_effects`` 消费.

    Anti-MiroFish anti-pattern 3.3: pydantic 校验失败 ->
    ``BeliefEngine._proposal_parse_failures`` +1, 该 round belief
    不更新, 不让一条坏 LLM 响应拖垮整轮.
    """

    position_deltas: Dict[str, float] = Field(default_factory=dict)
    trust_deltas: Dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""

    @field_validator("position_deltas", "trust_deltas")
    @classmethod
    def _clamp_each(cls, v: Dict[str, float]) -> Dict[str, float]:
        # MiroFish 30% stringified-JSON bug 防御.
        if not isinstance(v, dict):
            raise ValueError("expected dict[str, float]")
        return {str(k): max(-1.0, min(1.0, float(val))) for k, val in v.items()}

    @classmethod
    def safe_parse(cls, raw: Any) -> "BeliefEffectProposal":
        """Defensive: empty / non-dict / non-numeric values -> empty proposal."""
        try:
            return cls.model_validate(raw or {})
        except (ValidationError, TypeError, ValueError) as exc:
            logger.warning("BeliefEffectProposal parse failure: %s", exc)
            try:
                BeliefEngine._proposal_parse_failures += 1
            except Exception:
                pass
            return cls(reasoning=f"parse_fallback: {exc}")


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
        # Bug #2: track pydantic parse failures for BeliefEffectProposal
        # so a bad LLM response doesn't silently corrupt a round.
        self._proposal_parse_failures: int = 0
    
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
        proposal: Optional["BeliefEffectProposal"] = None,
    ) -> List[BeliefUpdate]:
        """
        Apply the belief effects of another agent's action.

        v2 path (``proposal`` is provided): use the LLM's proposed
        position_deltas + trust_deltas. Replaces v1 hardcoded
        ``trust_effects`` table and the silent ``target_positions``
        discard (Bug #2 root cause 2.3).

        v1 path (no ``proposal``): preserve the original behaviour
        with the constant trust_effects table. Existing call-sites
        that pass only the legacy args continue to work.

        Args:
            agent: Agent whose beliefs may be updated.
            action_type: Type of action observed (v1 enum or v2 string).
            target_positions: Legacy v1 position deltas (used in v1 path).
            round_num: Current simulation round.
            proposal: Optional v2 ``BeliefEffectProposal`` with
                LLM-proposed deltas; when present, takes precedence
                over the legacy arguments.

        Returns:
            List of belief updates applied.
        """
        updates: List[BeliefUpdate] = []

        if proposal is not None:
            # v2 path — use LLM-suggested deltas.
            for topic, delta in (proposal.position_deltas or {}).items():
                current = float(agent.beliefs.get_position(topic) or 0.0)
                new_pos = max(-1.0, min(1.0, current + float(delta)))
                upd = self.update_belief(
                    agent_id=agent.agent_id,
                    topic=str(topic),
                    new_value=new_pos,
                    update_source=f"action_{action_type}",
                    round_num=round_num,
                    confidence=0.8,
                )
                updates.append(upd)
            # Trust deltas from the LLM (v1 had a hardcoded table).
            for other_id, delta in (proposal.trust_deltas or {}).items():
                if other_id == agent.agent_id:
                    continue
                if other_id not in agent.beliefs.trust_levels:
                    agent.beliefs.trust_levels[other_id] = TrustLevel(
                        agent_id=other_id, trust_score=0.5, last_updated=round_num,
                    )
                current_trust = float(
                    agent.beliefs.trust_levels[other_id].trust_score
                )
                new_trust = max(-1.0, min(1.0, current_trust + float(delta)))
                agent.beliefs.trust_levels[other_id].trust_score = new_trust
                agent.beliefs.trust_levels[other_id].last_updated = round_num
            return updates

        # v1 path — preserved for backward compat.
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
