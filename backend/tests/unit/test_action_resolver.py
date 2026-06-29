"""
Unit tests for ActionResolver + ACTION_PROFILES (T1.4).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.4):

* For each of the 12 BusinessActionType values, applying one action
  mutates a *specific* WorldState slice AND leaves the other slices
  unchanged. This is the unit-level fix for "decorative action types"
  (audit §1.1).
"""
from __future__ import annotations

import copy

import pytest

from backend.models.action_type import ActionType, StrategicAction
from backend.models.world_state import (
    AssetEntry,
    ProposalStatus,
    WorldState,
)
from backend.services.loop.action_resolver import ActionResolver
from backend.services.loop.action_taxonomy import (
    BusinessActionType,
    set_business_type,
)


# ---------------------------------------------------------------------------
# Fixture factories
# ---------------------------------------------------------------------------


def _make_state() -> WorldState:
    return WorldState(
        coalitions={"c_pre": {"agent_x"}},
        budget_ledger={"dept_a::p1": 10.0, "dept_b::p2": 5.0},
        asset_registry={
            "asset_1": AssetEntry(owner="agent_x", value=100.0),
        },
        proposals={},
        beliefs={},
        events=[],
    )


def _make_action(
    btype: BusinessActionType,
    *,
    actor_id: str = "agent_1",
    target_ids=None,
    metadata=None,
    in_reply_to=None,
) -> StrategicAction:
    return StrategicAction(
        action_type=ActionType.FORM_COALITION,  # overridden below if needed
        actor_id=actor_id,
        target_ids=list(target_ids or []),
        metadata=metadata or {},
        in_reply_to=in_reply_to,
    )


# Each test parametrizes over the v1 ActionType that the resolver maps
# to the target BusinessActionType. The mapping is in
# ``action_taxonomy.from_v1``.
_TYPE_TO_V1 = {
    BusinessActionType.FORM_COALITION: ActionType.FORM_COALITION,
    BusinessActionType.ENDORSE_PROPOSAL: ActionType.PROPOSE_DEAL,
    BusinessActionType.BLOCK_PROPOSAL: ActionType.LEAVE_COALITION,
    BusinessActionType.PIVOT_STRATEGY: ActionType.PRIVATE_MEETING,
    BusinessActionType.ALLOCATE_BUDGET: ActionType.ACCUMULATE_POSITION,
    BusinessActionType.TRADE_ASSET: ActionType.TRADE_ASSET,
    BusinessActionType.CONCEALED_TRADE: ActionType.CONCEALED_TRADE,
    BusinessActionType.LEAK_INFORMATION: ActionType.LEAK_INFORMATION,
    BusinessActionType.MAKE_STATEMENT: ActionType.MAKE_STATEMENT,
    BusinessActionType.BRIEF_BOARD: ActionType.NEGOTIATE,
    BusinessActionType.HIRE_TALENT: ActionType.PRIVATE_MEETING,
    BusinessActionType.EXIT_MARKET: ActionType.PRIVATE_MEETING,
}


def _make_action_for(
    btype: BusinessActionType,
    *,
    actor_id="agent_1",
    target_ids=None,
    metadata=None,
) -> StrategicAction:
    """Construct a StrategicAction that resolves to ``btype`` (v2).

    For types that have a clean v1 alias, we set ``action_type`` to
    the v1 value (``from_v1`` then maps it). For v2-only types
    (HIRE_TALENT, EXIT_MARKET) we tag the action via
    ``set_business_type``.
    """
    a = StrategicAction(
        action_type=_TYPE_TO_V1[btype],
        actor_id=actor_id,
        target_ids=list(target_ids or []),
        metadata=metadata or {},
    )
    set_business_type(a, btype)
    return a


# ---------------------------------------------------------------------------
# One test per type
# ---------------------------------------------------------------------------


def test_form_coalition_mutates_coalitions_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.FORM_COALITION,
        actor_id="agent_1",
        target_ids=["agent_2", "agent_3"],
        metadata={"coalition_id": "c_new"},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "coalitions" in touched
    # Other structural slices unchanged
    for slice_name in ("budget_ledger", "asset_registry", "proposals"):
        assert slice_name not in touched, (
            f"FORM_COALITION should not mutate {slice_name}, got {touched}"
        )
    assert "c_new" in state.coalitions
    assert "agent_1" in state.coalitions["c_new"]


def test_endorse_proposal_mutates_proposals_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.ENDORSE_PROPOSAL,
        actor_id="agent_1",
        target_ids=["agent_2"],
        metadata={"proposal_id": "p_alpha", "target": "dept_x", "amount": 5.0},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "proposals" in touched
    assert "coalitions" not in touched
    assert "budget_ledger" not in touched
    assert "asset_registry" not in touched
    assert state.proposals["p_alpha"].status is ProposalStatus.ENDORSED


