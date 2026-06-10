"""
LoopEngine (loop-engine v2, T1.8) — the centerpiece.

This module wires together the pieces built in T1.1..T1.7:

* :class:`~backend.services.loop.clock.SimClock` — temporal mechanics
* :class:`~backend.services.loop.action_resolver.ActionResolver` — per-action state mutations
* :class:`~backend.services.loop.memory_writeback.MemoryWriteback` — Episode writeback
* :class:`~backend.services.loop.event_injector.EventInjector` — typed external shocks (no LLM)
* :class:`~backend.services.loop.scheduler.AgentScheduler` — substantive time gates
* :class:`~backend.models.world_state.WorldState` — the state model (Phase 0)
* an **explicit** :class:`LLMClient` — the load-bearing injection that
  makes the engine testable (T1.8 acceptance). The engine never falls
  back to a module-level ``os.environ`` lookup.

The :meth:`LoopEngine.run` coroutine drives a multi-round loop and
returns a list of :class:`RoundResult` objects, each with
:meth:`RoundResult.to_event` for SSE emission.
"""
from __future__ import annotations

import logging
import time
import uuid
import dataclasses
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol, Sequence

from ...models.action_type import (
    ActionType,
    PropagationChannel,
    StrategicAction,
)
from ...models.strategic_agent import StrategicAgent
from ...models.world_state import WorldState
from .action_resolver import ActionResolver
from .action_taxonomy import BusinessActionType, set_business_type
from .clock import SimClock
from .event_injector import EventInjector, ShockEvent
from .memory_writeback import (
    EDGE_CAUSED,
    EDGE_PERFORMED,
    EPISODE_NODE_TYPE,
    EpisodicMemory,
    MemoryWriteback,
)
from .scheduler import AgentScheduler

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLM client protocol
# ---------------------------------------------------------------------------


class LLMClient(Protocol):
    """Minimal protocol that the engine relies on.

    The engine never instantiates a concrete client; production code
    passes an adapter (e.g. ``BailianAdapter``); tests pass a stub.
    Either way, the protocol guarantees the engine's contract.

    Step 6 feedback loop B1
    -----------------------
    The protocol now requires ``recent_episodes``: a list of
    :class:`~backend.services.loop.memory_writeback.EpisodicMemory`
    Episode node dicts (newest first) that the agent performed in
    earlier rounds. The engine queries
    :meth:`EpisodicMemory.recent_episodes` before each call so the
    LLM is no longer blind to its own history. Implementations should
    fold ``recent_episodes`` into the prompt — production adapters
    (BailianAdapter, etc.) consume it as a "memory block"; test stubs
    can simply record it. The parameter is keyword-only and may be an
    empty list on round 1 (no prior episodes).
    """

    async def generate_action(
        self,
        *,
        agent: StrategicAgent,
        clock: SimClock,
        world_state: WorldState,
        candidates: Sequence[BusinessActionType],
        recent_episodes: Sequence[Dict[str, Any]] = (),
    ) -> StrategicAction: ...


# ---------------------------------------------------------------------------
# RoundResult
# ---------------------------------------------------------------------------


@dataclass
class RoundResult:
    """Outcome of a single round — what gets pushed to the event bus."""

    round_num: int
    actions: List[StrategicAction] = field(default_factory=list)
    shock_events: List[ShockEvent] = field(default_factory=list)
    clock_snapshot: Dict[str, Any] = field(default_factory=dict)
    started_at: float = 0.0
    ended_at: float = 0.0
    active_agent_ids: List[str] = field(default_factory=list)
    episode_ids: List[str] = field(default_factory=list)
    world_state_snapshot: Dict[str, Any] = field(default_factory=dict)

    def to_event(self) -> Dict[str, Any]:
        """SSE payload for ``round_completed`` (T1.9 forward-compat).

        Includes every loop-engine v2 field the Workbench UI expects:

        * ``action_id``, ``in_reply_to``, ``post_content``,
          ``post_author_name``, ``propagation_channels``, ``evidence``
          on each action dict.
        * ``shock_events`` for the EventInjector.
        * ``clock_snapshot`` for the SimClock.
        """
        actions_payload = []
        for a in self.actions:
            d = a.to_dict()
            # Ensure the round is stamped (defensive).
            d["round_num"] = int(a.round_num or self.round_num)
            # v2 fields live on the action as ad-hoc attributes when
            # the dataclass hasn't been extended. We always want the
            # SSE payload to carry them, so we copy from getattr
            # fallbacks. This way the Workbench UI sees stable keys
            # whether the dataclass is the v1 or v2 form.
            for key in ("action_id", "post_content", "post_author_name", "in_reply_to", "evidence"):
                if key not in d or d[key] in (None, ""):
                    val = getattr(a, key, None)
                    if val is not None or key in ("in_reply_to",):
                        d[key] = val
            actions_payload.append(d)
        return {
            "type": "round_completed",
            "round": int(self.round_num),
            "total_rounds": None,  # filled in by the engine when emitting
            "actions": actions_payload,
            "actions_count": len(actions_payload),
            "shock_events": [e.to_dict() for e in self.shock_events],
            "clock": dict(self.clock_snapshot),
            "active_agents": list(self.active_agent_ids),
            "episode_ids": list(self.episode_ids),
            "world_state": dict(self.world_state_snapshot),
            "ts": self.ended_at or time.time(),
        }


