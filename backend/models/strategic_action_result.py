"""
StrategicActionResult - Recording agent decisions for later analysis

Following MiroFish pattern: record actions, infer effects in Report stage.
LLM determines effects based on action context, not hardcoded rules.

Implements: US-095
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from .action_type import StrategicAction


@dataclass
class StrategicActionResult:
    """Result of a strategic action with effects"""
    action: StrategicAction
    direct_effects: List[str] = field(default_factory=list)  # Belief changes
    delayed_effects: List[str] = field(default_factory=list)  # Metrics changes
    public_reactions: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action.to_dict(),
            "direct_effects": self.direct_effects,
            "delayed_effects": self.delayed_effects,
            "public_reactions": self.public_reactions,
            "metadata": self.metadata,
        }