def test_block_proposal_mutates_proposals_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.BLOCK_PROPOSAL,
        actor_id="agent_1",
        metadata={"proposal_id": "p_block"},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "proposals" in touched
    assert state.proposals["p_block"].status is ProposalStatus.BLOCKED
    assert "coalitions" not in touched
    assert "asset_registry" not in touched


def test_pivot_strategy_mutates_budget_ledger_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.PIVOT_STRATEGY,
        actor_id="agent_1",
        metadata={"from_dept": "dept_a", "to_dept": "dept_b", "delta_pct": 0.5},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "budget_ledger" in touched
    assert "coalitions" not in touched
    assert "asset_registry" not in touched
    assert "proposals" not in touched


def test_allocate_budget_mutates_budget_ledger_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.ALLOCATE_BUDGET,
        actor_id="agent_1",
        metadata={"project_id": "dept_x::proj_new", "amount": 3.5},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "budget_ledger" in touched
    assert "coalitions" not in touched
    assert "asset_registry" not in touched
    assert "proposals" not in touched
    assert state.budget_ledger["dept_x::proj_new"] == 3.5


def test_trade_asset_mutates_asset_registry_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.TRADE_ASSET,
        actor_id="agent_1",
        target_ids=["agent_2"],
        metadata={"asset_id": "asset_42", "value": 50.0},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "asset_registry" in touched
    assert "coalitions" not in touched
    assert "budget_ledger" not in touched
    assert "proposals" not in touched
    assert state.asset_registry["asset_42"].owner == "agent_2"


def test_concealed_trade_mutates_asset_registry_and_adds_rumor_channel():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.CONCEALED_TRADE,
        actor_id="agent_1",
        target_ids=["agent_2"],
        metadata={"asset_id": "asset_77", "value": 25.0},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "asset_registry" in touched
    # RUMOR channel added (per spec)
    from backend.models.action_type import PropagationChannel
    assert PropagationChannel.RUMOR in action.propagation_channels


def test_leak_information_does_not_mutate_structural_slices():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.LEAK_INFORMATION,
        actor_id="agent_1",
        target_ids=["agent_2"],
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    # LEAK_INFORMATION records an event only; no structural change.
    for slice_name in ("coalitions", "budget_ledger", "asset_registry", "proposals"):
        assert slice_name not in touched, (
            f"LEAK_INFORMATION should not mutate {slice_name}"
        )
    # The resolver stamps the event as the touched slice.
    assert "events" in touched or "beliefs" in touched  # events always, beliefs possibly


def test_make_statement_does_not_mutate_structural_slices():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.MAKE_STATEMENT,
        actor_id="agent_1",
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    for slice_name in ("coalitions", "budget_ledger", "asset_registry", "proposals"):
        assert slice_name not in touched, (
            f"MAKE_STATEMENT should not mutate {slice_name}"
        )


def test_brief_board_does_not_mutate_structural_slices():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.BRIEF_BOARD,
        actor_id="agent_1",
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    for slice_name in ("coalitions", "budget_ledger", "asset_registry", "proposals"):
        assert slice_name not in touched


def test_hire_talent_mutates_asset_registry_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.HIRE_TALENT,
        actor_id="agent_1",
        metadata={"asset_id": "hire_99", "value": 80_000.0, "owner": "dept_x"},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "asset_registry" in touched
    assert "coalitions" not in touched
    assert "budget_ledger" not in touched
    assert "proposals" not in touched
    assert state.asset_registry["hire_99"].owner == "dept_x"


def test_exit_market_mutates_asset_registry_only():
    prev = _make_state()
    state = copy.deepcopy(prev)
    action = _make_action_for(
        BusinessActionType.EXIT_MARKET,
        actor_id="agent_x",  # owner of asset_1
        metadata={"sector": "tech"},
    )
    ActionResolver().resolve(state, action)
    diff = state.diff(prev)
    touched = {d.slice for d in diff}
    assert "asset_registry" in touched
    assert "asset_1" not in state.asset_registry
    assert "coalitions" not in touched
    assert "budget_ledger" not in touched
    assert "proposals" not in touched


# ---------------------------------------------------------------------------
# Resolver-level guarantees
# ---------------------------------------------------------------------------


