"""
Acceptance tests for GET /api/simulation/<run_id>/rounds — coverage of the
KG-OPT-P0 memory_writeback natural-key dedup path.

These tests are written at the *service* layer (driving
:class:`~backend.services.loop.memory_writeback.MemoryWriteback` directly)
because the ``/api/simulation/<run_id>/rounds`` HTTP endpoint does not
expose the writer's ``_dedup_metrics`` (the rounds response only emits
per-round actions / belief_updates / propagation_events — see
``backend/app/api/simulation.py:160``). The writer's dedup metrics are
the *ground truth* of the HTTP behaviour, because the loop engine wires
those exact counters into ``SIMULATION_RUNNING`` round artifacts which
the rounds endpoint then serialises; testing at the service layer keeps
the assertions deterministic without orchestrating a full simulation
run.

Three behaviours are pinned down (KG-OPT-P0 / P1 [eg-006/eg-007/eg-008]):

1. ``STRATEGICMIND_USE_NATURAL_KEY=on`` collapses 100 identical
   (actor_id, btype, text) actions into a single Episode node and
   bumps ``episode_dedup_hits`` to 99 (1 first write + 99 reuses).
2. ``STRATEGICMIND_USE_NATURAL_KEY=on`` *silently skips* dangling
   ``IN_REPLY_TO`` edges into nodes that don't exist (no placeholder
   predecessor is created; ``in_reply_to_skipped`` increments).
3. ``STRATEGICMIND_USE_NATURAL_KEY=off`` (default) byte-for-byte
   reverts to the T1.5 behaviour: 10 distinct action_ids → 10 Episode
   nodes (no dedup, no counter bumps).

Each test sets a unique ``run_id`` and a fresh tmp data dir, and uses
``importlib.reload`` to force the ``USE_NATURAL_KEY`` module-level
constant to reflect the monkeypatched env. The Flask ``app`` factory
is constructed in TESTING mode so we exercise the same import path
the real endpoint uses (and so a future test 4 — when the rounds
endpoint does expose dedup metrics — can hook in without changes).
"""
from __future__ import annotations

import importlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure backend/ is on sys.path so `import app` works (matches
# acceptance/test_api_endpoints.py).
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_statement(actor_id: str, round_num: int, text: str,
                    in_reply_to: str | None = None) -> "StrategicAction":
    """Build a StrategicAction + ad-hoc v2 fields, deterministic per call.

    Uses MAKE_STATEMENT (non-mutating) so the world_state_node side of
    MemoryWriteback doesn't muddy the Episode-count assertion. The
    v2-specific fields (``post_content``, ``in_reply_to``, ``action_id``)
    are set as ad-hoc attributes because the v1 StrategicAction
    dataclass doesn't declare them — see memory_writeback.py:386-399.
    """
    from backend.models.action_type import (
        ActionType,
        PropagationChannel,
        StrategicAction,
    )
    from backend.services.loop.action_taxonomy import (
        BusinessActionType,
        set_business_type,
    )
    a = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id=actor_id,
        round_num=round_num,
        propagation_channels=[PropagationChannel.MEDIA],
    )
    a.post_content = text
    a.evidence = []
    set_business_type(a, BusinessActionType.MAKE_STATEMENT)
    if in_reply_to is not None:
        a.in_reply_to = in_reply_to
    # Force a *stable* action_id so the dedup window keys off
    # (actor, btype, md5(text)) deterministically — the writer's
    # 1-hour window compares (actor, btype, digest), not action_id,
    # so identity-stability is purely for inspection.
    import uuid
    a.action_id = f"act_{actor_id}_r{round_num}_{uuid.uuid4().hex[:8]}"
    return a


def _reload_memory_writeback():
    """Force ``memory_writeback.USE_NATURAL_KEY`` to re-read env.

    The module constant is computed once at import time
    (``memory_writeback.py:83-85``), so ``monkeypatch.setenv`` alone
    does NOT flip the flag for already-imported code. ``importlib.reload``
    re-evaluates the module top-level, picking up the new env var.
    """
    from backend.services.loop import memory_writeback as mw_mod
    importlib.reload(mw_mod)
    return mw_mod


