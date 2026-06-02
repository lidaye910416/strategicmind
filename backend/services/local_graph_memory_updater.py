"""
LocalGraphMemoryUpdater - Write simulation actions back to graph

Implements the same interface as ZepGraphMemoryUpdater but uses
LocalKnowledgeStore (nano-graphRAG) instead of Zep.

Implements: US-023
"""

from typing import Dict, Any, List, Optional
import json
import os

from ..interfaces.knowledge_store import IKnowledgeStore
from ..models.action_type import StrategicAction
from ..models.strategic_agent import StrategicAgent


class LocalGraphMemoryUpdater:
    """
    Updates the knowledge graph with simulation actions.
    
    This creates a feedback loop:
        Simulation → Actions → Graph → Reports
    
    Replaces: ZepGraphMemoryUpdater
    """
    
    def __init__(self, knowledge_store: IKnowledgeStore, storage_path: str = "./data/actions"):
        self.knowledge_store = knowledge_store
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)
    
    async def record_action(
        self,
        action: StrategicAction,
        agent: Optional[StrategicAgent] = None,
    ) -> str:
        """
        Record a single action to the graph.
        
        Args:
            action: The action to record
            agent: Optional agent that performed the action
            
        Returns:
            Action ID
        """
        # Persist to file
        action_id = f"action_{action.round_num}_{action.actor_id}_{hash(action.public_description) % 10000}"
        
        action_data = {
            "id": action_id,
            "action": action.to_dict(),
            "agent_id": action.actor_id,
            "round_num": action.round_num,
            "timestamp": action.timestamp,
        }
        
        path = os.path.join(self.storage_path, f"{action_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(action_data, f, ensure_ascii=False)
        
        # Update graph with new entity for this action
        await self.knowledge_store.insert_entity({
            "name": f"Action: {action.action_type.value}",
            "entity_type": "Action",
            "summary": action.public_description,
            "attributes": {
                "actor_id": action.actor_id,
                "round_num": action.round_num,
                "is_hidden": action.is_hidden,
            },
        })
        
        return action_id
    
    async def record_actions(
        self,
        actions: List[StrategicAction],
    ) -> List[str]:
        """Record multiple actions"""
        ids = []
        for action in actions:
            action_id = await self.record_action(action)
            ids.append(action_id)
        return ids
    
    async def get_actions_for_round(self, round_num: int) -> List[Dict[str, Any]]:
        """Get all actions recorded for a specific round"""
        actions = []
        for filename in os.listdir(self.storage_path):
            if filename.endswith(".json"):
                with open(os.path.join(self.storage_path, filename), "r") as f:
                    data = json.load(f)
                    if data.get("round_num") == round_num:
                        actions.append(data)
        return actions
