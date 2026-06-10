"""
EventInjector (loop-engine v2, T1.6).

Replaces the v1 ``maybe_generate_external_event`` with a deterministic
sampler over the typed :data:`~backend.services.loop.shock_library.SHOCK_LIBRARY`.
This module is the "no LLM" guarantee from the audit's #4 finding —
acceptance test mocks the LLM and asserts zero invocations from
:func:`EventInjector.tick`.

Behaviour
---------

* **Round 0 (priming):** ``user_params.external_factors`` are converted
  to typed ``MARKET_PRIMER`` events (one per factor) and appended to
  the run's pre-round event log. The LLM is *never* consulted.
* **Per-round (1..N):** every round has a base probability of 0.10 of
  drawing one shock; at the 1-year burst window (round 12 by
  default) the probability is multiplied by 1.5×.
* **Advance-year:** a path that schedules typed regulatory/supply/
  competitor/market-shift events for the next year's round 1.
* **Shocks are deterministic given the seed.** The injector owns a
  private :class:`random.Random` instance so it never perturbs the
  global RNG.
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ...models.action_type import PropagationChannel
from .shock_library import (
    DEFAULT_CHANNELS_BY_CATEGORY,
    SHOCK_LIBRARY,
    is_valid_shock_level,
)

logger = logging.getLogger(__name__)


# Round at which we apply the 1.5× burst probability. The default
# matches the spec's "round 12 = 1-year mark" assumption; callers
# may override it for shorter runs.
DEFAULT_BURST_ROUND: int = 12
DEFAULT_BURST_MULTIPLIER: float = 1.5
DEFAULT_BASE_PROBABILITY: float = 0.10


# ---------------------------------------------------------------------------
# Event payload dataclass
# ---------------------------------------------------------------------------


@dataclass
class ShockEvent:
    """One external shock event the simulator will see in a round."""

    category: str
    text: str
    shock_level: float
    channels: List[PropagationChannel] = field(default_factory=list)
    round_num: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "category": self.category,
            "text": self.text,
            "shock_level": float(self.shock_level),
            "channels": [c.value for c in self.channels],
            "round_num": int(self.round_num),
            "metadata": dict(self.metadata),
        }


# ---------------------------------------------------------------------------
# EventInjector
# ---------------------------------------------------------------------------


@dataclass
class EventInjector:
    """Deterministic external-event sampler.

    The injector makes **zero** LLM calls. It draws from the typed
    shock library using a private RNG seeded by ``seed``.
    """

    seed: int = 0
    base_probability: float = DEFAULT_BASE_PROBABILITY
    burst_round: int = DEFAULT_BURST_ROUND
    burst_multiplier: float = DEFAULT_BURST_MULTIPLIER
    _rng: random.Random = field(init=False)

    def __post_init__(self) -> None:
        # A private RNG — never perturb the global ``random``.
        self._rng = random.Random(self.seed)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def prime(self, external_factors: List[str]) -> List[ShockEvent]:
        """Round 0 — convert user-supplied factors into MARKET_PRIMER events.

        These are deterministic: factor N becomes event N, in the
        order given. The text falls back to a stable default if the
        factor is empty.
        """
        events: List[ShockEvent] = []
        for idx, factor in enumerate(external_factors or []):
            text = (factor or "").strip() or f"外部市场因素 #{idx + 1}"
            events.append(
                ShockEvent(
                    category="market_primer",
                    text=text,
                    shock_level=0.6,  # primers are medium-impact
                    channels=[PropagationChannel.MARKET_SIGNAL, PropagationChannel.MEDIA],
                    round_num=0,
                    metadata={"source": "user_params.external_factors", "index": idx},
                )
            )
        return events

    def schedule_advance_year(self, year_offset: int = 1) -> List[ShockEvent]:
        """Advance-year path — schedule typed events for next year's round 1."""
        events: List[ShockEvent] = []
        categories = ["regulatory", "supply", "competitor", "market_shift"]
        for cat in categories:
            library = SHOCK_LIBRARY.get(cat, [])
            if not library:
                continue
            # Deterministic pick: same seed → same shock for the same year.
            entry = library[(self.seed + year_offset + hash(cat)) % len(library)]
            events.append(
                ShockEvent(
                    category=cat,
                    text=entry["text"],
                    shock_level=float(entry["shock_level"]),
                    channels=list(DEFAULT_CHANNELS_BY_CATEGORY.get(cat, [])),
                    round_num=1,  # first round of the new year
                    metadata={"source": "advance_year", "year_offset": year_offset},
                )
            )
        return events

    def tick(self, round_num: int) -> List[ShockEvent]:
        """Per-round: probabilistically draw a shock from the library.

        At ``burst_round`` the probability is multiplied by
        ``burst_multiplier`` (default 1.5×).
        """
        prob = self.base_probability
        if round_num > 0 and round_num % self.burst_round == 0:
            prob = min(1.0, self.base_probability * self.burst_multiplier)
        if self._rng.random() >= prob:
            return []
        # Draw a category and an entry.
        category = self._rng.choice(list(SHOCK_LIBRARY.keys()))
        library = SHOCK_LIBRARY[category]
        entry = library[self._rng.randrange(len(library))]
        shock_level = float(entry["shock_level"])
        # T1.6 acceptance: shock_level ∈ {0.4, 0.6, 0.8}
        if not is_valid_shock_level(shock_level):
            # Defensive — should never happen with the current library,
            # but if a future entry violates the invariant, skip the
            # event rather than corrupt the world state.
            logger.warning(
                "Shock library returned invalid shock_level=%s; skipping",
                shock_level,
            )
            return []
        return [
            ShockEvent(
                category=category,
                text=entry["text"],
                shock_level=shock_level,
                channels=list(DEFAULT_CHANNELS_BY_CATEGORY.get(category, [])),
                round_num=round_num,
                metadata={"source": "per_round"},
            )
        ]


__all__ = [
    "EventInjector",
    "ShockEvent",
    "DEFAULT_BURST_ROUND",
    "DEFAULT_BURST_MULTIPLIER",
    "DEFAULT_BASE_PROBABILITY",
]
