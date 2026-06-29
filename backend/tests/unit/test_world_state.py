"""
Unit tests for backend.models.world_state.

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T0.1):

* Construct a state, apply 3 distinct mutations, assert ``diff()`` returns
  3 non-empty change records.
* Round-trip ``to_dict`` / ``from_dict`` is lossless.
* Each helper slice type round-trips on its own.
"""
from __future__ import annotations

import copy

import pytest

from backend.models.world_state import (
    AssetEntry,
    BeliefVector,
    ChangeRecord,
    ProposalEntry,
    ProposalStatus,
    WorldState,
)


# ---------------------------------------------------------------------------
# Helpers — small factories that make the test body read like the spec.
# ---------------------------------------------------------------------------


def _apply_form_coalition(state: WorldState, coalition_id: str, members: list) -> None:
    state.coalitions[coalition_id] = set(members)


def _apply_pivot_strategy(state: WorldState, project_id: str, new_amount: float) -> None:
    state.budget_ledger[project_id] = new_amount


def _apply_trade_asset(
    state: WorldState, asset_id: str, owner: str, value: float
) -> None:
    state.asset_registry[asset_id] = AssetEntry(owner=owner, value=value)


def _apply_proposal(
    state: WorldState, proposal_id: str, status: ProposalStatus
) -> None:
    state.proposals[proposal_id] = ProposalEntry(
        status=status, proposed_by="agent_1", target="dept_x", amount=10.0
    )


def _apply_belief_shift(
    state: WorldState, agent_id: str, topic: str, position: float, confidence: float
) -> None:
    vec = state.beliefs.setdefault(agent_id, BeliefVector())
    vec.positions[topic] = position
    vec.confidence[topic] = confidence


# ---------------------------------------------------------------------------
# diff() — the load-bearing acceptance test
# ---------------------------------------------------------------------------


def test_diff_returns_three_distinct_change_records_for_three_mutations():
    """T0.1 acceptance: 3 mutations → 3 distinct non-empty records."""
    state = WorldState()
    prev = copy.deepcopy(state)

    # Three distinct slices — the v1 simulation conflated all three into
    # "trust +X". The audit demands they are now distinguishable.
    _apply_form_coalition(state, "c1", ["agent_a", "agent_b"])
    _apply_pivot_strategy(state, "dept_x::proj_alpha", 0.6)
    _apply_trade_asset(state, "asset_patent_42", "agent_b", 100_000.0)

    diff = state.diff(prev)

    # Exactly three slices were touched.
    slices = {rec.slice for rec in diff}
    assert slices == {"coalitions", "budget_ledger", "asset_registry"}, slices

    # Each record is non-empty and identifiable.
    by_slice = {rec.slice: rec for rec in diff}
    assert by_slice["coalitions"].op == "added"
    assert by_slice["coalitions"].path == "c1"
    assert by_slice["coalitions"].after == ["agent_a", "agent_b"]

    assert by_slice["budget_ledger"].path == "dept_x::proj_alpha"
    assert by_slice["budget_ledger"].after == 0.6

    assert by_slice["asset_registry"].path == "asset_patent_42"
    assert by_slice["asset_registry"].after == {
        "owner": "agent_b",
        "value": 100_000.0,
        "transferable": True,
    }

    # The change records carry the right metadata for Phase 1 routing.
    for rec in diff:
        assert isinstance(rec, ChangeRecord)
        assert rec.path


def test_diff_emits_one_record_per_new_event():
    """Events are append-only — the diff should fan out per new event."""
    state = WorldState()
    prev = copy.deepcopy(state)

    state.add_event({"type": "FORM_COALITION", "actor": "a1"})
    state.add_event({"type": "TRADE_ASSET", "actor": "a2"})
    state.add_event({"type": "PIVOT_STRATEGY", "actor": "a3"})

    diff = state.diff(prev)
    event_records = [r for r in diff if r.slice == "events"]
    assert len(event_records) == 3
    assert [r.op for r in event_records] == ["appended", "appended", "appended"]
    assert [r.path for r in event_records] == ["0", "1", "2"]