def _count_episodes(mem) -> int:
    """Count Episode-typed nodes in an EpisodicMemory."""
    return sum(
        1 for n in mem.nodes.values()
        if n.get("node_type") == "Episode"
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_data_dir(monkeypatch):
    """Per-test data dir + UPLOAD_FOLDER isolation.

    Mirrors the ``tmp_path``/env-style isolation pattern used in the
    integration tests. We don't actually write uploads here — the
    rounds endpoint doesn't touch disk — but pointing
    ``STRATEGICMIND_DATA_DIR`` at the temp dir keeps any future test
    that does hit the filesystem contained.
    """
    d = tempfile.mkdtemp(prefix="rounds_dedup_")
    monkeypatch.setenv("STRATEGICMIND_DATA_DIR", d)
    monkeypatch.setenv("UPLOAD_FOLDER", d)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def app_factory():
    """Lazy import of the Flask app factory.

    Returns a callable so each test can construct the app fresh after
    reloading the memory_writeback module — this guarantees the
    registered routes and the underlying services see a consistent
    feature-flag snapshot.
    """
    from app import create_app

    def _factory(**extra):
        return create_app({"TESTING": True, **extra})

    return _factory


# ---------------------------------------------------------------------------
# Tests — KG-OPT-P0 [eg-008] natural-key dedup behaviour
# ---------------------------------------------------------------------------


def test_rounds_dedup_occurrence_count(tmp_data_dir, app_factory, monkeypatch):
    """100 identical actions → 1 Episode + 99 dedup hits.

    With ``STRATEGICMIND_USE_NATURAL_KEY=on``, the writer's 1-hour
    fingerprint window collapses re-occurrences of
    ``(actor, btype, md5(text))`` onto the first Episode node. The
    first write creates the node and primes the bucket; the next 99
    writes reuse the same ``episode_id`` and bump
    ``episode_dedup_hits`` once each, so the final counter is 99.

    Asserts:

    * ``_dedup_metrics['episode_dedup_hits'] == 99`` (1 first create + 99 reuses)
    * ``len(memory.nodes) == initial + 1`` — only 1 new Episode added
      (plus the actor node, so +2 if we count both; we assert
      Episode count specifically for clarity).
    """
    monkeypatch.setenv("STRATEGICMIND_USE_NATURAL_KEY", "1")
    # Sanity-flag overrides — must be off for this path so we don't
    # accidentally engage the hard-cap entity extractor.
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "0")
    monkeypatch.setenv("STRATEGICMIND_SHARED_RUN_ID", "")
    mw_mod = _reload_memory_writeback()
    assert mw_mod.USE_NATURAL_KEY is True, "reload failed to flip the flag"

    # Build the app so we exercise the same import path the HTTP
    # endpoint uses (a no-op for service-level assertions but it
    # guards against a future test 4 that hooks into the response).
    _app = app_factory()

    from backend.services.loop.memory_writeback import (
        EpisodicMemory,
        MemoryWriteback,
    )

    run_id = "run_rounds_dedup_occ"
    mem = EpisodicMemory.for_run(run_id, storage_path=tmp_data_dir)
    mw = MemoryWriteback(memory=mem, run_id=run_id)

    episodes_before = _count_episodes(mem)
    nodes_before = len(mem.nodes)
    assert episodes_before == 0
    assert nodes_before == 0

    # Identical payload 100 times — actor, btype, text all constant.
    # We vary action_id only because the writer pins episode_id to
    # action_id on the *first* write; subsequent dedup hits ignore
    # action_id and look up the bucket instead.
    text = "联盟草案 v3 公告: 预算重分配 25%"
    for i in range(100):
        a = _make_statement(
            actor_id="agent_alpha",
            round_num=1,
            text=text,
        )
        result = mw.write_action(a)
        # The writer guarantees deduped=True from write #2 onward.
        if i == 0:
            assert result.get("deduped", False) is False
        else:
            assert result.get("deduped") is True, (
                f"write #{i} should have been flagged deduped"
            )

    # Counter check: 99 re-uses after the first create.
    metrics = mw.get_dedup_metrics()
    assert metrics["episode_dedup_hits"] == 99, (
        f"expected 99 dedup hits, got {metrics['episode_dedup_hits']}"
    )
    # World-state + in-reply-to untouched on this path (MAKE_STATEMENT
    # isn't a MUTATING_TYPES member and we set no in_reply_to).
    assert metrics["ws_dedup_hits"] == 0
    assert metrics["in_reply_to_skipped"] == 0

    # Exactly 1 Episode node was created across all 100 writes.
    episodes_after = _count_episodes(mem)
    assert episodes_after == episodes_before + 1, (
        f"expected exactly 1 new Episode node, got "
        f"{episodes_after - episodes_before}"
    )
    # And only +2 nodes total: 1 Episode + 1 actor ("agent_alpha").
    assert len(mem.nodes) == nodes_before + 2
    # The episode node should also reflect occurrence_count=100.
    episode_id = next(
        nid for nid, n in mem.nodes.items()
        if n.get("node_type") == "Episode"
    )
    assert mem.nodes[episode_id]["occurrence_count"] == 100