def test_resolver_is_pure_for_structural_actions():
    """Resolving the same action twice produces the same structural result."""
    s1 = _make_state()
    s2 = _make_state()
    a1 = _make_action_for(
        BusinessActionType.ALLOCATE_BUDGET,
        actor_id="agent_1",
        metadata={"project_id": "p_x", "amount": 1.0},
    )
    a2 = _make_action_for(
        BusinessActionType.ALLOCATE_BUDGET,
        actor_id="agent_1",
        metadata={"project_id": "p_x", "amount": 1.0},
    )
    # action_id is uuid4 and would differ between calls — that's
    # fine; we only check the structural slice, not the metadata.
    ActionResolver().resolve(s1, a1)
    ActionResolver().resolve(s2, a2)
    assert s1.budget_ledger == s2.budget_ledger


def test_resolver_handles_unknown_target_gracefully():
    """Malformed payloads must not raise — they just record a warning."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.PIVOT_STRATEGY,
        actor_id="agent_1",
        metadata={},  # missing from_dept / to_dept
    )
    ActionResolver().resolve(state, action)  # no raise
    # The fallback path created some project_id
    assert len(state.budget_ledger) >= 1


def test_resolver_stamps_touched_slice_metadata():
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.FORM_COALITION,
        actor_id="agent_1",
        target_ids=["agent_2"],
        metadata={"coalition_id": "c_x"},
    )
    ActionResolver().resolve(state, action)
    md = action.metadata or {}
    assert md.get("resolver", {}).get("touched_slice") == "coalitions"


# ---------------------------------------------------------------------------
# Cluster C regression tests — F14 / F15 (action_resolver.py)
# ---------------------------------------------------------------------------
#
# F14: ``_make_statement`` / ``_brief_board`` must honour the LLM-supplied
# ``target_positions`` attribute (or metadata-dict fallback) and apply each
# value to ``state.beliefs[actor].positions[topic]`` clamped to [-1, 1].
# Without ``target_positions`` the legacy 0.05 delta on the metadata topic
# must still apply (back-compat).
#
# F15: ``_pivot_strategy`` must re-balance budget_ledger proportionally
# across all ``<from_dept>::<project>`` keys (and *not* shrink the divisor
# as it mutates).
# ---------------------------------------------------------------------------


def test_make_statement_with_target_positions_sets_belief_clamped():
    """F14: ``_make_statement`` honours ``target_positions`` and clamps to [-1, 1]."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.MAKE_STATEMENT,
        actor_id="agent_1",
        metadata={"topic": "market"},
    )
    # Attach the LLM payload via ad-hoc attribute (frozen dataclass path).
    action.target_positions = {"market": 0.7}
    ActionResolver().resolve(state, action)
    assert "agent_1" in state.beliefs
    positions = state.beliefs["agent_1"].positions
    assert positions.get("market") == pytest.approx(0.7)


def test_make_statement_with_target_positions_clamps_overflow():
    """F14: values outside [-1, 1] must be clamped, not passed through."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.MAKE_STATEMENT,
        actor_id="agent_2",
        metadata={"topic": "market"},
    )
    action.target_positions = {"market": 5.0, "risk": -3.0}
    ActionResolver().resolve(state, action)
    positions = state.beliefs["agent_2"].positions
    assert positions["market"] == 1.0
    assert positions["risk"] == -1.0


def test_make_statement_without_target_positions_uses_legacy_delta():
    """F14 (back-compat): without ``target_positions`` the legacy 0.05 delta applies."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.MAKE_STATEMENT,
        actor_id="agent_3",
        metadata={"topic": "policy"},
    )
    # Explicitly ensure no ad-hoc attr or metadata-dict key is set.
    assert getattr(action, "target_positions", None) is None
    assert "target_positions" not in (action.metadata or {})
    ActionResolver().resolve(state, action)
    positions = state.beliefs["agent_3"].positions
    assert positions.get("policy") == pytest.approx(0.05)


def test_make_statement_target_positions_via_metadata_fallback():
    """F14 (metadata-dict fallback): ``metadata.target_positions`` is honoured."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.MAKE_STATEMENT,
        actor_id="agent_4",
        metadata={"topic": "market", "target_positions": {"market": -0.4}},
    )
    ActionResolver().resolve(state, action)
    positions = state.beliefs["agent_4"].positions
    assert positions.get("market") == pytest.approx(-0.4)


def test_brief_board_with_target_positions_uses_llm_value():
    """F14: ``_brief_board`` applies LLM-supplied ``target_positions`` (clamped)."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.BRIEF_BOARD,
        actor_id="agent_5",
    )
    action.target_positions = {"growth": 0.85, "cost": 1.5}
    ActionResolver().resolve(state, action)
    positions = state.beliefs["agent_5"].positions
    assert positions["growth"] == pytest.approx(0.85)
    assert positions["cost"] == 1.0  # clamped


