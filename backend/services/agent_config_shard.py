"""
AgentConfigShardLoader - Load agent configs in shards

Loads 1000 agents in 10 shards of 100 each.
Implements: US-041
"""

from typing import Dict, List, Any, Optional
import os
import json
from dataclasses import dataclass


@dataclass
class AgentConfig:
    """Agent configuration"""
    agent_id: str
    shard_id: int
    data: Dict[str, Any]


class AgentConfigShardLoader:
    """
    Sharded agent configuration loader.
    
    Loads configs in shards to avoid loading all 1000 agents into memory.
    """
    
    def __init__(
        self,
        shard_size: int = 100,
        storage_path: str = "./data/agent_configs",
    ):
        self.shard_size = shard_size
        self.storage_path = storage_path
        self._shards: Dict[int, List[AgentConfig]] = {}
        os.makedirs(storage_path, exist_ok=True)
    
    def shard_count(self, total_agents: int) -> int:
        """Calculate number of shards for N agents"""
        return (total_agents + self.shard_size - 1) // self.shard_size
    
    def get_agent_config(
        self,
        agent_id: str,
        shard_id: Optional[int] = None,
    ) -> Optional[AgentConfig]:
        """Get agent config (loads shard if needed)"""
        if shard_id is not None:
            self._load_shard(shard_id)
            for config in self._shards.get(shard_id, []):
                if config.agent_id == agent_id:
                    return config
        else:
            # Search all shards
            for sid in list(self._shards.keys()):
                for config in self._shards[sid]:
                    if config.agent_id == agent_id:
                        return config
        return None
    
    def prefetch_shard(self, shard_id: int) -> None:
        """Preload a shard ahead of activation"""
        self._load_shard(shard_id)
    
    def _load_shard(self, shard_id: int) -> None:
        """Load a shard from disk"""
        if shard_id in self._shards:
            return
        
        path = os.path.join(self.storage_path, f"shard_{shard_id}.json")
        if not os.path.exists(path):
            return
        
        with open(path, "r") as f:
            data = json.load(f)
        
        self._shards[shard_id] = [
            AgentConfig(
                agent_id=item["agent_id"],
                shard_id=shard_id,
                data=item["data"],
            )
            for item in data
        ]
    
    def save_shard(self, shard_id: int, configs: List[AgentConfig]) -> None:
        """Save a shard to disk"""
        path = os.path.join(self.storage_path, f"shard_{shard_id}.json")
        data = [
            {"agent_id": c.agent_id, "data": c.data}
            for c in configs
        ]
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        self._shards[shard_id] = configs
