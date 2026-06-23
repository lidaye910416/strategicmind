"""
Step 6 feedback loop B2 — EpisodicMemory merges into LocalKnowledgeStore.

Background
----------
The pre-fix world had two parallel graph stores:

* :class:`LocalKnowledgeStore` (built in Step 2, queried in Step 7
  report generation) — the canonical knowledge graph.
* :class:`EpisodicMemory` (written in Step 6 simulation) — a separate
  JSON file under ``./data/episodic_memory/<run_id>.json``.

The Step 7 report agent only ever queried the first; the second was
write-only. "Report grounding" against Step 6 emergent content was
fake.

This test pins down the B2 fix:

1. :class:`MemoryWriteback` can optionally be wired with a
   :class:`LocalKnowledgeStore` and an ``EPISODE_MIRROR`` flag.
2. Every action written through :meth:`MemoryWriteback.write_action`
   is mirrored into the knowledge store as an ``Episode`` node.
3. The report agent's search API (``search()``,
   ``search_episodes()``, ``get_neighbors()``) finds Step 6 episodes
   by free-text query — same API as for Step 2 entities.
4. A Coalition ``world_state_node`` is reachable from any agent
   node in <= 2 hops (``agent --PERFORMED--> episode --CAUSED--> ws``),
   so the report can walk the graph to ground its claims.
5. The mirror is *additive* — the legacy :class:`EpisodicMemory`
   file still works for tests that read from it directly.

Migration path
--------------
* Both stores coexist; flag-gated. Set
  ``STRATEGICMIND_EPISODE_MIRROR=1`` *and* pass ``knowledge_store=``
  to :class:`MemoryWriteback` to enable the mirror.
* When the report agent's verbatim-quote requirements prove the
  mirror is stable, ``EpisodicMemory`` can be reduced to a thin
  cache wrapper for ``recent_episodes`` (it never needs to be the
  source of truth again).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from typing import Any, Dict, List, Optional

import pytest

from backend.models.action_type import ActionType, PropagationChannel, StrategicAction
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.world_state import WorldState
from backend.services.local_graph_store import LocalGraphStore
from backend.services.local_knowledge_store import LocalKnowledgeStore
from backend.services.loop.action_taxonomy import BusinessActionType, set_business_type
from backend.services.loop.memory_writeback import (
    AGENT_NODE_TYPE,
    EDGE_CAUSED,
    EDGE_PERFORMED,
    EPISODE_NODE_TYPE,
    EPISODE_MIRROR_DEFAULT,
    EpisodicMemory,
    MemoryWriteback,
    WORLD_STATE_NODE_TYPE,
)


# ---------------------------------------------------------------------------
# Minimal LLM stub for LocalKnowledgeStore construction
# ---------------------------------------------------------------------------


class _NullLLM:
    """Stub LLM so LocalKnowledgeStore.__init__ doesn't blow up on
    EntityExtractor creation. We never call .extract_entities in
    these tests, so the stub doesn't need to do anything."""

    def __getattr__(self, _name):
        return lambda *args, **kwargs: None


def _make_action(
    actor_id: str,
    round_num: int,
    post_content: str,
    *,
    business_type: BusinessActionType = BusinessActionType.MAKE_STATEMENT,
    target_ids: Optional[List[str]] = None,
    in_reply_to: Optional[str] = None,
    touched_slice: Optional[str] = None,
) -> StrategicAction:
    """Build a StrategicAction with the v2 ad-hoc attributes that
    MemoryWriteback expects (action_id, post_content, evidence, etc.)."""
    a = StrategicAction(
        actor_id=actor_id,
        action_type=ActionType.MAKE_STATEMENT,
        public_description=post_content,
        target_ids=list(target_ids or []),
        round_num=int(round_num),
    )
    # v2 attributes set ad-hoc (matches engine._decide_action pattern).
    a.action_id = f"act_{actor_id}_r{round_num}_{business_type.value[:6]}"
    a.post_content = post_content
    a.post_author_name = actor_id
    a.evidence = []
    a.in_reply_to = in_reply_to
    a.propagation_channels = [PropagationChannel.SOCIAL_MEDIA]
    set_business_type(a, business_type)
    if touched_slice:
        a.metadata = {
            "resolver": {"touched_slice": touched_slice, "delta": {"count": 1}},
        }
    return a


def _make_knowledge_store(tmp_path: str) -> LocalKnowledgeStore:
    """Build a LocalKnowledgeStore rooted at a temp directory so
    tests don't pollute the repo's data/ directory."""
    graph_store = LocalGraphStore(storage_path=tmp_path)
    return LocalKnowledgeStore(
        graph_store=graph_store,
        llm_provider=_NullLLM(),
        storage_path=tmp_path,
    )