def test_brief_board_without_target_positions_uses_legacy_bump():
    """F14 (back-compat): without target_positions, BRIEF_BOARD bumps only
    ``board_confidence`` (no positions are written)."""
    state = _make_state()
    action = _make_action_for(
        BusinessActionType.BRIEF_BOARD,
        actor_id="agent_6",
    )
    assert getattr(action, "target_positions", None) is None
    assert "target_positions" not in (action.metadata or {})
    ActionResolver().resolve(state, action)
    confidence = state.beliefs["agent_6"].confidence
    assert "board_confidence" in confidence
    assert confidence["board_confidence"] == pytest.approx(0.51)
    # No positions should be written by the legacy path
    assert state.beliefs["agent_6"].positions == {}


def test_pivot_strategy_proportional_rebalance_across_from_keys():
    """F15: pivot must split the transfer proportionally to each from_key's value.

    With ``from_dept="a"``, ``delta_pct=0.5`` and ledger
    ``{"a::p1": 100, "a::p2": 50}``, the transfer is 0.5*(100+50) = 75.
    Each from_key loses ``transfer * (v / divisor)`` where
    ``divisor = 100 + 50 = 150`` (captured BEFORE mutation, per Bug F15 fix).

    * p1 loses 75 * (100/150) = 50  (so 100 -> 50)
    * p2 loses 75 * (50/150)  = 25  (so 50  -> 25)

    The transfer lands entirely on the to-side; this test focuses on the
    proportional split on the from-side which is the F15 regression.
    """
    state = WorldState(
        coalitions={},
        budget_ledger={"a::p1": 100.0, "a::p2": 50.0, "b::q1": 10.0},
        asset_registry={},
        proposals={},
        beliefs={},
        events=[],
    )
    action = _make_action_for(
        BusinessActionType.PIVOT_STRATEGY,
        actor_id="agent_1",
        metadata={"from_dept": "a", "to_dept": "b", "delta_pct": 0.5},
    )
    ActionResolver().resolve(state, action)
    # Proportional rebalance: divisor (150) is preserved across the loop.
    assert state.budget_ledger["a::p1"] == pytest.approx(50.0)
    assert state.budget_ledger["a::p2"] == pytest.approx(25.0)


def test_pivot_strategy_uses_initial_divisor_not_shrinking_sum():
    """F15: regression — divisor must equal the *initial* sum of from_keys,
    not the shrinking sum during mutation.

    If the buggy ``sum()`` re-eval were used, ``a::p1`` (100) would lose
    75 * (100/100) = 75 first (going to 25), and then ``a::p2`` (50)
    would lose 75 * (50/25) = 150 (going negative). Conservation is broken.

    The fixed implementation captures the divisor BEFORE the loop, so
    the relative shares remain 2:1 and the loss is exactly 50 / 25.
    """
    state = WorldState(
        coalitions={},
        budget_ledger={"a::p1": 100.0, "a::p2": 50.0},
        asset_registry={},
        proposals={},
        beliefs={},
        events=[],
    )
    action = _make_action_for(
        BusinessActionType.PIVOT_STRATEGY,
        actor_id="agent_1",
        metadata={"from_dept": "a", "to_dept": "b", "delta_pct": 0.5},
    )
    ActionResolver().resolve(state, action)
    # The fixed path: 2:1 ratio preserved, no negatives.
    p1, p2 = state.budget_ledger["a::p1"], state.budget_ledger["a::p2"]
    assert p1 == pytest.approx(50.0)
    assert p2 == pytest.approx(25.0)
    # The buggy path would have produced p1=25, p2=-100 — assert against that.
    assert p2 >= 0.0, "F15 regression: p2 went negative (divisor shrank mid-loop)"


def test_pivot_strategy_conservation_with_equal_keys():
    """F15: with two equal-valued from_keys the split is exactly 50/50."""
    state = WorldState(
        coalitions={},
        budget_ledger={"a::p1": 80.0, "a::p2": 80.0, "b::q1": 5.0},
        asset_registry={},
        proposals={},
        beliefs={},
        events=[],
    )
    action = _make_action_for(
        BusinessActionType.PIVOT_STRATEGY,
        actor_id="agent_1",
        metadata={"from_dept": "a", "to_dept": "b", "delta_pct": 0.5},
    )
    ActionResolver().resolve(state, action)
    # transfer = 0.5 * 160 = 80; each side gets 40.
    assert state.budget_ledger["a::p1"] == pytest.approx(40.0)
    assert state.budget_ledger["a::p2"] == pytest.approx(40.0)
