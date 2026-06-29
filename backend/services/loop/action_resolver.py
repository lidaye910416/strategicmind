"""
ActionResolver + ACTION_PROFILES (loop-engine v2, T1.4).

For each of the 12 :class:`BusinessActionType` values, the resolver
defines a small profile function that mutates a **specific slice** of
a :class:`~backend.models.world_state.WorldState`. The audit
identified the v1 simulation's conflation of every action into a
single belief-delta function as the #1 cause of "mediocre emergence"
(see docs/superpowers/specs/loop-engine-v2-implementation.md §1.1);
this module is the unit-level fix.

Invariants
----------

* Each profile mutates exactly **one** structural slice
  (``coalitions`` / ``budget_ledger`` / ``asset_registry`` /
  ``proposals`` / ``beliefs`` / ``events``) — not "trust +X" on every
  slice. The acceptance test asserts this with diff() comparisons.
* Profiles NEVER call an LLM. The LLM only fills the action's
  payload (actor_id, target_ids, amount, etc.); the resolver
  interprets it deterministically.
* Profiles NEVER raise. A malformed payload is logged (in
  ``metadata.warn``) and the world state is left unchanged.

Usage
-----

::

    from backend.models.world_state import WorldState
    from backend.services.loop.action_resolver import ActionResolver
    from backend.models.action_type import StrategicAction, ActionType

    state = WorldState()
    resolver = ActionResolver()
    action = StrategicAction(
        action_type=ActionType.FORM_COALITION,
        actor_id="agent_1",
        target_ids=["agent_2", "agent_3"],
        metadata={"coalition_id": "c_demo"},
    )
    resolver.resolve(state, action)
    # state.coalitions == {"c_demo": {"agent_1", "agent_2", "agent_3"}}
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from ...models.action_type import (
    PropagationChannel,
    StrategicAction,
    ActionType,
)
from ...models.world_state import (
    AssetEntry,
    ProposalEntry,
    ProposalStatus,
    WorldState,
)
from .action_taxonomy import BusinessActionType, MUTATING_TYPES, get_business_type

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Profile signature
# ---------------------------------------------------------------------------
# A profile is ``Callable[[WorldState, StrategicAction], None]``. The
# resolver records what slice each profile touched on the action's
# ``metadata`` so callers (MemoryWriteback, report agent) can route
# the CAUSED edge to the right world_state_node.

ProfileFn = Callable[[WorldState, StrategicAction], None]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_metadata(action: StrategicAction) -> Dict[str, Any]:
    """Return a guaranteed-dict view of action.metadata (never None)."""
    md = action.metadata
    if md is None:
        return {}
    return md


def _record_touched(action: StrategicAction, slice_name: str, **extras: Any) -> None:
    """Stamp the action's metadata with the slice it mutated.

    The MemoryWriteback (T1.5) reads this to decide whether to add a
    CAUSED edge to a world_state_node.
    """
    md = _safe_metadata(action)
    md.setdefault("resolver", {})["touched_slice"] = slice_name
    md["resolver"].update(extras)
    action.metadata = md


def _record_warning(action: StrategicAction, message: str) -> None:
    md = _safe_metadata(action)
    md.setdefault("resolver", {})["warning"] = message
    action.metadata = md


def _target_ids(action: StrategicAction) -> List[str]:
    return [str(t) for t in (action.target_ids or []) if t]


def _first_target(action: StrategicAction) -> Optional[str]:
    ids = _target_ids(action)
    return ids[0] if ids else None


def _get_target_positions(action: StrategicAction) -> Dict[str, float]:
    """Return LLM-supplied target_positions for ``action``.

    The v2 LLM adapter (LoopEngineLLMAdapter) attaches the LLM's
    ``target_positions`` (topic -> position in [-1, 1]) as an ad-hoc
    attribute on the StrategicAction, with a metadata-dict fallback
    if the dataclass is frozen. Returns an empty dict when absent so
    callers can default to legacy hardcoded deltas.
    """
    raw = getattr(action, "target_positions", None)
    if raw:
        try:
            return {str(k): float(v) for k, v in raw.items()}
        except (TypeError, ValueError):
            pass
    md = _safe_metadata(action)
    fallback = md.get("target_positions")
    if fallback:
        try:
            return {str(k): float(v) for k, v in fallback.items()}
        except (TypeError, ValueError):
            return {}
    return {}


# ---------------------------------------------------------------------------
# Profiles — one per BusinessActionType
# ---------------------------------------------------------------------------


def _form_coalition(state: WorldState, action: StrategicAction) -> None:
    md = _safe_metadata(action)
    cid = str(md.get("coalition_id") or f"coalition_{action.action_id[:8]}")
    members = {action.actor_id}
    members.update(_target_ids(action))
    state.coalitions[cid] = members
    # Lightweight trust broadcast — the action's targets get a small
    # trust bump with the actor. Beliefs stay untouched (this is not
    # a belief-shifting action).
    actor = action.actor_id
    for tid in _target_ids(action):
        existing = state.beliefs.setdefault(actor, state.beliefs.get(actor) or _empty_belief())
        # No position change; record coalition membership via event only.
    state.add_event({
        "type": BusinessActionType.FORM_COALITION.value,
        "actor": actor,
        "coalition_id": cid,
        "members": sorted(members),
    })
    _record_touched(action, "coalitions", coalition_id=cid)


def _endorse_proposal(state: WorldState, action: StrategicAction) -> None:
    md = _safe_metadata(action)
    pid = str(md.get("proposal_id") or f"prop_{action.action_id[:8]}")
    state.proposals[pid] = ProposalEntry(
        status=ProposalStatus.ENDORSED,
        proposed_by=action.actor_id,
        target=md.get("target", ""),
        amount=float(md.get("amount", 0.0) or 0.0),
    )
    state.add_event({
        "type": BusinessActionType.ENDORSE_PROPOSAL.value,
        "actor": action.actor_id,
        "proposal_id": pid,
    })
    _record_touched(action, "proposals", proposal_id=pid)


def _block_proposal(state: WorldState, action: StrategicAction) -> None:
    md = _safe_metadata(action)
    pid = str(md.get("proposal_id") or f"prop_{action.action_id[:8]}")
    state.proposals[pid] = ProposalEntry(
        status=ProposalStatus.BLOCKED,
        proposed_by=action.actor_id,
        target=md.get("target", ""),
        amount=float(md.get("amount", 0.0) or 0.0),
    )
    state.add_event({
        "type": BusinessActionType.BLOCK_PROPOSAL.value,
        "actor": action.actor_id,
        "proposal_id": pid,
    })
    _record_touched(action, "proposals", proposal_id=pid)


def _pivot_strategy(state: WorldState, action: StrategicAction) -> None:
    """Re-weight budget_ledger between two depts by ±X%.

    ``metadata.from_dept`` and ``metadata.to_dept`` name the two
    departments; ``metadata.delta_pct`` is a float in (-1.0, 1.0).
    We try to read the matching keys from ``budget_ledger``; if a
    dept has no ledger entry we treat its balance as 0.
    """
    md = _safe_metadata(action)
    from_dept = str(md.get("from_dept") or "")
    to_dept = str(md.get("to_dept") or "")
    delta = float(md.get("delta_pct", 0.1) or 0.0)
    if not from_dept or not to_dept or from_dept == to_dept:
        # Without a clear pair, fall back to adding a single project.
        project_id = f"{from_dept or 'dept'}::{action.action_id[:8]}"
        new_amount = float(md.get("amount", 1.0) or 0.0)
        state.budget_ledger[project_id] = new_amount
        _record_touched(action, "budget_ledger", project_id=project_id, reason="pivot_fallback")
        state.add_event({
            "type": BusinessActionType.PIVOT_STRATEGY.value,
            "actor": action.actor_id,
            "project_id": project_id,
            "delta_pct": delta,
        })
        return
    # Find ledger entries for the two depts. Strategy keys look like
    # ``"<dept>::<project>"`` but we also accept exact-match.
    from_keys = [k for k in state.budget_ledger if k.split("::", 1)[0] == from_dept] or [from_dept]
    to_keys = [k for k in state.budget_ledger if k.split("::", 1)[0] == to_dept] or [to_dept]
    transfer = 0.0
    for k in from_keys:
        v = float(state.budget_ledger.get(k, 0.0) or 0.0)
        transfer += v * abs(delta)
    transfer = round(transfer, 4)
    # Capture the divisor BEFORE the loop — re-evaluating sum() after
    # each from_key mutation shrinks the divisor and breaks conservation
    # (Bug F15).
    divisor = max(
        sum(float(state.budget_ledger.get(x, 0.0) or 0.0) for x in from_keys),
        1e-9,
    )
    for k in from_keys:
        v = float(state.budget_ledger.get(k, 0.0) or 0.0)
        state.budget_ledger[k] = round(v - transfer * (v / divisor), 4)
    for k in to_keys:
        v = float(state.budget_ledger.get(k, 0.0) or 0.0)
        state.budget_ledger[k] = round(v + transfer * (1.0 / max(len(to_keys), 1)), 4)
    state.add_event({
        "type": BusinessActionType.PIVOT_STRATEGY.value,
        "actor": action.actor_id,
        "from_dept": from_dept,
        "to_dept": to_dept,
        "delta_pct": delta,
        "transfer": transfer,
    })
    _record_touched(action, "budget_ledger", from_dept=from_dept, to_dept=to_dept, transfer=transfer)


def _allocate_budget(state: WorldState, action: StrategicAction) -> None:
    md = _safe_metadata(action)
    project_id = str(md.get("project_id") or f"proj_{action.action_id[:8]}")
    delta = float(md.get("amount", md.get("delta", 0.0)) or 0.0)
    state.budget_ledger[project_id] = round(
        float(state.budget_ledger.get(project_id, 0.0) or 0.0) + delta, 4
    )
    state.add_event({
        "type": BusinessActionType.ALLOCATE_BUDGET.value,
        "actor": action.actor_id,
        "project_id": project_id,
        "delta": delta,
    })
    _record_touched(action, "budget_ledger", project_id=project_id, delta=delta)


def _trade_asset(state: WorldState, action: StrategicAction, *, concealed: bool = False) -> None:
    md = _safe_metadata(action)
    asset_id = str(md.get("asset_id") or f"asset_{action.action_id[:8]}")
    new_owner = _first_target(action) or md.get("new_owner") or action.actor_id
    value = float(md.get("value", 1000.0) or 0.0)
    transferable = bool(md.get("transferable", True))
    state.asset_registry[asset_id] = AssetEntry(
        owner=new_owner, value=value, transferable=transferable
    )
    if concealed:
        # CONCEALED_TRADE adds a RUMOR leak.
        action.propagation_channels = list(action.propagation_channels) + [
            PropagationChannel.RUMOR
        ]
    state.add_event({
        "type": (
            BusinessActionType.CONCEALED_TRADE.value
            if concealed else BusinessActionType.TRADE_ASSET.value
        ),
        "actor": action.actor_id,
        "asset_id": asset_id,
        "new_owner": new_owner,
        "value": value,
        "concealed": concealed,
    })
    _record_touched(action, "asset_registry", asset_id=asset_id, concealed=concealed)


def _concealed_trade(state: WorldState, action: StrategicAction) -> None:
    _trade_asset(state, action, concealed=True)


def _leak_information(state: WorldState, action: StrategicAction) -> None:
    """LEAK_INFORMATION — RUMOR channel + trust delta to targets.

    The "discovery roll" is a small deterministic Bernoulli using
    ``action.metadata.discovery_prob`` (default 0.3). When the leak
    is "discovered", the actor's trust with all targets drops by
    0.05; otherwise the leak stays in the RUMOR channel only.
    """
    md = _safe_metadata(action)
    discovery_prob = float(md.get("discovery_prob", 0.3) or 0.0)
    # Use a deterministic seed if provided, else fall back to action_id hash.
    import hashlib
    seed = int(hashlib.md5(action.action_id.encode()).hexdigest()[:8], 16)
    discovered = (seed % 1000) / 1000.0 < discovery_prob
    actor = action.actor_id
    target_vec = state.beliefs.setdefault(actor, _empty_belief())
    if discovered:
        # trust+position delta — recorded as a belief event, not a structural mutation.
        state.add_event({
            "type": BusinessActionType.LEAK_INFORMATION.value,
            "actor": actor,
            "discovered": True,
            "trust_delta": -0.05,
            "targets": _target_ids(action),
        })
    else:
        state.add_event({
            "type": BusinessActionType.LEAK_INFORMATION.value,
            "actor": actor,
            "discovered": False,
            "targets": _target_ids(action),
        })
    _record_touched(
        action,
        "events",  # leaks are events + RUMOR, not a structural slice mutation
        discovered=discovered,
    )


def _make_statement(state: WorldState, action: StrategicAction) -> None:
    """MAKE_STATEMENT — trust + position delta only (no structural slice).

    If the LLM supplied ``target_positions`` (topic -> position in
    [-1, 1]), each value is applied to ``state.beliefs[actor].positions[topic]``
    (clamped). If absent, falls back to the legacy hardcoded
    ``position_delta=0.05`` / ``confidence_delta=0.02``.
    """
    actor = action.actor_id
    target_vec = state.beliefs.setdefault(actor, _empty_belief())
    target_positions = _get_target_positions(action)
    topic = (action.metadata or {}).get("topic", "general")
    if target_positions:
        # Apply LLM-supplied positions, clamped to [-1, 1].
        for t, raw in target_positions.items():
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            target_vec.positions[t] = max(-1.0, min(1.0, value))
            # Light confidence bump per touched topic; mirrors legacy 0.02.
            target_vec.confidence[t] = min(
                1.0, target_vec.confidence.get(t, 0.5) + 0.02
            )
    else:
        # Legacy behavior: single hardcoded delta on the metadata topic.
        position_delta = 0.05
        confidence_delta = 0.02
        pos = target_vec.positions.get(topic, 0.0) + position_delta
        target_vec.positions[topic] = max(-1.0, min(1.0, pos))
        target_vec.confidence[topic] = min(
            1.0, target_vec.confidence.get(topic, 0.5) + confidence_delta
        )
    state.add_event({
        "type": BusinessActionType.MAKE_STATEMENT.value,
        "actor": actor,
        "topic": topic,
    })
    _record_touched(action, "beliefs", topic=topic)


def _brief_board(state: WorldState, action: StrategicAction) -> None:
    """BRIEF_BOARD — direct channel only, no structural change.

    The board action is logged as an event; belief/confidence on the
    actor bumps a tiny amount to reflect self-reinforcement of the
    public position.

    If the LLM supplied ``target_positions`` (topic -> position in
    [-1, 1]), apply them to ``state.beliefs[actor].positions[topic]``
    (clamped) and bump confidence on each touched topic by the legacy
    0.01 amount. Otherwise, fall back to the legacy single
    ``board_confidence`` bump.
    """
    actor = action.actor_id
    target_vec = state.beliefs.setdefault(actor, _empty_belief())
    target_positions = _get_target_positions(action)
    if target_positions:
        for t, raw in target_positions.items():
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            target_vec.positions[t] = max(-1.0, min(1.0, value))
            target_vec.confidence[t] = min(
                1.0, target_vec.confidence.get(t, 0.5) + 0.01
            )
    else:
        target_vec.confidence["board_confidence"] = min(
            1.0, target_vec.confidence.get("board_confidence", 0.5) + 0.01
        )
    state.add_event({
        "type": BusinessActionType.BRIEF_BOARD.value,
        "actor": actor,
    })
    _record_touched(action, "beliefs", topic="board_confidence")


def _hire_talent(state: WorldState, action: StrategicAction) -> None:
    """HIRE_TALENT — adds a new asset (the hire) to the asset_registry.

    The hire is treated as a transferable asset owned by the actor's
    department (or the actor themselves when no department is given).
    """
    md = _safe_metadata(action)
    asset_id = str(md.get("asset_id") or f"hire_{action.action_id[:8]}")
    owner = str(md.get("owner") or action.actor_id)
    value = float(md.get("value", 50_000.0) or 0.0)
    state.asset_registry[asset_id] = AssetEntry(
        owner=owner, value=value, transferable=True
    )
    state.add_event({
        "type": BusinessActionType.HIRE_TALENT.value,
        "actor": action.actor_id,
        "asset_id": asset_id,
        "owner": owner,
        "value": value,
    })
    _record_touched(action, "asset_registry", asset_id=asset_id)


def _exit_market(state: WorldState, action: StrategicAction) -> None:
    """EXIT_MARKET — moves any asset owned by the actor out of the registry."""
    md = _safe_metadata(action)
    sector = str(md.get("sector") or "default")
    to_remove = [
        aid for aid, entry in state.asset_registry.items()
        if entry.owner == action.actor_id
    ]
    for aid in to_remove:
        del state.asset_registry[aid]
    state.add_event({
        "type": BusinessActionType.EXIT_MARKET.value,
        "actor": action.actor_id,
        "sector": sector,
        "assets_removed": to_remove,
    })
    _record_touched(action, "asset_registry", sector=sector, removed=to_remove)


def _empty_belief():
    from ...models.world_state import BeliefVector
    return BeliefVector()


# ---------------------------------------------------------------------------
# Profile table
# ---------------------------------------------------------------------------


ACTION_PROFILES: Dict[BusinessActionType, ProfileFn] = {
    BusinessActionType.FORM_COALITION: _form_coalition,
    BusinessActionType.ENDORSE_PROPOSAL: _endorse_proposal,
    BusinessActionType.BLOCK_PROPOSAL: _block_proposal,
    BusinessActionType.PIVOT_STRATEGY: _pivot_strategy,
    BusinessActionType.ALLOCATE_BUDGET: _allocate_budget,
    BusinessActionType.TRADE_ASSET: _trade_asset,
    BusinessActionType.CONCEALED_TRADE: _concealed_trade,
    BusinessActionType.LEAK_INFORMATION: _leak_information,
    BusinessActionType.MAKE_STATEMENT: _make_statement,
    BusinessActionType.BRIEF_BOARD: _brief_board,
    BusinessActionType.HIRE_TALENT: _hire_talent,
    BusinessActionType.EXIT_MARKET: _exit_market,
}


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


@dataclass
class ActionResolver:
    """Apply a :class:`StrategicAction` to a :class:`WorldState`.

    The resolver is stateless — it just dispatches to the right
    profile in :data:`ACTION_PROFILES`. Tests can construct one
    directly; the engine and the simulation loop share an instance.
    """

    def resolve(self, state: WorldState, action: StrategicAction) -> WorldState:
        """Apply ``action`` to ``state`` in-place and return ``state``."""
        if state is None:
            raise ValueError("state must not be None")
        if action is None:
            raise ValueError("action must not be None")

        # Map v1 -> v2 then dispatch (or honour the explicit meta tag
        # for v2-only types like HIRE_TALENT / EXIT_MARKET).
        btype = get_business_type(action)
        profile = ACTION_PROFILES.get(btype)
        if profile is None:
            _record_warning(action, f"no profile for {btype}")
            return state

        try:
            profile(state, action)
        except Exception as exc:  # pragma: no cover - defensive
            _record_warning(action, f"profile {btype} failed: {exc}")
            logger.warning("ActionResolver profile %s failed: %s", btype, exc)
        return state

    def resolve_many(
        self, state: WorldState, actions: List[StrategicAction]
    ) -> WorldState:
        """Apply a list of actions in order. Convenience for the engine."""
        for action in actions or []:
            self.resolve(state, action)
        return state


__all__ = [
    "ACTION_PROFILES",
    "ActionResolver",
    "ProfileFn",
    "MUTATING_TYPES",
]
