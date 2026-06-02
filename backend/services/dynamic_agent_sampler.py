"""
DynamicAgentSampler - Adaptive agent sampling for each round

Selects relevant agent subset each round to reduce noise
while maintaining diversity.

Target: 20% sample achieves >= 70% opinion coverage vs full set.

Implements: US-048
"""

import random
from typing import List, Dict, Any
from collections import Counter

from ..models.strategic_agent import StrategicAgent


class DynamicAgentSampler:
    """
    Adaptive agent sampler for simulation rounds.
    
    Features:
        - High-influence agents always included
        - Inactive agents down-weighted
        - Entity type diversity maintained
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.high_influence_threshold = self.config.get("high_influence_threshold", 0.7)
        self.diversity_minimum = self.config.get("diversity_minimum", 1)  # Min agents per type
    
    def sample_for_round(
        self,
        all_agents: List[StrategicAgent],
        round_history: List[Dict[str, Any]],
        target_size: int,
    ) -> List[StrategicAgent]:
        """
        Sample agents for a round.
        
        Args:
            all_agents: All available agents
            round_history: Previous round histories
            target_size: Target number of agents to sample
            
        Returns:
            List of sampled agents
        """
        if target_size >= len(all_agents):
            return all_agents
        
        # Step 1: Always include high-influence agents
        high_influence = [
            a for a in all_agents
            if a.influence_weight >= self.high_influence_threshold
        ]
        
        sampled = list(high_influence)
        remaining_needed = target_size - len(sampled)
        
        if remaining_needed <= 0:
            return sampled[:target_size]
        
        # Step 2: Identify active vs inactive agents
        active_agent_ids = set()
        for round_data in round_history[-3:]:  # Last 3 rounds
            for action in round_data.get("actions", []):
                if isinstance(action, dict):
                    active_agent_ids.add(action.get("actor_id"))
        
        # Step 3: Score remaining agents
        candidates = [a for a in all_agents if a not in sampled]
        scored = []
        for agent in candidates:
            score = self._score_agent(agent, active_agent_ids, round_history)
            scored.append((score, agent))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        
        # Step 4: Ensure entity type diversity
        type_counter = Counter(a.agent_type.value for a in sampled)
        
        for score, agent in scored:
            if len(sampled) >= target_size:
                break
            # Add if underrepresented
            if type_counter[agent.agent_type.value] < self.diversity_minimum * 2:
                sampled.append(agent)
                type_counter[agent.agent_type.value] += 1
        
        # Fill remaining with top-scored agents
        if len(sampled) < target_size:
            for score, agent in scored:
                if len(sampled) >= target_size:
                    break
                if agent not in sampled:
                    sampled.append(agent)
        
        return sampled
    
    def _score_agent(
        self,
        agent: StrategicAgent,
        active_agent_ids: set,
        round_history: List[Dict[str, Any]],
    ) -> float:
        """Score an agent for sampling priority"""
        score = 0.0
        
        # Active recently
        if agent.agent_id in active_agent_ids:
            score += 0.5
        
        # Influence weight
        score += agent.influence_weight * 0.3
        
        # Belief diversity (number of positions)
        score += min(len(agent.beliefs.positions) / 10.0, 0.2)
        
        return score