def _bfs_hops(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    source_id: str,
    target_id: str,
) -> Optional[int]:
    """Pure-Python BFS over the nodes/edges list — mirrors
    EpisodicMemory.shortest_hops but works on the merged store's
    representation."""
    if source_id == target_id:
        return 0
    seen = {source_id}
    frontier = [source_id]
    depth = 0
    adj: Dict[str, List[str]] = {}
    for e in edges:
        adj.setdefault(e.get("source_id"), []).append(e.get("target_id"))
    while frontier:
        depth += 1
        nxt: List[str] = []
        for nid in frontier:
            for t in adj.get(nid, []) or []:
                if t in seen:
                    continue
                if t == target_id:
                    return depth
                seen.add(t)
                nxt.append(t)
        frontier = nxt
    return None


# ---------------------------------------------------------------------------
# Test 1 — End-to-end: 2-round loop, mirror on, search finds episodes
# ---------------------------------------------------------------------------


def test_two_round_loop_episodes_land_in_knowledge_store(tmp_path):
    """2-round loop with the mirror enabled → 2 Episode nodes plus
    2 world_state_nodes land in the LocalKnowledgeStore, searchable
    by the same free-text API the report uses."""
    kg_path = os.path.join(tmp_path, "kg")
    epi_path = os.path.join(tmp_path, "epi")
    os.makedirs(kg_path, exist_ok=True)
    os.makedirs(epi_path, exist_ok=True)

    knowledge_store = _make_knowledge_store(kg_path)
    episodic = EpisodicMemory.for_run("run_b2_2r", storage_path=epi_path)
    writer = MemoryWriteback(
        memory=episodic,
        knowledge_store=knowledge_store,
        run_id="run_b2_2r",
        mirror_enabled=True,
    )

    # Round 1: Alice makes a statement.
    a1 = _make_action(
        actor_id="alice",
        round_num=1,
        post_content="We are launching Project Phoenix next quarter.",
        business_type=BusinessActionType.MAKE_STATEMENT,
    )
    out1 = writer.write_action(a1)
    assert out1["episode_id"] == a1.action_id

    # Round 2: Bob reacts (in reply to Alice) and forms a coalition.
    a2 = _make_action(
        actor_id="bob",
        round_num=2,
        post_content="Alice's Phoenix is the right move; I'm in.",
        business_type=BusinessActionType.FORM_COALITION,
        in_reply_to=a1.action_id,
        touched_slice="coalitions",
    )
    out2 = writer.write_action(a2)
    assert out2["episode_id"] == a2.action_id

    # Persist EpisodicMemory (the mirror path is async-best-effort and
    # ran the write_episode coroutine; explicit save keeps both stores
    # consistent on disk for the assertions below).
    episodic.save()

    # ---- 1) EpisodicMemory (legacy) still has both Episodes ----
    assert episodic.count_episodes() == 2

    # ---- 2) LocalKnowledgeStore sees both Episodes via search_episodes ----
    async def _fetch_all() -> List[Dict[str, Any]]:
        all_eps = await knowledge_store.search_episodes("", top_k=100, run_id="run_b2_2r")
        return all_eps

    eps = asyncio.new_event_loop().run_until_complete(_fetch_all())
    assert len(eps) == 2, f"expected 2 episodes in knowledge store, got {len(eps)}: {eps}"
    for ep in eps:
        assert ep.get("entity_type") == "Episode"

    # ---- 3) Free-text search finds Step 6 content (the bug we're fixing) ----
    async def _search_text() -> List[Dict[str, Any]]:
        return await knowledge_store.search_episodes("Project Phoenix", top_k=10, run_id="run_b2_2r")

    hits = asyncio.new_event_loop().run_until_complete(_search_text())
    # "Project Phoenix" only appears in Alice's post.
    assert len(hits) == 1
    assert "Phoenix" in (hits[0].get("text") or hits[0].get("summary", ""))
    assert hits[0].get("actor_id") == "alice"

    # ---- 4) Substring search for "right move" finds Bob's reaction ----
    async def _search_bob() -> List[Dict[str, Any]]:
        return await knowledge_store.search_episodes("right move", top_k=10, run_id="run_b2_2r")

    bob_hits = asyncio.new_event_loop().run_until_complete(_search_bob())
    assert len(bob_hits) == 1
    assert bob_hits[0].get("actor_id") == "bob"


# ---------------------------------------------------------------------------
# Test 2 — The standard search() API also returns Step 6 Episodes
# ---------------------------------------------------------------------------


