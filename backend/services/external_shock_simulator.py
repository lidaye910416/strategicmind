"""
ExternalShockSimulator - Inject external events affecting simulation

Pre-defined shock templates: NEW_COMPETITOR, REGULATORY_CHANGE, etc.
Shocks affect agent beliefs and trigger new actions.

Implements: US-097
"""

import random
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from enum import Enum


class ShockType(str, Enum):
    """Types of external shocks"""
    NEW_COMPETITOR = "NEW_COMPETITOR"
    REGULATORY_CHANGE = "REGULATORY_CHANGE"
    MARKET_SHIFT = "MARKET_SHIFT"
    SUPPLY_CHAIN_DISRUPTION = "SUPPLY_CHAIN_DISRUPTION"
    MACRO_ECONOMIC = "MACRO_ECONOMIC"
    TECHNOLOGY_BREAKTHROUGH = "TECHNOLOGY_BREAKTHROUGH"
    GEOPOLITICAL = "GEOPOLITICAL"


@dataclass
class ShockEvent:
    """An external shock event"""
    shock_type: ShockType
    description: str
    severity: float  # 0.0 to 1.0
    affected_topics: List[str] = field(default_factory=list)
    round_num: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "shock_type": self.shock_type.value,
            "description": self.description,
            "severity": self.severity,
            "affected_topics": self.affected_topics,
            "round_num": self.round_num,
        }


class ExternalShockSimulator:
    """
    Simulates external shocks that affect the simulation.
    """
    
    SHOCK_TEMPLATES = {
        ShockType.NEW_COMPETITOR: {
            "description": "A new competitor enters the market with innovative technology",
            "affected_topics": ["market_share", "competitive_pressure", "pricing"],
            "severity_range": (0.3, 0.7),
        },
        ShockType.REGULATORY_CHANGE: {
            "description": "Government announces new regulatory framework",
            "affected_topics": ["compliance", "operational_costs", "market_access"],
            "severity_range": (0.4, 0.8),
        },
        ShockType.MARKET_SHIFT: {
            "description": "Significant shift in consumer preferences",
            "affected_topics": ["demand", "product_strategy", "market_share"],
            "severity_range": (0.3, 0.6),
        },
        ShockType.SUPPLY_CHAIN_DISRUPTION: {
            "description": "Major supply chain disruption occurs",
            "affected_topics": ["costs", "production", "delivery"],
            "severity_range": (0.4, 0.7),
        },
        ShockType.MACRO_ECONOMIC: {
            "description": "Significant macroeconomic event (recession, boom)",
            "affected_topics": ["demand", "costs", "investment"],
            "severity_range": (0.5, 0.9),
        },
        ShockType.TECHNOLOGY_BREAKTHROUGH: {
            "description": "Breakthrough technology emerges",
            "affected_topics": ["innovation", "competitive_advantage", "investment"],
            "severity_range": (0.4, 0.8),
        },
        ShockType.GEOPOLITICAL: {
            "description": "Geopolitical event affects operations",
            "affected_topics": ["market_access", "costs", "risk"],
            "severity_range": (0.5, 0.9),
        },
    }
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.base_probability = self.config.get("base_probability", 0.1)
    
    def inject_shock(
        self,
        context: Dict[str, Any],
        probability: Optional[float] = None,
        round_num: int = 0,
    ) -> Optional[ShockEvent]:
        """
        Possibly inject an external shock.
        
        Args:
            context: Current context
            probability: Override probability (default: base_probability)
            round_num: Current round number
            
        Returns:
            ShockEvent if shock injected, None otherwise
        """
        prob = probability if probability is not None else self.base_probability
        
        if random.random() > prob:
            return None
        
        # Select random shock type
        shock_type = random.choice(list(ShockType))
        template = self.SHOCK_TEMPLATES[shock_type]
        
        # Random severity within range
        severity = random.uniform(*template["severity_range"])
        
        return ShockEvent(
            shock_type=shock_type,
            description=template["description"],
            severity=severity,
            affected_topics=template["affected_topics"],
            round_num=round_num,
        )
    
    def force_shock(
        self,
        shock_type: ShockType,
        round_num: int = 0,
        custom_severity: Optional[float] = None,
    ) -> ShockEvent:
        """Force inject a specific shock"""
        template = self.SHOCK_TEMPLATES[shock_type]
        severity = custom_severity if custom_severity is not None else random.uniform(*template["severity_range"])
        
        return ShockEvent(
            shock_type=shock_type,
            description=template["description"],
            severity=severity,
            affected_topics=template["affected_topics"],
            round_num=round_num,
        )