def test_diff_returns_empty_when_nothing_changed():
    state = WorldState()
    state.budget_ledger["p1"] = 1.0
    prev = copy.deepcopy(state)
    assert state.diff(prev) == []


# ---------------------------------------------------------------------------
# Round-trip — the second half of the acceptance test
# ---------------------------------------------------------------------------


def test_to_dict_from_dict_round_trip_is_lossless():
    """T0.1 acceptance: to_dict → from_dict returns an equal WorldState."""
    original = WorldState(
        coalitions={"c1": {"a", "b"}, "c2": {"c"}},
        budget_ledger={"dept_x::p1": 0.4, "dept_y::p2": 0.6},
        asset_registry={
            "asset_1": AssetEntry(owner="a", value=10.0),
            "asset_2": AssetEntry(owner="b", value=20.0, transferable=False),
        },
        proposals={
            "p_alpha": ProposalEntry(
                status=ProposalStatus.ENDORSED,
                proposed_by="a",
                target="dept_x",
                amount=5.0,
            ),
            "p_beta": ProposalEntry(
                status=ProposalStatus.BLOCKED,
                proposed_by="b",
                target="dept_y",
                amount=0.0,
            ),
        },
        beliefs={
            "a": BeliefVector(
                positions={"market": 0.7}, confidence={"market": 0.8}
            ),
            "b": BeliefVector(positions={"policy": -0.3}, confidence={"policy": 0.5}),
        },
    )
    original.add_event({"type": "MAKE_STATEMENT", "actor": "a", "text": "hi"})

    # Deepcopy guards against reference-sharing bugs in from_dict.
    snapshot = original.to_dict()
    restored = WorldState.from_dict(copy.deepcopy(snapshot))

    # Top-level dicts are equal.
    assert restored.to_dict() == original.to_dict()

    # And the per-slice shapes survive — frozen sets, dataclasses, enums.
    assert restored.coalitions == original.coalitions
    assert restored.budget_ledger == original.budget_ledger
    assert restored.asset_registry.keys() == original.asset_registry.keys()
    for aid, entry in restored.asset_registry.items():
        assert entry == original.asset_registry[aid]
    for pid, prop in restored.proposals.items():
        assert prop.status == original.proposals[pid].status
        assert prop.proposed_by == original.proposals[pid].proposed_by
    assert restored.beliefs == original.beliefs
    assert restored.events == original.events


def test_from_dict_tolerates_missing_keys():
    """from_dict must not crash on a sparse payload (defensive)."""
    sparse = {
        "coalitions": {"c1": ["a", "b"]},
        "budget_ledger": {},
    }
    state = WorldState.from_dict(sparse)
    assert state.coalitions == {"c1": {"a", "b"}}
    assert state.budget_ledger == {}
    assert state.asset_registry == {}
    assert state.proposals == {}
    assert state.beliefs == {}
    assert state.events == []


# ---------------------------------------------------------------------------
# Slice-type round-trips — small focused tests for each helper class.
# ---------------------------------------------------------------------------


def test_asset_entry_round_trip():
    entry = AssetEntry(owner="agent_7", value=42.0, transferable=False)
    assert AssetEntry.from_dict(entry.to_dict()) == entry


def test_proposal_entry_handles_string_status():
    entry = ProposalEntry(status=ProposalStatus.ENDORSED)
    data = entry.to_dict()
    assert data["status"] == "ENDORSED"
    rebuilt = ProposalEntry.from_dict({"status": "BLOCKED", "proposed_by": "x"})
    assert rebuilt.status is ProposalStatus.BLOCKED
    # Unknown status falls back to PENDING (defensive, not crashy).
    fallback = ProposalEntry.from_dict({"status": "GARBAGE"})
    assert fallback.status is ProposalStatus.PENDING


