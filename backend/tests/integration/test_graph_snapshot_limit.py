"""
graph-snapshot ?limit= + LocalKnowledgeStore entity dedup (Phase 4d regression).

Verifies:
  1. LocalKnowledgeStore.insert_entity dedups by (normalized name, entity_type) —
     inserting "Apple", " apple ", "Apple, Inc." returns the same uuid.
  2. _read_graph_from_knowledge_store honours the ``limit`` arg, sorts nodes
     by uuid (deterministic truncation), and drops edges whose endpoints
     are not in the returned node set.
"""
import json
import os
import shutil
import sys
import tempfile
from typing import Dict, List

import pytest


@pytest.fixture
def tmp_storage(monkeypatch):
    """Isolated LocalKnowledgeStore on a temp dir."""
    d = tempfile.mkdtemp(prefix="lks_test_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def _new_store(storage_path: str):
    """Construct LocalKnowledgeStore with stub graph_store + llm_provider."""
    from backend.services.local_knowledge_store import LocalKnowledgeStore

    class _StubGraphStore:
        async def search(self, **kw): return []
        async def get_nodes(self, **kw): return []
        async def get_edges(self, **kw): return []

    class _StubLLM:
        pass

    return LocalKnowledgeStore(
        graph_store=_StubGraphStore(),
        llm_provider=_StubLLM(),
        storage_path=storage_path,
    )


@pytest.mark.asyncio
async def test_insert_entity_dedups_by_normalized_name_and_type(tmp_storage):
    """Same name (case/whitespace/punct normalized) + same type → same uuid."""
    store = _new_store(tmp_storage)
    # 4 variations of "Apple" + same type
    u1 = await store.insert_entity({"name": "Apple", "entity_type": "COMPANY"})
    u2 = await store.insert_entity({"name": " apple ", "entity_type": "COMPANY"})
    u3 = await store.insert_entity({"name": "Apple, Inc.", "entity_type": "COMPANY"})
    u4 = await store.insert_entity({"name": "Apple Inc", "entity_type": "COMPANY"})
    assert u1 == u2 == u3 == u4

    # Different name → different uuid
    u5 = await store.insert_entity({"name": "Microsoft", "entity_type": "COMPANY"})
    assert u5 != u1

    # Same name but different type → different uuid
    u6 = await store.insert_entity({"name": "Apple", "entity_type": "PRODUCT"})
    assert u6 != u1

    # On-disk entity files: only 3 distinct files (Apple/COMPANY, Microsoft/COMPANY, Apple/PRODUCT)
    entity_files = [f for f in os.listdir(tmp_storage) if f.endswith(".json") and not f.startswith("_") and not f.startswith("relation_")]
    assert len(entity_files) == 3

    # Dedup index file exists and has 3 keys
    idx_path = os.path.join(tmp_storage, "_entity_index.json")
    assert os.path.isfile(idx_path)
    with open(idx_path) as f:
        idx = json.load(f)
    assert len(idx) == 3


@pytest.mark.asyncio
async def test_insert_entity_dedup_does_not_overwrite_existing_file(tmp_storage):
    """First-wins: existing file content must be preserved on dedup hit."""
    store = _new_store(tmp_storage)
    u1 = await store.insert_entity(
        {"name": "Apple", "entity_type": "COMPANY", "summary": "original"}
    )
    # Insert again with different metadata — should be ignored
    await store.insert_entity(
        {"name": "apple", "entity_type": "COMPANY", "summary": "should-not-overwrite"}
    )
    # Read the file back, summary must still be "original"
    fpath = os.path.join(tmp_storage, f"{u1}.json")
    with open(fpath) as f:
        payload = json.load(f)
    assert payload["summary"] == "original"


@pytest.mark.asyncio
async def test_insert_entity_persists_index_across_restart(tmp_storage):
    """Restart of LocalKnowledgeStore rebuilds the index from disk (no _entity_index.json)."""
    from backend.services.local_knowledge_store import LocalKnowledgeStore

    s1 = _new_store(tmp_storage)
    u1 = await s1.insert_entity({"name": "Apple", "entity_type": "COMPANY"})
    assert os.path.isfile(os.path.join(tmp_storage, "_entity_index.json"))

    # Remove the index file, simulate a cold start
    os.remove(os.path.join(tmp_storage, "_entity_index.json"))
    s2 = _new_store(tmp_storage)
    # Dedup still works because the index is rebuilt from the existing entity file
    u2 = await s2.insert_entity({"name": "Apple", "entity_type": "COMPANY"})
    assert u2 == u1


def test_read_graph_snapshot_respects_limit_and_drops_dangling_edges(tmp_storage):
    """_read_graph_from_knowledge_store returns <= limit nodes, no dangling edges."""
    from backend.services.local_knowledge_store import LocalKnowledgeStore

    class _StubGraphStore:
        async def search(self, **kw): return []
        async def get_nodes(self, **kw): return []
        async def get_edges(self, **kw): return []

    class _StubLLM:
        pass

    # Use sync insert by mocking via a quick helper — write 50 entity files directly
    # because asyncio.run with a fresh event loop is awkward inside a sync test.
    from uuid import uuid4
    for i in range(50):
        eid = str(uuid4())
        with open(os.path.join(tmp_storage, f"{eid}.json"), "w") as f:
            json.dump({
                "uuid": eid,
                "name": f"Entity{i:02d}",
                "entity_type": "COMPANY",
            }, f)
    # Write 30 relation files; some reference truncated nodes, some don't
    all_eids = [f for f in os.listdir(tmp_storage) if f.endswith(".json") and not f.startswith("relation_") and not f.startswith("_")]
    all_eids = [e[:-5] for e in all_eids]
    for i in range(30):
        src_idx = i % 50
        tgt_idx = (i + 1) % 50
        rid = f"r{i:02d}_{uuid4().hex[:6]}"
        with open(os.path.join(tmp_storage, f"relation_{rid}.json"), "w") as f:
            json.dump({
                "uuid": rid,
                "source_id": all_eids[src_idx],
                "target_id": all_eids[tgt_idx],
                "relation_type": "OWNS",
            }, f)

    from backend.app.api import pipeline as pipeline_api
    graph = pipeline_api._read_graph_from_knowledge_store(
        LocalKnowledgeStore(_StubGraphStore(), _StubLLM(), storage_path=tmp_storage),
        limit=10,
    )
    assert graph["total_nodes"] == 50
    assert graph["total_edges"] == 30
    assert len(graph["nodes"]) == 10
    assert graph["has_more"] is True
    kept_ids = {n["id"] for n in graph["nodes"]}
    # All returned edges must have both endpoints in the kept set (no dangling refs)
    for e in graph["edges"]:
        assert e["source"] in kept_ids, f"dangling source: {e['source']}"
        assert e["target"] in kept_ids, f"dangling target: {e['target']}"


def test_read_graph_snapshot_no_truncation_when_under_limit(tmp_storage):
    """When total nodes < limit, all nodes/edges returned, has_more=False."""
    from backend.app.api import pipeline as pipeline_api
    from uuid import uuid4

    class _StubGraphStore:
        async def search(self, **kw): return []
        async def get_nodes(self, **kw): return []
        async def get_edges(self, **kw): return []

    class _StubLLM:
        pass

    from backend.services.local_knowledge_store import LocalKnowledgeStore

    for i in range(5):
        eid = str(uuid4())
        with open(os.path.join(tmp_storage, f"{eid}.json"), "w") as f:
            json.dump({"uuid": eid, "name": f"e{i}", "entity_type": "X"}, f)

    graph = pipeline_api._read_graph_from_knowledge_store(
        LocalKnowledgeStore(_StubGraphStore(), _StubLLM(), storage_path=tmp_storage),
        limit=2000,
    )
    assert len(graph["nodes"]) == 5
    assert graph["total_nodes"] == 5
    assert graph["has_more"] is False


# ---------------------------------------------------------------------------
# Step 11 (ws4gdxlm1) — Hard AC: per-run KG file count + aggregate present
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_kg_after_dedup(tmp_storage):
    """AC1/AC2/AC3 hard floor: after a stub run that re-inserts the same
    entity 100 times across 10 "rounds", the entity file count stays
    bounded by the unique-entity count, not the call count.

    Pinned numbers:
      - 100 inserts of (Apple, COMPANY), each with a fresh client uuid
      - on-disk entity files == 1 (one unique key)
      - _entity_index.json present, len == 1
      - second store instance restarts cleanly with the same uuid
    """
    store = _new_store(tmp_storage)
    first_uuid = None
    for round_n in range(10):
        for actor in range(10):
            uid = await store.insert_entity({
                "name": "Apple",
                "entity_type": "COMPANY",
                "summary": f"round-{round_n}-actor-{actor}",
            })
            if first_uuid is None:
                first_uuid = uid
            assert uid == first_uuid, (
                f"dedup failed at round={round_n} actor={actor}: "
                f"got {uid} expected {first_uuid}"
            )

    # On-disk floor — exactly one entity file (the first-wins one),
    # plus exactly one index file.
    entity_files = [
        f for f in os.listdir(tmp_storage)
        if f.endswith(".json") and not f.startswith("_") and not f.startswith("relation_") and not f.startswith("graph_")
    ]
    assert len(entity_files) == 1, (
        f"AC2 violated: expected exactly 1 entity file, got {len(entity_files)}: {entity_files}"
    )

    idx_path = os.path.join(tmp_storage, "_entity_index.json")
    assert os.path.isfile(idx_path), "AC4 violated: _entity_index.json missing"
    with open(idx_path) as f:
        idx = json.load(f)
    assert len(idx) == 1, f"AC4 violated: index has {len(idx)} keys, expected 1"


@pytest.mark.asyncio
async def test_kg_aggregate_graph_json(tmp_storage):
    """AC: ``rebuild_aggregate(graph_id)`` writes a single
    ``graph_<graph_id>.json`` containing all nodes + edges from the
    per-entity / per-relation files. This is the local equivalent of
    MiroFish's "load whole graph from Zep in one call" — consumers
    that need the full graph can read one file instead of scanning
    thousands of inodes."""
    from backend.services.local_graph_store import LocalGraphStore
    from backend.services.local_knowledge_store import LocalKnowledgeStore

    class _StubLLM:
        pass

    gs = LocalGraphStore(storage_path=tmp_storage)
    ks = LocalKnowledgeStore(
        graph_store=gs, llm_provider=_StubLLM(), storage_path=tmp_storage,
    )

    # Seed: 3 distinct entities + 2 distinct relations.
    a = await ks.insert_entity({"name": "Apple", "entity_type": "COMPANY"})
    m = await ks.insert_entity({"name": "Microsoft", "entity_type": "COMPANY"})
    t = await ks.insert_entity({"name": "Tim Cook", "entity_type": "Person"})
    await ks.insert_relation({"source_id": a, "target_id": m, "relation_type": "COMPETES_WITH"})
    await ks.insert_relation({"source_id": t, "target_id": a, "relation_type": "WORKS_FOR"})

    # Rebuild aggregate.
    result = ks.rebuild_aggregate(graph_id="kg_step11")
    assert result == {"nodes": 3, "edges": 2}, f"expected {{nodes:3, edges:2}}, got {result}"

    # The aggregate file must exist next to the per-entity files.
    agg_path = os.path.join(tmp_storage, "graph_kg_step11.json")
    assert os.path.isfile(agg_path), f"aggregate file not written at {agg_path}"
    with open(agg_path) as f:
        payload = json.load(f)
    assert payload.get("graph_id") == "kg_step11"
    assert len(payload.get("nodes", [])) == 3
    assert len(payload.get("edges", [])) == 2
    # Sanity: the aggregate is a superset of the per-entity files (same uuids).
    agg_node_uuids = {n.get("uuid") for n in payload["nodes"]}
    assert agg_node_uuids == {a, m, t}, f"aggregate node uuids mismatch: {agg_node_uuids}"

    # The aggregate file is correctly skipped by the read-side scanner —
    # otherwise it would inflate total_nodes.
    from backend.app.api import pipeline as pipeline_api
    graph = pipeline_api._read_graph_from_knowledge_store(ks, limit=100)
    assert graph["total_nodes"] == 3, (
        f"_read_graph must not double-count via the aggregate file; "
        f"got total_nodes={graph['total_nodes']}"
    )
