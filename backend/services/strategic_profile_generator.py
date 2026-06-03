"""
StrategicProfileGenerator - Generate StrategicAgent profiles from entities

This generator creates StrategicAgent profiles for the strategic simulation,
using IKnowledgeStore for entity context.
"""

from typing import Dict, List, Any, Optional
from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent, AgentType, BeliefState, InterestProfile


class StrategicProfileGenerator:
    """
    Generates StrategicAgent profiles from knowledge store entities.
    
    Strategic profile generator for strategic scenarios.
    
    Usage:
        generator = StrategicProfileGenerator(knowledge_store, llm_provider)
        agent = await generator.generate(entity)
    """
    
    def __init__(
        self,
        knowledge_store: IKnowledgeStore,
        llm_provider: ILLMProvider,
    ):
        self.knowledge_store = knowledge_store
        self.llm_provider = llm_provider
    
    async def generate(
        self,
        entity: Dict[str, Any],
        agent_type: Optional[AgentType] = None,
    ) -> StrategicAgent:
        """Generate StrategicAgent from entity"""
        # Determine agent type from entity if not specified
        if agent_type is None:
            agent_type = self._infer_agent_type(entity)
        
        # Get entity context
        context = await self.knowledge_store.get_entity_context(entity.get("uuid", ""))
        
        # Generate beliefs and interests using LLM
        beliefs, interests = await self._generate_profile_components(
            entity, context, agent_type
        )
        
        # Create agent
        agent = StrategicAgent(
            name=entity.get("name", "Unknown"),
            agent_type=agent_type,
            beliefs=beliefs,
            interests=interests,
            influence_weight=self._calculate_influence(entity),
            credibility=0.8,
        )
        
        return agent
    
    async def _generate_profile_components(
        self,
        entity: Dict[str, Any],
        context: str,
        agent_type: AgentType,
    ) -> tuple:
        """Generate beliefs and interests using LLM"""
        prompt = f"""Generate profile for {entity.get('name', 'Unknown')}

Entity: {entity}
Context: {context}

Generate a JSON with:
- beliefs: List of {{
    "topic": "belief topic",
    "position": -1.0 to 1.0,
    "confidence": 0.0 to 1.0
}}
- interests: {{
    "primary_interests": ["interest1", ...],
    "secondary_interests": [...],
    "red_lines": [...],
    "risk_tolerance": 0.0 to 1.0,
    "time_horizon": "short"/"medium"/"long"
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response (simplified)
        beliefs = BeliefState()
        interests = InterestProfile()
        
        return beliefs, interests
    
    def _infer_agent_type(self, entity: Dict[str, Any]) -> AgentType:
        """Infer agent type from entity"""
        entity_type = entity.get("entity_type", "").lower()
        
        type_mapping = {
            "person": AgentType.CORPORATE_EXEC,
            "organization": AgentType.CORPORATE_EXEC,
            "government": AgentType.POLICY_MAKER,
            "investor": AgentType.INSTITUTIONAL_INVESTOR,
            "analyst": AgentType.ANALYST,
            "media": AgentType.MEDIA,
        }
        
        for key, atype in type_mapping.items():
            if key in entity_type:
                return atype
        
        return AgentType.CORPORATE_EXEC
    
    def _calculate_influence(self, entity: Dict[str, Any]) -> float:
        """Calculate influence weight from entity"""
        # Simple heuristic
        attributes = entity.get("attributes", {})
        influence = attributes.get("influence_weight", 0.5)
        return float(influence)