def test_belief_vector_round_trip():
    vec = BeliefVector(positions={"x": 0.5, "y": -0.5}, confidence={"x": 0.9})
    assert BeliefVector.from_dict(vec.to_dict()) == vec


# ---------------------------------------------------------------------------
# Mutation ergonomics — guard against regressions in helper API.
# ---------------------------------------------------------------------------


def test_add_event_copies_payload_to_avoid_aliasing():
    state = WorldState()
    payload = {"type": "FOO", "value": 1}
    state.add_event(payload)
    payload["value"] = 2  # mutate caller-side
    assert state.events[0]["value"] == 1, "events must be copied on append"


# ---------------------------------------------------------------------------
# Cluster B regression tests — diff() semantics for all 5 structural slices.
#
# F5: asset_registry new entry -> op="added"
# F5: asset_registry removed entry -> op="removed"
# F6: coalitions removed entry -> op="removed", before=sorted(prev), after=None
# F6: budget_ledger removed entry -> op="removed", before=prev value, after=None
# F6: proposals removed entry -> op="removed"
# F6: beliefs removed entry -> op="removed"
# F7: to_dict() -> from_dict() round-trip deep-copies nested lists
# ---------------------------------------------------------------------------


def test_f5_diff_asset_registry_added_emits_added_record():
    """F5: A new asset added to asset_registry emits op="added" with after=entry dict."""
    state = WorldState()
    prev = copy.deepcopy(state)

    state.asset_registry["asset_new_1"] = AssetEntry(
        owner="agent_x", value=50_000.0, transferable=True
    )

    diff = state.diff(prev)
    asset_records = [r for r in diff if r.slice == "asset_registry"]
    assert len(asset_records) == 1
    rec = asset_records[0]
    assert rec.op == "added"
    assert rec.path == "asset_new_1"
    assert rec.before is None
    assert rec.after == {
        "owner": "agent_x",
        "value": 50_000.0,
        "transferable": True,
    }


def test_f5_diff_asset_registry_removed_emits_removed_record():
    """F5: Removing an existing asset emits op="removed" with after=None."""
    prev = WorldState()
    prev.asset_registry["asset_old_1"] = AssetEntry(
        owner="agent_y", value=75_000.0, transferable=False
    )

    state = WorldState()
    state.asset_registry = {}  # asset removed

    diff = state.diff(prev)
    asset_records = [r for r in diff if r.slice == "asset_registry"]
    assert len(asset_records) == 1
    rec = asset_records[0]
    assert rec.op == "removed"
    assert rec.path == "asset_old_1"
    assert rec.before == {
        "owner": "agent_y",
        "value": 75_000.0,
        "transferable": False,
    }
    assert rec.after is None


def test_f6_diff_coalitions_removed_emits_removed_with_sorted_before():
    """F6: A removed coalition emits op="removed", before=sorted(prev set), after=None."""
    prev = WorldState()
    prev.coalitions["c1"] = {"agent_b", "agent_a", "agent_c"}  # unsorted insertion
    prev.coalitions["c2"] = {"agent_d"}  # untouched, no record

    state = WorldState()
    state.coalitions = {"c2": {"agent_d"}}  # c1 removed

    diff = state.diff(prev)
    coal_records = [r for r in diff if r.slice == "coalitions"]
    assert len(coal_records) == 1
    rec = coal_records[0]
    assert rec.op == "removed"
    assert rec.path == "c1"
    # before must be the sorted list of members from the prev coalition.
    assert rec.before == ["agent_a", "agent_b", "agent_c"]
    assert rec.after is None


def test_f6_diff_budget_ledger_removed_emits_removed_with_prev_value():
    """F6: Removing a budget_ledger entry emits op="removed", before=prev value, after=None."""
    prev = WorldState()
    prev.budget_ledger["b1"] = 0.75
    prev.budget_ledger["b2"] = 0.25  # untouched

    state = WorldState()
    state.budget_ledger = {"b2": 0.25}  # b1 removed

    diff = state.diff(prev)
    bud_records = [r for r in diff if r.slice == "budget_ledger"]
    assert len(bud_records) == 1
    rec = bud_records[0]
    assert rec.op == "removed"
    assert rec.path == "b1"
    assert rec.before == 0.75
    assert rec.after is None


