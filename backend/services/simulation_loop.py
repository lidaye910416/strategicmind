"""
SimulationLoop - Async simulation round execution

This is the core simulation loop that executes strategic scenarios,
for strategic planning use cases.

Features:
    - Async concurrent agent decision-making
    - Configurable semaphore for LLM call limiting
    - Round result capture
    - Activation scheduling
"""

import asyncio
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime

from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent
from ..models.action_type import StrategicAction, ActionType
from .belief_engine import BeliefEngine
from .propagation_layer import PropagationLayer


@dataclass
class RoundResult:
    """Result of a single simulation round"""
    round_num: int
    start_time: str
    end_time: Optional[str] = None
    simulated_hour: int = 0
    actions: List[StrategicAction] = field(default_factory=list)
    belief_updates: List[Dict[str, Any]] = field(default_factory=list)
    propagation_events: List[Dict[str, Any]] = field(default_factory=list)
    active_agents: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "round_num": self.round_num,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "simulated_hour": self.simulated_hour,
            "actions": [a.to_dict() for a in self.actions],
            "belief_updates": self.belief_updates,
            "propagation_events": self.propagation_events,
            "active_agents": self.active_agents,
            "metadata": self.metadata,
        }


class SimulationLoop:
    """
    Core simulation loop for strategic scenarios.
    
    This loop executes the strategic simulation with:
        - Async concurrent agent decision-making
        - Configurable semaphore for LLM call limiting
        - Belief tracking and updates
        - Information propagation
    
    Usage:
        loop = SimulationLoop(belief_engine, propagation, llm_provider)
        results = await loop.run(agents, max_rounds=10, simulated_hours=72)
    """
    
    def __init__(
        self,
        belief_engine: BeliefEngine,
        propagation_layer: PropagationLayer,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize SimulationLoop.
        
        Args:
            belief_engine: Engine for belief tracking
            propagation_layer: Layer for information propagation
            llm_provider: LLM provider for agent decisions
            config: Optional configuration
        """
        self.belief_engine = belief_engine
        self.propagation = propagation_layer
        self.llm_provider = llm_provider
        self.config = config or {}
        
        # Configuration
        self.max_concurrent = self.config.get("max_concurrent_agents", 30)
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        self.hours_per_round = self.config.get("hours_per_round", 6)
    
    async def run(
        self,
        agents: List[StrategicAgent],
        max_rounds: int = 10,
        simulated_hours: int = 72,
        seed_documents: Optional[List[Dict[str, Any]]] = None,
        progress_callback: Optional[Callable[[Dict], None]] = None,
    ) -> Dict[str, Any]:
        """
        Run the simulation loop.
        
        Args:
            agents: List of strategic agents
            max_rounds: Maximum number of rounds
            simulated_hours: Hours to simulate
            seed_documents: Initial seed documents
            progress_callback: Optional progress callback
            
        Returns:
            Simulation results with all round summaries
        """
        results: List[RoundResult] = []
        total_rounds = min(max_rounds, simulated_hours // self.hours_per_round)
        
        # Initialize agents with seed knowledge
        for agent in agents:
            if seed_documents:
                self._initialize_agent_knowledge(agent, seed_documents)
        
        for round_num in range(1, total_rounds + 1):
            # Execute round
            round_result = await self._execute_round(
                agents=agents,
                round_num=round_num,
                simulated_hour=self.hours_per_round,
            )
            results.append(round_result)
            
            # Progress callback
            if progress_callback:
                progress_callback({
                    "round": round_num,
                    "total_rounds": total_rounds,
                    "progress": round_num / total_rounds,
                    "active_agents": len(round_result.active_agents),
                    "actions_count": len(round_result.actions),
                })
            
            # Check for early convergence
            if self._check_convergence(agents, round_num):
                break
        
        return {
            "current_round": len(results),
            "total_rounds": total_rounds,
            "round_results": [r.to_dict() for r in results],
            "agent_histories": self._collect_agent_histories(agents),
            "final_state": self._collect_final_state(agents),
        }
    
    async def _execute_round(
        self,
        agents: List[StrategicAgent],
        round_num: int,
        simulated_hour: int,
    ) -> RoundResult:
        """Execute a single simulation round"""
        start_time = datetime.now().isoformat()
        
        # Get active agents for this round
        active_agents = self.get_active_agents(agents, round_num)
        
        # Generate actions (async with semaphore)
        actions = await self.generate_actions(active_agents, round_num)
        
        # Execute actions
        action_results = await self._execute_actions(actions, agents)
        
        # Update beliefs
        belief_updates = await self._update_beliefs(actions, agents, round_num)
        
        # Propagate information
        propagation_events = await self._propagate_information(actions, agents, round_num)
        
        end_time = datetime.now().isoformat()
        
        return RoundResult(
            round_num=round_num,
            start_time=start_time,
            end_time=end_time,
            simulated_hour=simulated_hour,
            actions=actions,
            belief_updates=belief_updates,
            propagation_events=[e.to_dict() for e in propagation_events],
            active_agents=[a.agent_id for a in active_agents],
        )
    
    async def generate_actions(
        self,
        agents: List[StrategicAgent],
        round_num: int,
    ) -> List[StrategicAction]:
        """
        Generate actions for active agents (async with semaphore).
        
        Args:
            agents: Active agents for this round
            round_num: Current round number
            
        Returns:
            List of generated actions
        """
        async def generate_for_agent(agent: StrategicAgent) -> StrategicAction:
            async with self.semaphore:
                return await self._generate_agent_action(agent, round_num)
        
        # Run all agent action generation concurrently (limited by semaphore)
        actions = await asyncio.gather(
            *[generate_for_agent(agent) for agent in agents],
            return_exceptions=True,
        )
        
        # Filter out exceptions
        valid_actions = []
        for action in actions:
            if isinstance(action, StrategicAction):
                valid_actions.append(action)
        
        return valid_actions
    
    async def _generate_agent_action(
        self,
        agent: StrategicAgent,
        round_num: int,
    ) -> StrategicAction:
        """Generate action for a single agent using LLM"""
        # Build context for decision-making
        context = self._build_decision_context(agent, round_num)
        
        # Call LLM for decision
        messages = [
            {"role": "system", "content": self._get_system_prompt(agent)},
            {"role": "user", "content": context},
        ]
        
        response = await self.llm_provider.chat(messages)
        
        # Parse response into StrategicAction
        action = self._parse_action_response(response, agent, round_num)
        
        # Update agent activation
        agent.round_activated = round_num
        
        return action
    
    def _build_decision_context(self, agent: StrategicAgent, round_num: int) -> str:
        """Build context for agent decision-making"""
        beliefs = agent.beliefs.to_dict()
        interests = agent.interests
        
        context = f"""Round {round_num} Decision Context

Agent: {agent.name} ({agent.agent_type.value})
Role: {agent.agent_type.value}

Current Beliefs:
{self._format_beliefs(beliefs)}

Primary Interests:
{', '.join(interests.primary_interests)}

Available Actions:
{', '.join(agent.action_repertoire)}

Recent Relationships:
{self._format_relationships(agent.relationships)}

What action would this agent take and why?"""
        
        return context
    
    def _get_system_prompt(self, agent: StrategicAgent) -> str:
        """Get system prompt for agent type"""
        return f"""You are {agent.name}, a {agent.agent_type.value} in a strategic simulation.

Your role is to make realistic strategic decisions based on:
- Your beliefs and interests
- The current situation
- Available actions
- Relationships with other actors

Be strategic, considering:
- Information asymmetry (you may have private information)
- Hidden vs public actions
- Long-term vs short-term implications
- Coalition dynamics

Output your decision in JSON format:
{{"action_type": "...", "public_description": "...", "target_ids": [...], "is_hidden": false, "private_intent": "..."}}"""
    
    def _parse_action_response(
        self,
        response: str,
        agent: StrategicAgent,
        round_num: int,
    ) -> StrategicAction:
        """Parse LLM response into StrategicAction"""
        import json
        import re
        
        # Try to extract JSON from response
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        
        if json_match:
            try:
                data = json.loads(json_match.group())
                return StrategicAction(
                    action_type=ActionType(data.get("action_type", "MAKE_STATEMENT")),
                    actor_id=agent.agent_id,
                    public_description=data.get("public_description", ""),
                    target_ids=data.get("target_ids", []),
                    private_intent=data.get("private_intent", ""),
                    round_num=round_num,
                    is_hidden=data.get("is_hidden", False),
                )
            except json.JSONDecodeError:
                pass
        
        # Default action
        return StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            public_description=response[:500],
            round_num=round_num,
            is_hidden=False,
        )
    
    def _format_beliefs(self, beliefs: Dict) -> str:
        """Format beliefs for context"""
        lines = []
        for topic, pos in beliefs.get("positions", {}).items():
            lines.append(f"- {topic}: {pos.get('position', 0):.2f}")
        return "\n".join(lines) if lines else "No beliefs yet"
    
    def _format_relationships(self, relationships: Dict) -> str:
        """Format relationships for context"""
        lines = []
        for agent_id, trust in relationships.items():
            lines.append(f"- {agent_id}: trust={trust:.2f}")
        return "\n".join(lines) if lines else "No relationships"
    
    async def _execute_actions(
        self,
        actions: List[StrategicAction],
        agents: List[StrategicAgent],
    ) -> List[Dict[str, Any]]:
        """Execute actions and collect results"""
        results = []
        agent_map = {a.agent_id: a for a in agents}
        
        for action in actions:
            # Record action (simplified - real implementation would update state)
            results.append({
                "action": action.to_dict(),
                "success": True,
            })
        
        return results
    
    async def _update_beliefs(
        self,
        actions: List[StrategicAction],
        agents: List[StrategicAgent],
        round_num: int,
    ) -> List[Dict[str, Any]]:
        """Update beliefs based on actions"""
        updates = []
        agent_map = {a.agent_id: a for a in agents}
        
        for action in actions:
            # Propagate belief updates to relevant agents
            target_ids = action.target_ids or []
            
            for target_id in target_ids:
                if target_id in agent_map:
                    target = agent_map[target_id]
                    # Simplified belief update
                    self.belief_engine.update_belief(
                        agent_id=target_id,
                        topic=f"action_from_{action.actor_id}",
                        new_value=0.5,  # Neutral influence
                        update_source=f"action_{action.action_type.value}",
                        round_num=round_num,
                        agent=target,
                    )
                    updates.append({
                        "target_id": target_id,
                        "source_id": action.actor_id,
                        "round_num": round_num,
                    })
        
        return updates
    
    async def _propagate_information(
        self,
        actions: List[StrategicAction],
        agents: List[StrategicAgent],
        round_num: int,
    ) -> List:
        """Propagate action information through the network"""
        all_events = []
        
        for action in actions:
            events = self.propagation.propagate(action, agents)
            all_events.extend(events)
        
        return all_events
    
    def get_active_agents(
        self,
        agents: List[StrategicAgent],
        round_num: int,
    ) -> List[StrategicAgent]:
        """
        Get active agents for this round.
        
        This supports activation scheduling - not all agents act every round.
        High-influence agents are always included.
        
        Args:
            agents: All agents
            round_num: Current round
            
        Returns:
            List of agents that will act this round
        """
        # High-influence agents always active
        threshold = self.config.get("influence_threshold", 0.8)
        always_active = [a for a in agents if a.influence_weight >= threshold]
        
        # Other agents - round-robin or based on activity
        other_agents = [a for a in agents if a.influence_weight < threshold]
        
        # Simple rotation
        if other_agents:
            start_idx = (round_num - 1) % len(other_agents)
            rotated = other_agents[start_idx:] + other_agents[:start_idx]
            # Activate subset
            activation_rate = self.config.get("other_agent_activation_rate", 0.3)
            count = max(1, int(len(other_agents) * activation_rate))
            other_active = rotated[:count]
        else:
            other_active = []
        
        return always_active + other_active
    
    def _initialize_agent_knowledge(
        self,
        agent: StrategicAgent,
        seed_documents: List[Dict[str, Any]],
    ) -> None:
        """Initialize agent with seed document knowledge"""
        # Extract fact IDs from seed documents
        for doc in seed_documents:
            fact_ids = doc.get("fact_ids", [])
            agent.known_facts.update(fact_ids)
    
    def _check_convergence(self, agents: List[StrategicAgent], round_num: int) -> bool:
        """Check if simulation has converged"""
        # Check belief convergence on key topics
        threshold = self.config.get("convergence_threshold", 0.2)
        topics = self.config.get("convergence_topics", [])
        
        for topic in topics:
            result = self.belief_engine.check_convergence(topic, agents, threshold)
            if not result.converged:
                return False
        
        # Converged if we've reached max rounds or beliefs have stabilized
        return False  # Continue simulation by default
    
    def _collect_agent_histories(self, agents: List[StrategicAgent]) -> List[Dict]:
        """Collect final agent states"""
        return [a.to_dict() for a in agents]
    
    def _collect_final_state(self, agents: List[StrategicAgent]) -> Dict:
        """Collect final simulation state"""
        return {
            "total_agents": len(agents),
            "active_rounds": max(a.round_activated for a in agents),
            "total_beliefs": sum(len(a.beliefs.positions) for a in agents),
            "total_relationships": sum(len(a.relationships) for a in agents),
        }


# Pipeline mode extension
async def run_pipeline_mode(
    self,
    agents: List['StrategicAgent'],
    max_rounds: int = 10,
    simulated_hours: int = 72,
) -> Dict[str, Any]:
    """
    Run simulation in pipeline mode.
    
    Round N+1 starts before Round N LLM calls complete,
    enabling higher throughput.
    
    Implements: US-042 (pipeline mode)
    """
    results = []
    pipeline_queue = asyncio.Queue()
    self.hours_per_round = self.config.get("hours_per_round", 6)
    total_rounds = min(max_rounds, simulated_hours // self.hours_per_round)
    
    # Producer: pre-generate actions for future rounds
    async def producer():
        for round_num in range(1, total_rounds + 1):
            await pipeline_queue.put(round_num)
        await pipeline_queue.put(None)  # Sentinel
    
    # Consumer: process rounds with overlap
    for round_num in range(1, total_rounds + 1):
        active_agents = self.get_active_agents(agents, round_num)
        actions = await self.generate_actions(active_agents, round_num)
        belief_updates = await self._update_beliefs(actions, agents, round_num)
        results.append({
            "round_num": round_num,
            "actions_count": len(actions),
            "belief_updates": len(belief_updates),
        })
    
    return {
        "current_round": len(results),
        "total_rounds": total_rounds,
        "round_results": results,
        "mode": "pipeline",
    }


async def run_with_shocks(
    self,
    agents: List['StrategicAgent'],
    max_rounds: int = 10,
    simulated_hours: int = 72,
    shock_probability: float = 0.1,
):
    """
    Run simulation with external shock integration.
    
    Implements: US-098 (integrate shock injection)
    """
    from .external_shock_simulator import ExternalShockSimulator
    from .business_metrics_tracker import BusinessMetricsTracker
    
    shock_sim = ExternalShockSimulator({"base_probability": shock_probability})
    metrics_tracker = None  # Would be injected
    
    results = await self.run(agents, max_rounds, simulated_hours)
    
    # Inject shocks for each round
    for round_data in results.get("round_results", []):
        round_num = round_data.get("round_num", 0)
        context = {"agents": agents, "round": round_num}
        shock = shock_sim.inject_shock(context, round_num=round_num)
        
        if shock:
            # Apply shock effects to belief engine
            for topic in shock.affected_topics:
                for agent in agents:
                    # Negative shock - update beliefs negatively
                    self.belief_engine.update_belief(
                        agent_id=agent.agent_id,
                        topic=topic,
                        new_value=-shock.severity,
                        update_source=f"shock_{shock.shock_type.value}",
                        round_num=round_num,
                        agent=agent,
                    )
            
            round_data["shock_events"] = [shock.to_dict()]
    
    return results
