"""
AgentClustering - Multi-perspective simulation clustering

Cluster agents by entity_type, stance, or influence_weight.
Run separate simulations for each cluster.

Implements: US-045
"""

from typing import Dict, List, Any
from enum import Enum
from collections import defaultdict

from ..models.strategic_agent import StrategicAgent, AgentType


class ClusteringStrategy(str, Enum):
    """Clustering strategies"""
    ENTITY_TYPE = "entity_type"
    STANCE = "stance"
    INFLUENCE_WEIGHT = "influence_weight"


class AgentClustering:
    """
    Cluster agents for multi-perspective simulation.
    
    Usage:
        clustering = AgentClustering()
        clusters = clustering.cluster(agents, ClusteringStrategy.ENTITY_TYPE)
        for cluster_name, cluster_agents in clusters.items():
            # Run separate simulation
            pass
    """
    
    def __init__(self):
        self._clusters: Dict[str, List[StrategicAgent]] = {}
    
    def cluster(
        self,
        agents: List[StrategicAgent],
        strategy: ClusteringStrategy,
    ) -> Dict[str, List[StrategicAgent]]:
        """
        Cluster agents by strategy.
        
        Args:
            agents: List of agents to cluster
            strategy: Clustering strategy
            
        Returns:
            Dict of cluster_name -> list of agents
        """
        if strategy == ClusteringStrategy.ENTITY_TYPE:
            return self._cluster_by_entity_type(agents)
        elif strategy == ClusteringStrategy.INFLUENCE_WEIGHT:
            return self._cluster_by_influence(agents)
        elif strategy == ClusteringStrategy.STANCE:
            return self._cluster_by_stance(agents)
        return {}
    
    def _cluster_by_entity_type(
        self,
        agents: List[StrategicAgent],
    ) -> Dict[str, List[StrategicAgent]]:
        """Cluster by entity type"""
        clusters = defaultdict(list)
        for agent in agents:
            clusters[agent.agent_type.value].append(agent)
        return dict(clusters)
    
    def _cluster_by_influence(
        self,
        agents: List[StrategicAgent],
    ) -> Dict[str, List[StrategicAgent]]:
        """Cluster by influence weight"""
        clusters = defaultdict(list)
        for agent in agents:
            if agent.influence_weight >= 0.8:
                clusters["high_influence"].append(agent)
            elif agent.influence_weight >= 0.5:
                clusters["medium_influence"].append(agent)
            else:
                clusters["low_influence"].append(agent)
        return dict(clusters)
    
    def _cluster_by_stance(
        self,
        agents: List[StrategicAgent],
    ) -> Dict[str, List[StrategicAgent]]:
        """Cluster by stance on key topics"""
        clusters = defaultdict(list)
        for agent in agents:
            # Use first available belief as stance indicator
            positions = list(agent.beliefs.positions.values())
            if positions:
                avg = sum(p.position for p in positions) / len(positions)
                if avg > 0.3:
                    clusters["supportive"].append(agent)
                elif avg < -0.3:
                    clusters["opposed"].append(agent)
                else:
                    clusters["neutral"].append(agent)
            else:
                clusters["undecided"].append(agent)
        return dict(clusters)
    
    async def run_separate_simulations(
        self,
        clusters: Dict[str, List[StrategicAgent]],
        runner: Any,
    ) -> Dict[str, Any]:
        """Run separate simulations for each cluster"""
        results = {}
        for cluster_name, cluster_agents in clusters.items():
            sim_result = await runner.start(
                run_id=f"cluster_{cluster_name}",
                config={"agents": cluster_agents, "max_rounds": 5},
            )
            results[cluster_name] = sim_result
        return results