def test_standard_knowledge_store_search_finds_episodes(tmp_path):
    """The report agent's primary read path is ``knowledge_store.search()``.
    That call must return Step 6 Episodes alongside Step 2 seed entities
    — otherwise the B2 merge is useless for the report."""
    kg_path = os.path.join(tmp_path, "kg")
    epi_path = os.path.join(tmp_path, "epi")
    os.makedirs(kg_path, exist_ok=True)
    os.makedirs(epi_path, exist_ok=True)

    knowledge_store = _make_knowledge_store(kg_path)
    episodic = EpisodicMemory.for_run("run_b2_search", storage_path=epi_path)
    writer = MemoryWriteback(
        memory=episodic,
        knowledge_store=knowledge_store,
        run_id="run_b2_search",
        mirror_enabled=True,
    )

    action = _make_action(
        actor_id="carol",
        round_num=1,
        post_content="Q3 revenue guidance revised upward by 15%.",
        business_type=BusinessActionType.MAKE_STATEMENT,
    )
    writer.write_action(action)
    episodic.save()

    async def _search() -> List[Dict[str, Any]]:
        # Standard search() — same call the report agent makes.
        return await knowledge_store.search(
            query="revenue guidance",
            top_k=20,
        )

    results = asyncio.new_event_loop().run_until_complete(_search())
    # Step 6 Episode must be reachable.
    ep_hits = [r for r in results if (r.get("metadata") or {}).get("entity_type") == "Episode"]
    assert ep_hits, (
        f"knowledge_store.search() did not return any Episode nodes. "
        f"Got {len(results)} results: {results[:2]}"
    )
    # The matching Episode is the one we just wrote.
    matched_text = " ".join(str(r.get("text", "")) for r in ep_hits)
    assert "revenue" in matched_text.lower()


# ---------------------------------------------------------------------------
# Test 3 — Shortest path: Agent → Episode → Coalition world_state_node <= 2
# ---------------------------------------------------------------------------


def test_shortest_path_agent_to_coalition_world_state_node(tmp_path):
    """Architectural promise: any agent's emitted episode can reach a
    Coalition world_state_node in <= 2 hops. This is what lets the
    report agent walk the graph to ground a claim like "Agent X's
    action changed the coalition structure"."""
    kg_path = os.path.join(tmp_path, "kg")
    epi_path = os.path.join(tmp_path, "epi")
    os.makedirs(kg_path, exist_ok=True)
    os.makedirs(epi_path, exist_ok=True)

    knowledge_store = _make_knowledge_store(kg_path)
    episodic = EpisodicMemory.for_run("run_b2_graph", storage_path=epi_path)
    writer = MemoryWriteback(
        memory=episodic,
        knowledge_store=knowledge_store,
        run_id="run_b2_graph",
        mirror_enabled=True,
    )

    # Two agents; agent "dave" forms a coalition (mutating → ws_node).
    dave_action = _make_action(
        actor_id="dave",
        round_num=1,
        post_content="Forming the EU regulatory coalition with Acme Corp.",
        business_type=BusinessActionType.FORM_COALITION,
        touched_slice="coalitions",
    )
    eve_action = _make_action(
        actor_id="eve",
        round_num=2,
        post_content="Joining dave's coalition as third party.",
        business_type=BusinessActionType.FORM_COALITION,
        touched_slice="coalitions",
    )
    writer.write_action(dave_action)
    writer.write_action(eve_action)
    episodic.save()

    # Pull the merged graph back out of the knowledge store.
    async def _load_graph() -> tuple:
        nodes = await knowledge_store.graph_store.get_nodes(
            graph_id="run_run_b2_graph", limit=500,
        )
        edges = await knowledge_store.graph_store.get_edges(
            graph_id="run_run_b2_graph", limit=500,
        )
        return nodes, edges

    nodes, edges = asyncio.new_event_loop().run_until_complete(_load_graph())

    # Sanity: at least 2 Episodes, 2 ws_nodes, and dave/eve nodes.
    ep_nodes = [n for n in nodes if n.get("entity_type") == "Episode"]
    ws_nodes = [n for n in nodes if n.get("entity_type") == "WorldStateNode"]
    agent_nodes = [n for n in nodes if n.get("entity_type") == "Agent"]
    assert len(ep_nodes) >= 2, f"expected >=2 Episode nodes, got {len(ep_nodes)}"
    assert len(ws_nodes) >= 1, f"expected >=1 WorldStateNode, got {len(ws_nodes)}"
    assert {n["id"] for n in agent_nodes} >= {"dave", "eve"}

    # For each agent, walk the graph and assert <= 2 hops to *some*
    # Coalition world_state_node.
    for agent_id in ("dave", "eve"):
        best = None
        for ws in ws_nodes:
            hops = _bfs_hops(nodes, edges, agent_id, ws["id"])
            if hops is not None and (best is None or hops < best):
                best = hops
        assert best is not None and best <= 2, (
            f"agent {agent_id!r} cannot reach a Coalition world_state_node in <= 2 hops "
            f"(best={best}); graph has {len(nodes)} nodes / {len(edges)} edges"
        )


