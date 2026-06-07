"""
market_environment - Service-layer facade for MarketEnvironmentAgent.

This shim exposes a stable, service-level import path
(``backend.services.market_environment``) so callers in the pipeline
orchestrator don't have to reach into ``backend.models``. The model
implementation lives in ``backend/models/market_environment.py``.

Why both?
    - The model holds the dataclass + math (pure, no side effects).
    - The service is a thin facade used by pipeline code; it also
      normalises the public method name ``evolve_quarter`` to the
      model's ``quarterly_update`` so the orchestrator's call site
      reads cleanly.
"""
from typing import Any, Dict, Optional

from backend.models.market_environment import (
    MarketEnvironmentAgent as _ModelAgent,
    MarketCycle,
    PolicyStance,
    MARKET_CYCLE_LABELS_CN,
    POLICY_STANCE_LABELS_CN,
)

__all__ = [
    "MarketEnvironmentAgent",
    "MarketCycle",
    "PolicyStance",
    "MARKET_CYCLE_LABELS_CN",
    "POLICY_STANCE_LABELS_CN",
]


class MarketEnvironmentAgent(_ModelAgent):
    """
    Service-layer wrapper that exposes ``evolve_quarter`` (the name used
    by pipeline code) as an alias for the model's ``quarterly_update``.
    """

    def evolve_quarter(self, random_seed: Optional[int] = None) -> Dict[str, Any]:
        """Advance one fiscal quarter; return the change summary."""
        return self.quarterly_update(random_seed=random_seed)