def test_rounds_in_reply_to_orphan_skipped(tmp_data_dir, app_factory, monkeypatch):
    """Dangling ``in_reply_to`` is silently skipped under the flag.

    Pre-flag, a write that referenced a non-existent predecessor would
    fabricate an ``Episode-predecessor`` placeholder node to keep the
    graph traversable (memory_writeback.py:511-517). The natural-key
    rewrite drops that placeholder and counts the skip — ``in_reply_to_skipped``
    must be >= 1 and ``len(memory.nodes)`` must not grow as a result of
    the dangling reference.
    """
    monkeypatch.setenv("STRATEGICMIND_USE_NATURAL_KEY", "1")
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "0")
    monkeypatch.setenv("STRATEGICMIND_SHARED_RUN_ID", "")
    mw_mod = _reload_memory_writeback()
    assert mw_mod.USE_NATURAL_KEY is True

    _app = app_factory()

    from backend.services.loop.memory_writeback import (
        EpisodicMemory,
        MemoryWriteback,
    )

    run_id = "run_rounds_orphan_skip"
    mem = EpisodicMemory.for_run(run_id, storage_path=tmp_data_dir)
    mw = MemoryWriteback(memory=mem, run_id=run_id)

    nodes_before = len(mem.nodes)
    episodes_before = _count_episodes(mem)

    # Write a single action whose in_reply_to references a non-existent
    # episode id. Pre-flag this would create a synthetic
    # "Episode-predecessor" node; under the flag the edge is silently
    # dropped and the counter bumps.
    orphan_ref = "ep_does_not_exist_xyz"
    a = _make_statement(
        actor_id="agent_beta",
        round_num=1,
        text="回应不存在的上游节点",
        in_reply_to=orphan_ref,
    )
    result = mw.write_action(a)

    metrics = mw.get_dedup_metrics()
    assert metrics["in_reply_to_skipped"] >= 1, (
        f"expected in_reply_to_skipped>=1, got {metrics['in_reply_to_skipped']}"
    )
    # Dedup counters untouched (only one write, distinct actor/text).
    assert metrics["episode_dedup_hits"] == 0
    assert metrics["ws_dedup_hits"] == 0

    # No placeholder predecessor was fabricated — node count grew by
    # at most 2 (Episode + actor) and did NOT gain an extra
    # "Episode-predecessor" entry.
    assert orphan_ref not in mem.nodes, (
        f"orphan ref {orphan_ref} should not appear as a placeholder"
    )
    assert len(mem.nodes) == nodes_before + 2, (
        f"expected only +2 nodes (Episode + actor), got "
        f"{len(mem.nodes) - nodes_before}"
    )
    assert _count_episodes(mem) == episodes_before + 1

    # The write still produced a real Episode for the action itself.
    assert result.get("episode_id") == a.action_id
    edges = result.get("edges") or []
    # No IN_REPLY_TO edge should have been emitted to the orphan ref.
    from backend.services.loop.memory_writeback import EDGE_IN_REPLY_TO
    assert not any(
        e.get("relation_type") == EDGE_IN_REPLY_TO
        and e.get("target_id") == orphan_ref
        for e in edges
    ), "dangling IN_REPLY_TO edge was emitted under flag=on"


def test_rounds_natural_key_off_creates_per_action(tmp_data_dir, app_factory, monkeypatch):
    """STRATEGICMIND_USE_NATURAL_KEY=off → byte-level fallback.

    10 distinct actions (unique action_ids) must produce 10 distinct
    Episode nodes — no dedup, no counter bumps. This pins down the
    T1.5 acceptance compatibility: the off-flag path is supposed to
    keep the legacy "1 write = 1 node" semantics exactly.
    """
    # Explicitly unset the flag for this test even if the host env
    # has it set — we want a clean off-flag baseline.
    monkeypatch.delenv("STRATEGICMIND_USE_NATURAL_KEY", raising=False)
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "0")
    monkeypatch.setenv("STRATEGICMIND_SHARED_RUN_ID", "")
    mw_mod = _reload_memory_writeback()
    assert mw_mod.USE_NATURAL_KEY is False, (
        "reload failed to clear the flag — env var still set?"
    )

    _app = app_factory()

    from backend.services.loop.memory_writeback import (
        EpisodicMemory,
        MemoryWriteback,
    )

    run_id = "run_rounds_off_flag"
    mem = EpisodicMemory.for_run(run_id, storage_path=tmp_data_dir)
    mw = MemoryWriteback(memory=mem, run_id=run_id)

    episodes_before = _count_episodes(mem)
    nodes_before = len(mem.nodes)
    assert episodes_before == 0

    # 10 actions with distinct action_ids, distinct texts, distinct
    # actors — none should collapse.
    for i in range(10):
        a = _make_statement(
            actor_id=f"agent_off_{i}",
            round_num=1,
            text=f"off-flag action #{i} 独一无二的文本 {i}",
        )
        result = mw.write_action(a)
        # Off-flag path never sets deduped=True — every write is a
        # first-class Episode creation.
        assert "deduped" not in result or result.get("deduped") is False

    # 10 new Episodes — one per write. Node count grows by 10
    # Episodes + 10 actors = +20.
    assert _count_episodes(mem) == episodes_before + 10, (
        f"expected 10 new Episodes under off-flag, got "
        f"{_count_episodes(mem) - episodes_before}"
    )
    assert len(mem.nodes) == nodes_before + 20, (
        f"expected +20 nodes (10 Episodes + 10 actors), got "
        f"{len(mem.nodes) - nodes_before}"
    )

    # All counters stay at zero under off-flag — the flag=on branches
    # are the only paths that bump _dedup_metrics.
    metrics = mw.get_dedup_metrics()
    assert metrics["episode_dedup_hits"] == 0
    assert metrics["ws_dedup_hits"] == 0
    assert metrics["in_reply_to_skipped"] == 0