# ---------------------------------------------------------------------------
# LoopEngine
# ---------------------------------------------------------------------------


@dataclass
class LoopEngine:
    """The multi-round simulation engine.

    The constructor takes **explicit** dependencies — no module-level
    singletons, no env-var lookups in the hot path. That is the #6
    property from the design's adversarial critique (testability).
    """

    run_id: str
    clock: SimClock
    agents: List[StrategicAgent]
    knowledge_store: Any  # LocalKnowledgeStore (kept opaque for now)
    event_bus: Any  # EventBus
    config: Any  # SimConfig
    llm_client: LLMClient
    world_state: WorldState = field(default_factory=WorldState)
    action_resolver: ActionResolver = field(default_factory=ActionResolver)
    memory_writer: Optional[MemoryWriteback] = None
    event_injector: EventInjector = field(default_factory=EventInjector)
    scheduler: AgentScheduler = field(default_factory=AgentScheduler)
    hours_per_round: int = 24
    total_rounds: int = 12
    seed: int = 0
    # Bookkeeping — last action_id per agent, for in_reply_to chaining.
    _last_action_id: Dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Wire a default in-process EpisodicMemory when the caller
        # didn't supply one. The engine never depends on the env.
        if self.memory_writer is None:
            self.memory_writer = MemoryWriteback(
                memory=EpisodicMemory.for_run(self.run_id)
            )

    # ------------------------------------------------------------------
    # Public entry-point
    # ------------------------------------------------------------------
    async def run(self) -> List[RoundResult]:
        results: List[RoundResult] = []
        # Round 0 — prime with user-supplied external factors.
        user_params = self._extract_user_params()
        primer_factors = list(user_params.get("external_factors") or [])
        primer_events = self.event_injector.prime(primer_factors)
        for evt in primer_events:
            self._emit_event("shock_injected", evt.to_dict())

        for round_num in range(1, self.total_rounds + 1):
            result = await self._execute_round(round_num, primer_events if round_num == 1 else [])
            # The total_rounds field is a per-engine constant; the
            # event payload uses the same value for every round so the
            # UI's progress bar can compute ``round / total_rounds``.
            payload = result.to_event()
            payload["total_rounds"] = self.total_rounds
            self._emit_event("round_completed", payload)
            results.append(result)
            # Advance the clock by hours_per_round (default 24h).
            self.clock.advance(self.hours_per_round)
        return results

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _execute_round(
        self,
        round_num: int,
        primer_events: List[ShockEvent],
    ) -> RoundResult:
        started = time.time()
        # 1) Sample external shocks.
        shock_events = list(primer_events)
        if round_num > 0:
            shock_events.extend(self.event_injector.tick(round_num))
        for se in shock_events:
            self._emit_event("shock_injected", se.to_dict())

        # 2) Time-gated agent selection (with force-minimum).
        selected = self.scheduler.select_active_or_force(
            self.agents, self.clock, round_num, seed=self.seed + round_num
        )
        active_ids = [a.agent_id for a in selected]

        # 3) Per-agent LLM call → action.
        actions: List[StrategicAction] = []
        for agent in selected:
            action = await self._decide_action(agent, round_num)
            actions.append(action)

        # Guarantee round-minimum with a synthetic action if needed.
        if not actions and self.agents:
            synth_agent = self.agents[0]
            synth = self.scheduler.make_synthetic_action(synth_agent, round_num)
            actions.append(synth)

        # 4) Resolve actions into the WorldState.
        for a in actions:
            self.action_resolver.resolve(self.world_state, a)

        # 5) Write episodes (PERFORMED / IN_REPLY_TO / CAUSED edges).
        episode_ids: List[str] = []
        if self.memory_writer is not None:
            write_results = self.memory_writer.write_round(
                actions, state_after=self.world_state
            )
            episode_ids = [r["episode_id"] for r in write_results if r.get("episode_id")]

        ended = time.time()
        result = RoundResult(
            round_num=round_num,
            actions=actions,
            shock_events=shock_events,
            clock_snapshot=self.clock.describe(),
            started_at=started,
            ended_at=ended,
            active_agent_ids=active_ids,
            episode_ids=episode_ids,
            world_state_snapshot=self.world_state.to_dict(),
        )
        return result

    async def _decide_action(
        self, agent: StrategicAgent, round_num: int
    ) -> StrategicAction:
        """Call the injected LLM to produce a StrategicAction for the agent.

        The engine never falls back to a module-level LLM lookup —
        the caller MUST inject ``llm_client``. The stub used in the
        acceptance test implements the LLMClient protocol.

        Step 6 feedback loop B1: BEFORE the LLM call we query
        :class:`EpisodicMemory` for the most recent episodes (default
        5, newest first) so the LLM can condition its decision on
        prior-round actions. If ``self.memory_writer`` is ``None`` the
        recall is skipped defensively (the engine still functions,
        just without the feedback loop). The recall is per-agent by
        default so the LLM sees its *own* history, not the whole
        market's.
        """
        candidates = list(BusinessActionType)
        recent_episodes: List[Dict[str, Any]] = []
        if self.memory_writer is not None:
            try:
                recent_episodes = self.memory_writer.memory.recent_episodes(
                    limit=5, agent_id=agent.agent_id,
                )
            except Exception as exc:  # pragma: no cover - defensive
                # A failing recall must not break the simulation.
                logger.warning(
                    "LoopEngine recent_episodes recall failed for agent %s: %s",
                    agent.agent_id, exc,
                )
                recent_episodes = []
        action = await self.llm_client.generate_action(
            agent=agent,
            clock=self.clock,
            world_state=self.world_state,
            candidates=candidates,
            recent_episodes=recent_episodes,
        )
        action.round_num = round_num
        action.actor_id = agent.agent_id
        # Auto-assign a stable action_id when the LLM stub left it
        # blank. The v2 fields live on the action as ad-hoc
        # attributes (StrategicAction's core dataclass doesn't
        # declare them), so we use setattr-style access via
        # ``getattr``/``setattr`` and fall back to a stable hash of
        # (actor_id, round_num) if the action is frozen.
        existing_id = getattr(action, "action_id", "") or ""
        if not existing_id:
            try:
                action.action_id = str(uuid.uuid4())
                existing_id = action.action_id
            except (AttributeError, dataclasses.FrozenInstanceError):
                existing_id = f"{agent.agent_id}_r{round_num}_{uuid.uuid4().hex[:8]}"
        if not getattr(action, "post_author_name", ""):
            try:
                action.post_author_name = agent.name or agent.agent_id
            except (AttributeError, dataclasses.FrozenInstanceError):
                pass
        # Stamp in_reply_to (latest action by the same actor).
        if not getattr(action, "in_reply_to", None):
            prev = self._last_action_id.get(agent.agent_id)
            if prev and prev != existing_id:
                try:
                    action.in_reply_to = prev
                except (AttributeError, dataclasses.FrozenInstanceError):
                    pass
        self._last_action_id[agent.agent_id] = existing_id
        # Set the explicit v2 type so the resolver dispatches correctly
        # (the LLM may have used a v1 type that happens to map back
        # to a different v2 type).
        # We try to detect v2 from metadata first, then from action_type
        # string match. We do NOT overwrite an explicit tag.
        if not (action.metadata or {}).get("business_type"):
            try:
                btype = BusinessActionType(str(action.action_type.value))
                set_business_type(action, btype)
            except ValueError:
                # The LLM returned a v1-only type — leave the resolver
                # to fall back to from_v1().
                pass
        return action

    def _emit_event(self, event_type: str, data: Dict[str, Any]) -> None:
        """Best-effort emit to the event bus; never raise."""
        try:
            self.event_bus.emit(self.run_id, event_type, data)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("LoopEngine event emit failed: %s", exc)

    def _extract_user_params(self) -> Dict[str, Any]:
        """Find user_params from the config, tolerating dataclass / dict."""
        cfg = self.config
        if cfg is None:
            return {}
        if isinstance(cfg, dict):
            return dict(cfg.get("user_params") or {})
        up = getattr(cfg, "user_params", None)
        if up is None:
            return {}
        return dict(up or {})


__all__ = [
    "LoopEngine",
    "RoundResult",
    "LLMClient",
]
