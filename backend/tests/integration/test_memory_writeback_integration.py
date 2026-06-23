"""
Integration tests for MemoryWriteback (T1.5 acceptance).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.5):

* A 2-round run produces 2 Episode nodes.
* Round-1 episode has a PERFORMED edge to the actor.
* Round-2 episode (in_reply_to round-1) has both PERFORMED and
  IN_REPLY_TO edges.
* A FORM_COALITION round produces a Coalition world_state_node
  reachable in <= 2 hops from the episode.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any, Dict, List

import pytest

from backend.models.action_type import ActionType, StrategicAction
from backend.models.world_state import WorldState
from backend.services.loop.action_resolver import ActionResolver
from backend.services.loop.action_taxonomy import (
    BusinessActionType,
    set_business_type,
)
from backend.services.loop.memory_writeback import (
    EDGE_CAUSED,
    EDGE_IN_REPLY_TO,
    EDGE_PERFORMED,
    EPISODE_NODE_TYPE,
    WORLD_STATE_NODE_TYPE,
    EpisodicMemory,
    MemoryWriteback,
)


@pytest.fixture
def tmp_memory():
    d = tempfile.mkdtemp(prefix="episodic_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------------------
# Unit-ish checks on EpisodicMemory + write_action
# ---------------------------------------------------------------------------


def _form_coalition_action(actor, targets, cid, post_content=None):
    a = StrategicAction(
        action_type=ActionType.FORM_COALITION,
        actor_id=actor,
        target_ids=list(targets),
        metadata={"coalition_id": cid},
        round_num=1,
    )
    # Bug #2: post_content >= 40 chars is required to avoid template
    # pollution. Provide a default substantive message.
    a.post_content = post_content or f"{actor} announces formation of coalition {cid} with strategic partners"
    return a


def test_write_action_creates_episode_with_performed_edge(tmp_memory):
    mem = EpisodicMemory.for_run("run_a", storage_path=tmp_memory)
    mw = MemoryWriteback(memory=mem)
    action = _form_coalition_action("agent_1", ["agent_2"], "c1")
    mw.write_action(action)
    assert action.action_id in mem.nodes
    ep = mem.nodes[action.action_id]
    assert ep["node_type"] == EPISODE_NODE_TYPE
    assert mem.has_edge("agent_1", action.action_id, EDGE_PERFORMED)


def test_two_round_run_yields_in_reply_to_edge(tmp_memory):
    """T1.5 acceptance: round-2 episode has both PERFORMED and IN_REPLY_TO edges."""
    mem = EpisodicMemory.for_run("run_two_round", storage_path=tmp_memory)
    mw = MemoryWriteback(memory=mem)

    # Round 1
    a1 = _form_coalition_action("agent_1", ["agent_2"], "c_alpha")
    a1.round_num = 1
    mw.write_action(a1)

    # Round 2 — replies to round 1
    a2 = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="agent_2",
        round_num=2,
    )
    # v2 fields live as ad-hoc attributes on the legacy dataclass.
    a2.in_reply_to = a1.action_id
    a2.post_content = "我方响应联盟成立公告, agent_2 宣布加入新联盟并阐述战略协同价值与未来发展路径"
    set_business_type(a2, BusinessActionType.MAKE_STATEMENT)
    mw.write_action(a2)

    # Both episodes exist
    assert mem.count_episodes() == 2
    # Round-1 has only PERFORMED
    assert mem.has_edge("agent_1", a1.action_id, EDGE_PERFORMED)
    assert not mem.has_edge(a1.action_id, a2.action_id, EDGE_IN_REPLY_TO)
    # Round-2 has PERFORMED + IN_REPLY_TO
    assert mem.has_edge("agent_2", a2.action_id, EDGE_PERFORMED)
    assert mem.has_edge(a2.action_id, a1.action_id, EDGE_IN_REPLY_TO)


def test_form_coalition_creates_world_state_node_reachable_in_two_hops(tmp_memory):
    """T1.5 acceptance: FORM_COALITION -> Coalition world_state_node in <= 2 hops."""
    mem = EpisodicMemory.for_run("run_coalition", storage_path=tmp_memory)
    mw = MemoryWriteback(memory=mem)

    state = WorldState()
    action = _form_coalition_action("agent_1", ["agent_2", "agent_3"], "c_beta")
    action.round_num = 3

    # Apply the action to the state first so the world_state_node has data
    ActionResolver().resolve(state, action)
    mw.write_action(action, state_after=state)

    # Episode -> CAUSED -> world_state_node
    ws_ids = [
        e["target_id"] for e in mem.edges
        if e["source_id"] == action.action_id and e["relation_type"] == EDGE_CAUSED
    ]
    assert ws_ids, "FORM_COALITION should create a CAUSED edge"
    ws_id = ws_ids[0]
    assert mem.nodes[ws_id]["node_type"] == WORLD_STATE_NODE_TYPE
    assert mem.nodes[ws_id]["slice"] == "coalitions"

    # The Coalition node must be reachable in <= 2 hops from the episode.
    hops = mem.shortest_hops(action.action_id, ws_id)
    assert hops is not None and hops <= 2, (
        f"world_state_node must be <=2 hops from episode, got {hops}"
    )


def test_make_statement_does_not_create_world_state_node(tmp_memory):
    """Non-mutating actions only emit a PERFORMED edge."""
    mem = EpisodicMemory.for_run("run_no_mutate", storage_path=tmp_memory)
    mw = MemoryWriteback(memory=mem)
    a = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="agent_x",
        round_num=1,
    )
    a.post_content = "Hello world"
    a.evidence = []
    set_business_type(a, BusinessActionType.MAKE_STATEMENT)
    mw.write_action(a)
    caused = [
        e for e in mem.edges
        if e["source_id"] == a.action_id and e["relation_type"] == EDGE_CAUSED
    ]
    assert caused == []


def test_in_reply_to_chain_persists_to_disk(tmp_memory):
    """save() round-trips through disk; reload sees the same nodes+edges."""
    mem = EpisodicMemory.for_run("run_persist", storage_path=tmp_memory)
    mw = MemoryWriteback(memory=mem)
    a1 = _form_coalition_action("a", ["b"], "c_persist")
    a1.post_content = "a announces formation of coalition c_persist with strategic partner b"
    # Persist a1 first so MemoryWriteback auto-assigns a stable
    # action_id (we need that exact id for the reply edge below —
    # if we passed in_reply_to=a1.action_id *before* the write,
    # a1.action_id is still "" and the IN_REPLY_TO edge collapses
    # onto a self-loop).
    mw.write_action(a1)
    a2 = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="b",
        round_num=2,
    )
    a2.in_reply_to = a1.action_id
    a2.post_content = "b responds to coalition announcement with strategic alignment statement"
    set_business_type(a2, BusinessActionType.MAKE_STATEMENT)
    mw.write_round([a1, a2])  # uses write_round which auto-saves
    # Reload
    mem2 = EpisodicMemory.for_run("run_persist", storage_path=tmp_memory)
    assert mem2.count_episodes() == 2
    assert mem2.has_edge(a2.action_id, a1.action_id, EDGE_IN_REPLY_TO)
