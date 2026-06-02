"""
StrategicConfigGenerator - Convert SeedDocument to SimulationConfig

Extracts stakeholders, claims, positions, and metrics from documents.
Implements: US-072
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

from ..models.seed_document import SeedDocument
from ..models.strategic_agent import AgentType


@dataclass
class SimulationConfig:
    """Simulation configuration"""
    seed_doc_id: str
    agents: List[Dict[str, Any]] = field(default_factory=list)
    max_rounds: int = 10
    simulated_hours: int = 72
    metrics: List[str] = field(default_factory=list)
    topics: List[str] = field(default_factory=list)


class StrategicConfigGenerator:
    """
    Generates simulation configuration from seed documents.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def generate(
        self,
        seed_doc: SeedDocument,
        requirement: str,
    ) -> SimulationConfig:
        """
        Generate SimulationConfig from a SeedDocument.
        
        Args:
            seed_doc: SeedDocument to analyze
            requirement: User requirement
            
        Returns:
            SimulationConfig for the simulation
        """
        # Identify stakeholders
        agents = self._identify_stakeholders(seed_doc)
        
        # Map claims to positions
        topics = self._map_claims_to_topics(seed_doc, agents)
        
        # Define metrics
        metrics = self._define_metrics(requirement)
        
        return SimulationConfig(
            seed_doc_id=seed_doc.doc_id,
            agents=agents,
            max_rounds=self.config.get("max_rounds", 10),
            simulated_hours=self.config.get("simulated_hours", 72),
            metrics=metrics,
            topics=topics,
        )
    
    def _identify_stakeholders(
        self,
        seed_doc: SeedDocument,
    ) -> List[Dict[str, Any]]:
        """Extract stakeholders from document"""
        agents = []
        
        # Use extracted entities
        for entity in seed_doc.key_entities:
            agent_type = self._infer_agent_type(entity.entity_type)
            agents.append({
                "name": entity.text,
                "agent_type": agent_type,
                "influence_weight": 0.5,
            })
        
        return agents
    
    def _map_claims_to_topics(
        self,
        seed_doc: SeedDocument,
        agents: List[Dict[str, Any]],
    ) -> List[str]:
        """Map claims to belief topics"""
        topics = []
        for claim in seed_doc.claims[:10]:
            topics.append(claim.content[:50])
        return topics
    
    def _define_metrics(self, requirement: str) -> List[str]:
        """Define outcome metrics based on requirement"""
        return [
            "belief_evolution",
            "action_count",
            "stakeholder_engagement",
            "decision_quality",
        ]
    
    def _infer_agent_type(self, entity_type: str) -> str:
        """Map entity type to agent type"""
        entity_type_lower = entity_type.lower()
        
        if "person" in entity_type_lower or "individual" in entity_type_lower:
            return AgentType.CORPORATE_EXEC.value
        elif "company" in entity_type_lower or "organization" in entity_type_lower:
            return AgentType.CORPORATE_EXEC.value
        elif "government" in entity_type_lower:
            return AgentType.POLICY_MAKER.value
        elif "investor" in entity_type_lower:
            return AgentType.INSTITUTIONAL_INVESTOR.value
        elif "media" in entity_type_lower:
            return AgentType.MEDIA.value
        
        return AgentType.CORPORATE_EXEC.value