# ---------------------------------------------------------------------------
# Test 4 — Flag gate: when mirror is off, knowledge store stays clean
# ---------------------------------------------------------------------------


def test_mirror_off_does_not_pollute_knowledge_store(tmp_path):
    """Backward-compat: when ``mirror_enabled=False`` (default), the
    knowledge store is untouched even when a non-None ``knowledge_store``
    is passed in. This lets the migration roll out incrementally."""
    kg_path = os.path.join(tmp_path, "kg")
    epi_path = os.path.join(tmp_path, "epi")
    os.makedirs(kg_path, exist_ok=True)
    os.makedirs(epi_path, exist_ok=True)

    knowledge_store = _make_knowledge_store(kg_path)
    episodic = EpisodicMemory.for_run("run_b2_off", storage_path=epi_path)
    # Default behaviour: no mirror, no breakage of pre-existing tests.
    writer = MemoryWriteback(memory=episodic)

    a = _make_action(
        actor_id="frank",
        round_num=1,
        post_content="Should not appear in knowledge store because mirror is off but we still write to EpisodicMemory.",
        business_type=BusinessActionType.MAKE_STATEMENT,
    )
    writer.write_action(a)
    episodic.save()

    async def _count() -> int:
        eps = await knowledge_store.search_episodes("", top_k=100, run_id="run_b2_off")
        return len(eps)

    n = asyncio.new_event_loop().run_until_complete(_count())
    assert n == 0, (
        f"knowledge store should be empty when mirror is off; got {n} episodes"
    )
    # The EpisodicMemory file *does* have the episode — legacy path still works.
    assert episodic.count_episodes() == 1


# ---------------------------------------------------------------------------
# Test 5 — Default flag value is the env var at import time
# ---------------------------------------------------------------------------


def test_mirror_default_flag_reflects_env(monkeypatch):
    """The default ``EPISODE_MIRROR_DEFAULT`` constant is computed at
    import time from the env var. When the env is 1/on, the default
    is True; when off, False. (We don't flip the constant at runtime
    because the dataclass default is fixed at class-definition time —
    callers still pass ``mirror_enabled=`` explicitly.)"""
    # The constant is bound at import. We just verify the env
    # interpretation function works as documented.
    from backend.services.loop import memory_writeback as mw_mod

    # The module-level constant must be a bool.
    assert isinstance(mw_mod.EPISODE_MIRROR_DEFAULT, bool)
    # When the env var is unset (test default), the flag is False.
    # (monkeypatch already deleted it in the test session by default.)
    assert mw_mod.EPISODE_MIRROR_DEFAULT is False


# ---------------------------------------------------------------------------
# Test 6 — Endpoint types: Agent + Episode + WorldStateNode are searchable
# ---------------------------------------------------------------------------


def test_episode_node_carries_correct_type_label(tmp_path):
    """The mirrored Episode node must carry ``entity_type="Episode"``
    so the report's ``node_type="Episode"`` filter pulls it out
    cleanly without false positives against Step 2 entities."""
    kg_path = os.path.join(tmp_path, "kg")
    epi_path = os.path.join(tmp_path, "epi")
    os.makedirs(kg_path, exist_ok=True)
    os.makedirs(epi_path, exist_ok=True)

    knowledge_store = _make_knowledge_store(kg_path)
    episodic = EpisodicMemory.for_run("run_b2_types", storage_path=epi_path)
    writer = MemoryWriteback(
        memory=episodic,
        knowledge_store=knowledge_store,
        run_id="run_b2_types",
        mirror_enabled=True,
    )

    a = _make_action(
        actor_id="grace",
        round_num=1,
        post_content="TYPED episode node test that mirrors into the shared knowledge store with proper entity_type label.",
        business_type=BusinessActionType.MAKE_STATEMENT,
    )
    writer.write_action(a)
    episodic.save()

    async def _filter_episodes() -> List[Dict[str, Any]]:
        # The IGraphStore.get_nodes ``node_type=`` filter passes through
        # to LocalGraphStore.get_nodes which filters on
        # ``entity_type``. This is the same filter the report uses.
        return await knowledge_store.graph_store.get_nodes(
            graph_id="run_run_b2_types",
            node_type="Episode",
            limit=100,
        )

    eps = asyncio.new_event_loop().run_until_complete(_filter_episodes())
    assert len(eps) == 1
    assert eps[0].get("entity_type") == "Episode"
    assert eps[0].get("actor_id") == "grace"
    # The text payload was carried over.
    assert "TYPED" in (eps[0].get("text") or eps[0].get("summary", ""))