def test_f6_diff_proposals_removed_emits_removed_record():
    """F6: Removing a proposal emits op="removed" with after=None."""
    prev = WorldState()
    prev.proposals["p1"] = ProposalEntry(
        status=ProposalStatus.PENDING, proposed_by="a1", target="dept_x", amount=10.0
    )
    prev.proposals["p2"] = ProposalEntry(
        status=ProposalStatus.ENDORSED, proposed_by="a2", target="dept_y", amount=20.0
    )
    prev.proposals["p3"] = ProposalEntry(
        status=ProposalStatus.BLOCKED, proposed_by="a3", target="dept_z", amount=30.0
    )

    state = WorldState()
    state.proposals = {
        "p1": prev.proposals["p1"],
        "p2": prev.proposals["p2"],
        # p3 removed
    }

    diff = state.diff(prev)
    prop_records = [r for r in diff if r.slice == "proposals"]
    assert len(prop_records) == 1
    rec = prop_records[0]
    assert rec.op == "removed"
    assert rec.path == "p3"
    assert rec.before == {
        "status": "BLOCKED",
        "proposed_by": "a3",
        "target": "dept_z",
        "amount": 30.0,
    }
    assert rec.after is None


def test_f6_diff_beliefs_removed_emits_removed_record():
    """F6: Removing a belief vector emits op="removed" with after=None."""
    prev = WorldState()
    prev.beliefs["a1"] = BeliefVector(
        positions={"market": 0.5}, confidence={"market": 0.9}
    )
    prev.beliefs["a2"] = BeliefVector(
        positions={"policy": -0.2}, confidence={"policy": 0.4}
    )

    state = WorldState()
    state.beliefs = {
        "a2": prev.beliefs["a2"],  # a1 removed
    }

    diff = state.diff(prev)
    belief_records = [r for r in diff if r.slice == "beliefs"]
    assert len(belief_records) == 1
    rec = belief_records[0]
    assert rec.op == "removed"
    assert rec.path == "a1"
    assert rec.before == {
        "positions": {"market": 0.5},
        "confidence": {"market": 0.9},
    }
    assert rec.after is None


def test_f7_round_trip_nested_list_mutation_does_not_affect_original():
    """F7: Mutating a nested list inside from_dict() result must not affect the original.

    to_dict() emits a deep copy of events (line 194: ``copy.deepcopy(e)``), so
    restoring via from_dict() and mutating the restored events' nested lists
    must NOT leak back into the source WorldState.
    """
    original = WorldState()
    original.coalitions["c1"] = {"agent_a", "agent_b"}
    original.add_event({"type": "TRADE", "items": ["x", "y"], "actor": "a1"})

    # First round-trip — get a snapshot dict.
    snapshot = original.to_dict()

    # Second round-trip — restore from snapshot (this is where the aliasing risk lives).
    restored = WorldState.from_dict(snapshot)

    # Sanity: the restored state matches the original on the slice we care about.
    assert restored.events[0]["items"] == ["x", "y"]

    # Capture the original snapshot of events for comparison.
    original_events_snapshot = copy.deepcopy(original.events)

    # Mutate the nested list inside the restored event payload.
    restored.events[0]["items"].append("z")
    restored.events[0]["items"][0] = "MUTATED"

    # The source WorldState must be untouched.
    assert original.events == original_events_snapshot, (
        f"Original WorldState.events was aliased after mutating restored copy: "
        f"original={original.events}, expected={original_events_snapshot}"
    )
    assert original.events[0]["items"] == ["x", "y"], (
        "Original WorldState.events[0]['items'] was aliased — "
        "to_dict() must deep-copy nested event payloads"
    )
