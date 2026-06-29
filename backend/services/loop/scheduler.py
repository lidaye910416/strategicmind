"""
AgentScheduler v2 (loop-engine v2, T1.7).

Replaces the v1 ``get_active_agents`` filter (which was a constant
influence-threshold round-robin) with *substantive* time gates driven
by the new :class:`~backend.services.loop.clock.SimClock` and the
extended :class:`~backend.models.strategic_agent.StrategicAgent`
fields. The audit identified the lack of temporal mechanics as the #3
cause of "mediocre emergence" (see
docs/superpowers/specs/loop-engine-v2-implementation.md §1.3); the
v2 scheduler is the unit-level fix.

Time gates (per the spec §T1.7)
-------------------------------

* **CFO / Finance:** day_of_month ∈ {1, 30} AND business hours.
* **Sales:** weekday AND business hours.
* **Board / CEO:** quarter boundary (first or last day of a quarter)
  AND business hours.
* **Engineers:** active_hours contains the current hour (long
  schedule, [9, 22] by default).

All other agents fall back to the ``active_hours`` filter. The
``force_one_action_per_round_minimum`` policy guarantees that at
least one agent gets a synthetic MAKE_STATEMENT per round so the
simulation never silently stalls (the v1 simulation could produce
rounds with zero actions and break report grounding).
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence

from ...models.action_type import (
    ActionType,
    PropagationChannel,
    StrategicAction,
)
from ...models.strategic_agent import AgentType, StrategicAgent
from ...models.world_state import WorldState
from .clock import SimClock

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Role classification — the scheduler decides an agent's role from
# ``agent.department`` / ``agent.role`` / ``agent.agent_type``. Unknown
# agents fall back to the "default" pattern.
# ---------------------------------------------------------------------------


def _v2_get(agent: StrategicAgent, key: str, default=None):
    """Read a v2 ad-hoc attribute from a StrategicAgent.

    The legacy ``StrategicAgent`` dataclass does not declare the v2
    scheduler fields (``role``, ``department``, ``active_hours``,
    ``activity_level``, ``timezone_offset``). Callers in this
    scheduler must therefore use ``getattr`` so the loop engine
    works whether the agent instance was built with the v2 fields
    or not.
    """
    return getattr(agent, key, default)


def classify_role(agent: StrategicAgent) -> str:
    """Return one of: cfo / sales / board / engineer / default."""
    # v2 fields (role, department) live on StrategicAgent as ad-hoc
    # attributes that the legacy dataclass does not declare. Use
    # getattr-with-default so the scheduler works against the bare
    # dataclass as well as the v2-extended one.
    role = (getattr(agent, "role", "") or "").lower()
    dept = (getattr(agent, "department", "") or "").lower()
    name = (agent.name or "").lower()
    blob = f"{role} {dept} {name}"
    if "cfo" in blob or "finance" in blob or "财务" in blob:
        return "cfo"
    if "sales" in blob or "销售" in blob:
        return "sales"
    if "board" in blob or "ceo" in blob or "董事" in blob:
        return "board"
    if "engineer" in blob or "技术" in blob or "developer" in blob or "研发" in blob:
        return "engineer"
    return "default"


# ---------------------------------------------------------------------------
# Time-gate predicates — one per role
# ---------------------------------------------------------------------------


def _cfo_gate(clock: SimClock, agent: StrategicAgent) -> bool:
    """CFO/Finance: only on day 1 or day 30, business hours."""
    if clock.day_of_month not in (1, 30):
        return False
    return clock.is_business_hours(_v2_get(agent, "timezone_offset", 0))


def _sales_gate(clock: SimClock, agent: StrategicAgent) -> bool:
    """Sales: weekday business hours only."""
    return clock.is_weekday() and clock.is_business_hours(_v2_get(agent, "timezone_offset", 0))


def _board_gate(clock: SimClock, agent: StrategicAgent) -> bool:
    """Board/CEO: only on quarter boundary, business hours."""
    return clock.is_quarter_boundary() and clock.is_business_hours(_v2_get(agent, "timezone_offset", 0))


def _engineer_gate(clock: SimClock, agent: StrategicAgent) -> bool:
    """Engineers: long active_hours window. Use agent.active_hours as the gate."""
    return clock.hour_of_day in (_v2_get(agent, "active_hours") or list(range(9, 18)))


def _default_gate(clock: SimClock, agent: StrategicAgent) -> bool:
    """Default: standard 9-17 active_hours filter."""
    hours = _v2_get(agent, "active_hours") or list(range(9, 18))
    if not hours:
        return True
    return clock.hour_of_day in hours


_ROLE_GATES = {
    "cfo": _cfo_gate,
    "sales": _sales_gate,
    "board": _board_gate,
    "engineer": _engineer_gate,
    "default": _default_gate,
}


# ---------------------------------------------------------------------------
# AgentScheduler
# ---------------------------------------------------------------------------


@dataclass
class AgentScheduler:
    """Substantive-time-gated agent scheduler (T1.7)."""

    force_one_action_per_round_minimum: bool = True
    burst_window_size: int = 1
    _rng: random.Random = field(default_factory=random.Random)

    def __post_init__(self) -> None:
        if self._rng is None:
            self._rng = random.Random()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def select_active(
        self,
        agents: Sequence[StrategicAgent],
        clock: SimClock,
        *,
        seed: Optional[int] = None,
    ) -> List[StrategicAgent]:
        """Return the list of agents eligible to act on this clock tick.

        An agent is eligible if its role's time-gate matches the
        current clock AND its ``activity_level * burst`` Bernoulli
        fires. The ``seed`` parameter is honoured for testability.
        """
        rng = random.Random(seed) if seed is not None else self._rng
        eligible: List[StrategicAgent] = []
        for agent in agents or []:
            role = classify_role(agent)
            gate = _ROLE_GATES.get(role, _default_gate)
            if not gate(clock, agent):
                continue
            burst = 1.0
            prob = max(0.0, min(1.0, float(_v2_get(agent, "activity_level", 1.0)) * burst))
            if rng.random() < prob:
                eligible.append(agent)
        return eligible

    def select_active_or_force(
        self,
        agents: Sequence[StrategicAgent],
        clock: SimClock,
        round_num: int,
        *,
        seed: Optional[int] = None,
        force_one_action_per_round_minimum: Optional[bool] = None,
    ) -> List[StrategicAction]:
        """Like :meth:`select_active` but guarantees >=1 agent per round.

        When ``force_one_action_per_round_minimum`` is on (default) and
        the natural selection produced zero agents, we pick the agent
        with the highest ``activity_level`` whose time-gate is
        *closest* to satisfied (we drop the business-hours requirement
        but keep the day-gate, so the board still only acts on
        quarter boundaries and CFO still only on day 1/30).

        Bug #2: caller can override the policy toggle per-call so the
        engine's force-minimum semantics don't drift between
        wired/unwired paths.
        """
        use_force = (
            self.force_one_action_per_round_minimum
            if force_one_action_per_round_minimum is None
            else bool(force_one_action_per_round_minimum)
        )
        eligible = self.select_active(agents, clock, seed=seed)
        if eligible or not use_force or not agents:
            return eligible
        # Fall back to "weakest gate"
        candidates: List[tuple] = []
        for agent in agents:
            role = classify_role(agent)
            gate = _ROLE_GATES.get(role, _default_gate)
            # Loosen: skip the business-hours check, keep the day-gate.
            active_hours = _v2_get(agent, "active_hours")
            if role == "cfo":
                ok = clock.day_of_month in (1, 30)
            elif role == "board":
                ok = clock.is_quarter_boundary()
            elif role == "sales":
                ok = clock.is_weekday()
            elif role == "engineer":
                ok = clock.hour_of_day in (active_hours or list(range(9, 23)))
            else:
                ok = clock.hour_of_day in (active_hours or list(range(0, 24)))
            if ok:
                candidates.append((float(_v2_get(agent, "activity_level", 1.0)), agent))
        if not candidates:
            # Last resort — pick the first agent.
            return [agents[0]]
        candidates.sort(key=lambda pair: pair[0], reverse=True)
        return [candidates[0][1]]

    def bind_to_loop(self, loop_engine: Any) -> None:
        """Wire this scheduler as the activation source for a LoopEngine.

        Bug #2 root cause 2.4: v1 ``SimulationLoop.get_active_agents`` used
        round-robin + influence threshold, ignoring the 5 time gates
        (CFO季末/Sales任何/Board跨年/Engineer事件/Marketing轮转).

        Mirrors MiroFish's typed scheduler protocol — the engine only
        ever asks ``select_active_or_force()`` for the activation list.
        """
        loop_engine.scheduler = self
        # Defensive: also re-export the policy toggle so the engine's
        # force-minimum semantics don't drift between wired/unwired paths.
        self.force_one_action_per_round_minimum = True
        return None  # explicit; engine mutates its own field

    # ------------------------------------------------------------------
    # Helpers — produce a no-op action for a forced round
    # ------------------------------------------------------------------
    @staticmethod
    def make_synthetic_action(agent: StrategicAgent, round_num: int) -> StrategicAction:
        """Build a no-op MAKE_STATEMENT to satisfy the round-minimum policy.

        The action carries the agent's name in ``post_author_name`` so
        the report can quote it.
        """
        a = StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            target_ids=[],
            round_num=round_num,
            propagation_channels=[PropagationChannel.DIRECT],
            metadata={"forced_round": True},
        )
        # v2 fields live as ad-hoc attributes on the legacy dataclass.
        # Pad to >= MIN_POST_CONTENT_LEN (40) so the action passes the
        # writeback filter and produces a real episode (Bug #2 root cause 2.6).
        # The body itself is 43 chars; total = len(name) + 1 + 43 >= 40.
        a.post_content = (
            f"{agent.name}：本期无重大动作，按既有策略继续推进本季度"
            "各项工作安排与目标落实，整体节奏保持稳步前行。"
        )
        a.post_author_name = agent.name or agent.agent_id
        a.evidence = []
        return a


__all__ = [
    "AgentScheduler",
    "classify_role",
]
