"""
LLMDecisionEngine - LLM-driven agent action generation

This engine drives each agent's decision-making using LLM,
supporting strategic action types beyond social media.
"""

from typing import Dict, List, Any, Optional
import json
import re

from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent
from ..models.action_type import StrategicAction, ActionType


class LLMDecisionEngine:
    """
    LLM-driven decision engine for strategic agents.
    
    This engine generates agent decisions based on:
        - Agent's beliefs, interests, and knowledge
        - Current situation and context
        - Available actions in repertoire
    
    Usage:
        engine = LLMDecisionEngine(llm_provider)
        action = await engine.decide_action(agent, round_num)
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize LLMDecisionEngine.
        
        Args:
            llm_provider: LLM provider for decision generation
            config: Optional configuration
        """
        self.llm_provider = llm_provider
        self.config = config or {}
        
        # Default action types for strategic scenarios
        self.default_action_types = [
            "MAKE_STATEMENT",
            "PRIVATE_MEETING",
            "PROPOSE_DEAL",
            "TRADE_ASSET",
            "PUBLISH_REPORT",
            "COORDINATE_POSITION",
        ]
    
    async def decide_action(
        self,
        agent: StrategicAgent,
        round_num: int,
        context: Optional[Dict[str, Any]] = None,
    ) -> StrategicAction:
        """
        Generate a decision for an agent.
        
        Args:
            agent: The agent making a decision
            round_num: Current simulation round
            context: Optional additional context
            
        Returns:
            StrategicAction representing the agent's decision
        """
        # Build system prompt based on agent type
        system_prompt = self._build_system_prompt(agent)
        
        # Build user prompt with situation context
        user_prompt = self._build_user_prompt(agent, round_num, context)
        
        # Call LLM
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        
        response = await self.llm_provider.chat(
            messages,
            temperature=self.config.get("temperature", 0.7),
            max_tokens=self.config.get("max_tokens", 1000),
        )
        
        # Parse response into StrategicAction
        action = self._parse_decision_response(response, agent, round_num)
        
        return action
    
    def _build_system_prompt(self, agent: StrategicAgent) -> str:
        """Build system prompt for agent type"""
        base_prompt = f"""You are {agent.name}, a {agent.agent_type.value} in a strategic simulation.

Your characteristics:
- Influence weight: {agent.influence_weight:.2f}
- Credibility: {agent.credibility:.2f}

Your interests:
- Primary: {', '.join(agent.interests.primary_interests) or 'None specified'}
- Secondary: {', '.join(agent.interests.secondary_interests) or 'None specified'}
- Red lines: {', '.join(agent.interests.red_lines) or 'None specified'}

Your available actions: {', '.join(agent.action_repertoire)}

Consider:
1. Information asymmetry - you may have private information others don't
2. Hidden vs public actions - some actions can be concealed
3. Long-term vs short-term tradeoffs
4. Relationship dynamics with other actors
5. Regulatory and disclosure requirements"""
        
        return base_prompt
    
    def _build_user_prompt(
        self,
        agent: StrategicAgent,
        round_num: int,
        context: Optional[Dict[str, Any]],
    ) -> str:
        """Build user prompt with situation context"""
        prompt = f"""## Round {round_num} Decision

### Current Beliefs
{self._format_beliefs(agent.beliefs)}

### Known Facts
{', '.join(list(agent.known_facts)[:10]) if agent.known_facts else 'No known facts'}

### Key Relationships"""
        
        if agent.relationships:
            for other_id, trust in list(agent.relationships.items())[:5]:
                prompt += f"\n- {other_id}: trust={trust:.2f}"
        else:
            prompt += "\n- No significant relationships"
        
        if agent.coalition_members:
            prompt += f"\n### Coalition Members: {', '.join(agent.coalition_members)}"
        
        if context:
            prompt += f"\n### Current Situation\n{context.get('situation', 'No additional context')}"
        
        prompt += """

### Your Decision
Based on your role, interests, and the current situation, what action do you take?

Output in JSON format:
```json
{
  "action_type": "ACTION_TYPE",
  "public_description": "What you say/do publicly",
  "target_ids": ["agent_id1", "agent_id2"],
  "is_hidden": false,
  "private_intent": "Your hidden goal (if any)"
}
```

Available action types: MAKE_STATEMENT, PRIVATE_MEETING, PROPOSE_DEAL, TRADE_ASSET, PUBLISH_REPORT, COORDINATE_POSITION, SHARE_INTEL, FORM_COALITION

Respond with ONLY the JSON."""
        
        return prompt
    
    def _format_beliefs(self, beliefs) -> str:
        """Format beliefs for prompt"""
        lines = []
        for topic, pos in beliefs.positions.items():
            lines.append(f"- {topic}: {pos.position:.2f} (confidence: {pos.confidence:.2f})")
        return "\n".join(lines) if lines else "No beliefs yet"
    
    def _parse_decision_response(
        self,
        response: str,
        agent: StrategicAgent,
        round_num: int,
    ) -> StrategicAction:
        """Parse LLM response into StrategicAction"""
        # Try to extract JSON
        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response, re.DOTALL)
        
        if json_match:
            try:
                data = json.loads(json_match.group())
                
                # Validate action type
                action_type_str = data.get("action_type", "MAKE_STATEMENT")
                try:
                    action_type = ActionType(action_type_str)
                except ValueError:
                    action_type = ActionType.MAKE_STATEMENT
                
                return StrategicAction(
                    action_type=action_type,
                    actor_id=agent.agent_id,
                    public_description=data.get("public_description", ""),
                    target_ids=data.get("target_ids", []),
                    private_intent=data.get("private_intent", ""),
                    round_num=round_num,
                    is_hidden=data.get("is_hidden", False),
                    metadata={"llm_response": response[:500]},
                )
            except (json.JSONDecodeError, KeyError) as e:
                pass
        
        # Fallback: create a statement action with raw response
        return StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            public_description=response[:500],
            round_num=round_num,
            is_hidden=False,
            metadata={"parsed": False, "raw": response[:200]},
        )
    
    async def decide_batch(
        self,
        agents: List[StrategicAgent],
        round_num: int,
        context: Optional[Dict[str, Any]] = None,
    ) -> List[StrategicAction]:
        """
        Generate decisions for multiple agents.
        
        Args:
            agents: List of agents
            round_num: Current round
            context: Optional shared context
            
        Returns:
            List of StrategicActions
        """
        import asyncio
        
        # Generate decisions concurrently
        tasks = [
            self.decide_action(agent, round_num, context)
            for agent in agents
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out exceptions
        actions = []
        for result in results:
            if isinstance(result, StrategicAction):
                actions.append(result)
        
        return actions
