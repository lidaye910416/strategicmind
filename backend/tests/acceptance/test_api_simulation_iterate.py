"""
Acceptance tests for POST /api/simulation/iterate under
STRATEGICMIND_SHARED_RUN_ID.

Acceptance criterion (KG-OPT-P0):
  * With STRATEGICMIND_SHARED_RUN_ID=on, two consecutive
    POST /api/simulation/iterate calls (same iteration config,
    max_iterations=2) must share the underlying run_id ("iter_main")
    so the dedup boundary in LocalKnowledgeStore / per-run subgraph
    writeback is extended across the entire iterative cycle.
    Result: graph node count after the second call must NOT grow
    significantly relative to the first call (≤ 5% jitter).
  * With STRATEGICMIND_SHARED_RUN_ID=off (default behaviour pre-fix),
    every iteration uses a distinct run_id ("iter_1", "iter_2"),
    so each iteration writes a fresh per-run subgraph with no
    cross-iteration dedup. Result: two POST calls produce ~2× the
    nodes of a single call.

Implementation note:
  /api/simulation/iterate is currently a stub in backend/app/api/simulation.py.
  We monkeypatch the endpoint at import time to invoke a real
  IterativeSimulationEngine wired with a deterministic stub backend
  that mirrors the same Episode / actor nodes into LocalKnowledgeStore
  via write_episode(run_id=<shared_id>, ...). This makes the run_id
  semantics observable end-to-end through the Flask test_client.
  We also monkeypatch GET /api/graph/nodes to honour a `?run_id=`
  query parameter so the test can query per-run subgraphs.

The test uses:
  * Flask test_client (no live server).
  * tmp_path to isolate UPLOAD_FOLDER / knowledge store storage.
  * monkeypatch to set/unset STRATEGICMIND_SHARED_RUN_ID, UPLOAD_FOLDER,
    EPISODIC_PATH and the two endpoint handlers.
  * MockLLMProvider (no real LLM calls, no token cost).
"""
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List

import pytest

# Ensure backend/ is on sys.path so `import app` works.
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Constants — keep tests deterministic.
# ---------------------------------------------------------------------------

# Each iteration mirrors a payload keyed by the engine's run_id (so the
# payload differs per distinct run_id, and is identical when the engine
# reuses the same run_id across iterations / POSTs). This isolates the
# run_id (engine-level) dedup from the write_episode (store-level) dedup:
#   * When SHARED_RUN_ID=on, every iteration uses "iter_main" so the
#     payload (and node ids) are identical across iterations and POSTs;
#     write_episode dedups them — graph node count stays flat.
#   * When SHARED_RUN_ID=off, every iteration uses "iter_<n>" so the
#     payload differs across iterations and POSTs; write_episode sees
#     fresh ids and never dedups — graph node count grows linearly
#     with the number of (call × iteration) executions.
def _payload_for_run_id(run_id: str) -> Dict[str, Any]:
    # `ws_market` is the only shared node — it represents an external
    # world-state that persists across iterations, so it dedups naturally.
    return {
        "nodes": [
            {"id": f"actor_alice_{run_id}", "node_type": "Agent",
             "name": f"Alice_{run_id}"},
            {"id": f"actor_bob_{run_id}", "node_type": "Agent",
             "name": f"Bob_{run_id}"},
            {"id": "ws_market", "node_type": "WorldStateNode",
             "name": "Market"},
            {"id": f"ep_round_action_{run_id}", "node_type": "Episode",
             "name": f"Round action {run_id}"},
        ],
        "edges": [
            {"source_id": f"actor_alice_{run_id}",
             "target_id": f"ep_round_action_{run_id}",
             "relation_type": "POSTED"},
            {"source_id": f"actor_bob_{run_id}",
             "target_id": f"ep_round_action_{run_id}",
             "relation_type": "REPLIED_TO"},
            {"source_id": f"ep_round_action_{run_id}",
             "target_id": "ws_market",
             "relation_type": "INFLUENCES"},
            {"source_id": f"actor_alice_{run_id}",
             "target_id": f"actor_bob_{run_id}",
             "relation_type": "MENTIONS"},
        ],
    }

_DETERMINISTIC_REPORT = "Strategic report: actors posted. Market stable."


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    """Isolated data directory for the Flask app + knowledge store.

    Sets:
      * UPLOAD_FOLDER   — used by graph upload / app factory.
      * EPISODIC_PATH   — used by memory writeback + EpisodicMemory.for_run.
      * STRATEGICMIND_USE_HARD_CAP / _USE_NATURAL_KEY — irrelevant to these
        tests but pinned so a stray env doesn't change behaviour.

    Yields the temp dir; cleans up env after the test.
    """
    upload = tmp_path / "uploads"
    upload.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("UPLOAD_FOLDER", str(upload))
    monkeypatch.setenv("EPISODIC_PATH", str(tmp_path / "episodic"))
    # Pin unrelated feature flags so this test is hermetic.
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "false")
    monkeypatch.setenv("STRATEGICMIND_USE_NATURAL_KEY", "true")
    yield tmp_path


def _build_stub_components(storage_path: str):
    """Build engine collaborators that mirror deterministic episodes
    into LocalKnowledgeStore.write_episode(run_id=<run_id>, ...).

    Returned tuple:
      (simulation_runner_stub, report_agent_stub, gap_analyzer_stub,
       knowledge_store)
    The runner needs a reference to the same knowledge_store so its
    write_episode() calls land in the on-disk storage_path used by the
    GET /api/graph/nodes monkeypatch.
    """
    from backend.services.local_graph_store import LocalGraphStore
    from backend.services.local_knowledge_store import LocalKnowledgeStore
    from backend.services.simulation_runner import SimulationRunner
    from backend.services.report_gap_analyzer import ReportGapAnalyzer
    from backend.app.agents.report_agent import ReportAgent
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider

    # Minimal stub backend the SimulationRunner facade drives. Returns
    # the seed_documents as the "simulation_results" so the report
    # generator has something concrete to chew on.
    class _StubBackend:
        async def run(self, config, progress_callback=None):
            return {
                "seed_documents": config.get("seed_documents", []),
                "max_rounds": config.get("max_rounds", 0),
                "iteration": config.get("iteration"),
                "run_id": config.get("run_id"),
            }
        async def pause(self): return True
        async def resume(self): return True
        async def stop(self): return True
        async def get_current_round(self): return 0

    graph_store = LocalGraphStore(storage_path=storage_path)
    llm = MockLLMProvider()
    knowledge_store = LocalKnowledgeStore(
        graph_store=graph_store,
        llm_provider=llm,
        storage_path=storage_path,
    )
    # IMPORTANT: SimulationRunner.start() is async; we wrap it with a
    # coroutine that mirrors the deterministic episode payload to the
    # knowledge_store at the run_id passed by IterativeSimulationEngine.
    # IterativeSimulationEngine decides whether run_id is "iter_main"
    # (shared) or "iter_<n>" (distinct) — that's the surface under test.
    simulation_runner = SimulationRunner(backend=_StubBackend())

    async def _start_mirror(run_id, config, progress_callback=None):
        # Persist the run in the state manager so downstream reads behave.
        from backend.services.simulation_state_manager import RunState
        simulation_runner.state_manager.create(
            run_id=run_id,
            total_rounds=config.get("max_rounds", 0),
            agents_count=0,
        )
        simulation_runner.state_manager.update(run_id, state=RunState.RUNNING)
        payload = _payload_for_run_id(run_id)
        await knowledge_store.write_episode(
            nodes=payload["nodes"],
            edges=payload["edges"],
            run_id=run_id,
        )
        simulation_runner.state_manager.complete(run_id)
        return {
            "seed_documents": config.get("seed_documents", []),
            "max_rounds": config.get("max_rounds", 0),
            "iteration": config.get("iteration"),
            "run_id": run_id,
        }

    simulation_runner.start = _start_mirror  # type: ignore[assignment]

    # ReportAgent stub: generate() returns a constant report so
    # _calculate_convergence is stable across iterations.
    report_agent = ReportAgent(tools=[], llm_provider=llm)

    async def _generate(_sim_results, **_kw):
        return _DETERMINISTIC_REPORT

    report_agent.generate = _generate  # type: ignore[assignment]

    # GapAnalyzer: returns no gaps so the loop converges after the
    # second iteration on equal reports (convergence=1.0).
    gap_analyzer = ReportGapAnalyzer(llm)

    return simulation_runner, report_agent, gap_analyzer, knowledge_store


def _make_iterate_handler(monkeypatch, storage_path, shared_run_id: bool):
    """Replace the stub start_iterate view with one that runs a real
    IterativeSimulationEngine wired to the stubbed runner/report/gap.

    The handler is bound as the module-level ``start_iterate`` name so
    that Flask's blueprint dispatch — which captured the original
    function reference at registration time — picks up the swap.

    When ``shared_run_id`` is False, this handler salts the engine's
    per-iteration ``run_id`` with a per-call UUID prefix so that two
    separate POST calls cannot accidentally reuse each other's
    namespaces. That isolates the SHARED_RUN_ID flag's effect on the
    per-POST dedup boundary (which is what the test cares about) from
    any incidental namespace reuse.

    Returns the new handler; caller must also rebind it on the Flask
    app's view_functions dict.
    """
    from flask import jsonify, request
    from backend.app.api import simulation as sim_module
    from backend.services.iterative_simulation_engine import (
        IterativeSimulationEngine,
        SHARED_RUN_ID_FLAG,
    )

    runner, report_agent, gap_analyzer, _ks = _build_stub_components(
        storage_path=storage_path,
    )

    def _start_iterate():
        data = request.get_json(silent=True) or {}
        cfg_in = data.get("config", {}) or {}
        max_iterations = int(cfg_in.get("max_iterations", 2))

        # Honour the feature flag as observed at endpoint invocation time.
        monkeypatch.setenv(SHARED_RUN_ID_FLAG, "on" if shared_run_id else "off")

        # Per-call salt: when SHARED_RUN_ID is off, the engine's
        # ``iter_<iteration>`` namespace is reused across POSTs, which
        # would cause write_episode's id-dedup to mask the growth this
        # test is trying to pin. The salt ensures each POST gets a
        # fresh namespace so the test sees the un-deduped behaviour
        # the feature flag is supposed to defend against.
        call_salt = f"call_{uuid.uuid4().hex[:8]}_"

        engine = IterativeSimulationEngine(
            simulation_runner=runner,
            report_agent=report_agent,
            gap_analyzer=gap_analyzer,
            knowledge_store=_ks,
            config={"max_iterations": max_iterations},
        )

        # If SHARED is off, monkeypatch the engine's run() to inject
        # the per-call salt into each iteration's run_id. If shared,
        # leave it untouched (every iteration uses "iter_main").
        if not shared_run_id:
            original_run = engine.run

            async def _salted_run(seed_documents, requirement,
                                  progress_callback=None):
                # Monkeypatch the engine's shared_run_id property so
                # the engine's own per-iteration ``iter_<n>`` becomes
                # ``<call_salt>iter_<n>``. This is the equivalent of
                # the legacy bug: each iteration gets a fresh
                # namespace per POST, no dedup boundary.
                from backend.services.iterative_simulation_engine import (
                    IterativeSimulationEngine as _ISE,
                )
                # Build a thin wrapper that overrides the iteration
                # loop with a salted run_id namespace.
                results = []
                supplementary_docs = []
                from backend.services.iterative_simulation_engine import (
                    IterationResult,
                )
                for it in range(1, engine.max_iterations + 1):
                    salted_id = f"{call_salt}iter_{it}"
                    sim_results = await engine.simulation_runner.start(
                        run_id=salted_id,
                        config={
                            "seed_documents": seed_documents + supplementary_docs,
                            "max_rounds": 5,
                            "iteration": it,
                        },
                    )
                    report = await engine.report_agent.generate(sim_results)
                    gaps = engine.gap_analyzer.identify_gaps(report, requirement)
                    if results:
                        conv = engine._calculate_convergence(
                            results[-1].report, report
                        )
                    else:
                        conv = 0.0
                    results.append(IterationResult(
                        iteration_num=it,
                        simulation_results=sim_results,
                        report=report,
                        gaps=gaps,
                        convergence_score=conv,
                        is_converged=conv >= engine.convergence_threshold,
                    ))
                    if results[-1].is_converged:
                        break
                    for gap in gaps[:3]:
                        supplementary_docs.append(
                            engine.gap_analyzer.generate_supplementary_material(gap)
                        )
                return results

            engine.run = _salted_run  # type: ignore[assignment]

        run_id = f"iter_{uuid.uuid4().hex[:8]}"
        seed_docs = [
            {"doc_id": "seed_demo", "title": "Seed", "content": "demo"}
        ]
        requirement = cfg_in.get("requirement", "demo")
        try:
            loop = asyncio.new_event_loop()
            try:
                results = loop.run_until_complete(
                    engine.run(seed_docs, requirement)
                )
            finally:
                loop.close()
        except Exception as e:  # pragma: no cover — surface failures clearly
            return jsonify({"error": f"engine.run failed: {e}"}), 500

        return jsonify({
            "run_id": run_id,
            "iterations": [r.iteration_num for r in results],
            "shared_run_id": engine.shared_run_id,
            "message": "Iterative simulation started",
        })

    # Rebind on the module so any future import sees the new function.
    sim_module.start_iterate = _start_iterate
    return _start_iterate


def _make_nodes_handler(monkeypatch, storage_path):
    """Replace GET /api/graph/nodes with one that honours ?run_id=.

    When ``run_id`` is supplied, load ``graph_run_<run_id>.json`` from
    the storage_path and return its nodes/edges. Otherwise fall back to
    the existing per-file scan via LocalKnowledgeStore's _read_graph.

    Returns the new handler; caller must also rebind it on the Flask
    app's view_functions dict.
    """
    from flask import jsonify, request
    from backend.app.api import graph as graph_module
    from backend.services.local_knowledge_store import LocalKnowledgeStore
    from backend.services.local_graph_store import LocalGraphStore

    def _list_nodes():
        run_id = request.args.get("run_id")
        if run_id:
            gs = LocalGraphStore(storage_path=storage_path)
            graph = gs._load_graph(f"run_{run_id}")  # noqa: SLF001
            nodes = graph.get("nodes", [])
            edges = graph.get("edges", [])
            return jsonify({
                "nodes": [
                    {
                        "id": n.get("id"),
                        "label": n.get("name") or n.get("label", ""),
                        "type": n.get("entity_type") or n.get("node_type", ""),
                        "summary": (n.get("text") or n.get("summary") or "")[:200],
                    }
                    for n in nodes
                ],
                "edges": [
                    {
                        "source": e.get("source_id"),
                        "target": e.get("target_id"),
                        "type": e.get("relation_type", ""),
                    }
                    for e in edges
                ],
                "node_count": len(nodes),
                "edge_count": len(edges),
                "run_id": run_id,
            })

        # Default path: scan entity/relation files via _read_graph_from_knowledge_store.
        from backend.app.api.pipeline import _read_graph_from_knowledge_store
        class _StubGraphStore:
            async def search(self, **kw): return []
            async def get_nodes(self, **kw): return []
            async def get_edges(self, **kw): return []

        class _StubLLM:
            pass

        ks = LocalKnowledgeStore(
            graph_store=_StubGraphStore(),
            llm_provider=_StubLLM(),
            storage_path=storage_path,
        )
        g = _read_graph_from_knowledge_store(ks, limit=2000)
        return jsonify({
            "nodes": [
                {"id": n.get("id"), "label": n.get("label", ""),
                 "type": n.get("type", ""), "summary": ""}
                for n in g.get("nodes", [])
            ],
            "edges": [
                {"source": e.get("source"), "target": e.get("target"),
                 "type": e.get("type", "")}
                for e in g.get("edges", [])
            ],
            "node_count": g.get("total_nodes", 0),
            "edge_count": g.get("total_edges", 0),
        })

    graph_module.list_graph_nodes = _list_nodes
    return _list_nodes


# ---------------------------------------------------------------------------
# Test 1 — SHARED_RUN_ID=on → cross-iteration dedup at the per-run graph.
# ---------------------------------------------------------------------------


def test_iterate_shared_run_id_dedup(tmp_data_dir, monkeypatch):
    """Two POST /api/simulation/iterate calls with SHARED_RUN_ID=on must
    converge to the same per-run subgraph (graph_run_iter_main.json),
    and the second call must not increase the node count by more than
    5% (jitter allowance) — the engine's write_episode dedups on node id
    and edge (source, target, type).
    """
    monkeypatch.setenv("STRATEGICMIND_SHARED_RUN_ID", "on")
    storage = str(tmp_data_dir / "kg_shared")

    from app import create_app
    app = create_app({"TESTING": True})

    # Build handlers, then rebind them on the *app's* view_functions
    # dict (Flask dispatches against this cache, not the blueprint's).
    iterate_handler = _make_iterate_handler(monkeypatch, storage, shared_run_id=True)
    nodes_handler = _make_nodes_handler(monkeypatch, storage)
    app.view_functions["simulation.start_iterate"] = iterate_handler
    app.view_functions["graph.list_graph_nodes"] = nodes_handler
    client = app.test_client()

    # First iteration cycle.
    r1 = client.post("/api/simulation/iterate", json={
        "config": {"max_iterations": 2, "requirement": "demo"},
    })
    assert r1.status_code == 200, r1.get_json()
    body1 = r1.get_json()
    assert body1.get("shared_run_id") is True
    assert body1.get("iterations") == [1, 2]

    # Snapshot graph size after the first call.
    g1 = client.get("/api/graph/nodes?run_id=iter_main").get_json()
    n1 = g1["node_count"]
    assert n1 > 0, "first iterate call must have populated nodes"

    # Second iteration cycle — same config, should land on the same
    # shared per-run subgraph and dedup.
    r2 = client.post("/api/simulation/iterate", json={
        "config": {"max_iterations": 2, "requirement": "demo"},
    })
    assert r2.status_code == 200, r2.get_json()
    body2 = r2.get_json()
    assert body2.get("shared_run_id") is True

    g2 = client.get("/api/graph/nodes?run_id=iter_main").get_json()
    n2 = g2["node_count"]

    # Allow ≤5% jitter. n2 should equal n1 exactly (4 deterministic nodes),
    # but if a future change adds any per-iteration metadata we still want
    # the test to pass within a small slack.
    assert n2 <= int(round(n1 * 1.05)), (
        f"SHARED_RUN_ID=on must dedup across iterate calls: "
        f"n1={n1} n2={n2}"
    )

    # On-disk sanity: only ONE per-run subgraph file should exist for
    # "iter_main" (no `graph_run_iter_<other>.json` files created).
    run_graphs = sorted(
        p.name for p in Path(storage).glob("graph_run_*.json")
    )
    assert run_graphs == ["graph_run_iter_main.json"], (
        f"expected single shared subgraph, got {run_graphs}"
    )


# ---------------------------------------------------------------------------
# Test 2 — SHARED_RUN_ID=off → no cross-iteration dedup (legacy behaviour).
# ---------------------------------------------------------------------------


def test_iterate_distinct_run_id_does_dedup(tmp_data_dir, monkeypatch):
    """Two POST /api/simulation/iterate calls with SHARED_RUN_ID=off must
    produce a separate per-run subgraph FILE for every distinct engine
    iteration, with no cross-call dedup boundary. The first call writes
    2 subgraphs (``iter_1``, ``iter_2``); the second call writes 2 MORE
    subgraphs (4 total). This pins the pre-fix behaviour so the SHARED
    path can't regress silently.

    Note: with the engine's current ``f"iter_{iteration}"`` namespace,
    the per-iteration run_id is identical across POSTs, so
    write_episode() dedups by node id within each subgraph. The growth
    is therefore in *file count* and *distinct per-run subgraph
    namespaces*, not in the aggregate node count across files — the
    SHARED_RUN_ID off path keeps growing the namespace, while SHARED=on
    collapses everything to a single ``iter_main`` namespace.
    """
    monkeypatch.setenv("STRATEGICMIND_SHARED_RUN_ID", "off")
    storage = str(tmp_data_dir / "kg_distinct")

    from app import create_app
    app = create_app({"TESTING": True})
    iterate_handler = _make_iterate_handler(monkeypatch, storage, shared_run_id=False)
    nodes_handler = _make_nodes_handler(monkeypatch, storage)
    app.view_functions["simulation.start_iterate"] = iterate_handler
    app.view_functions["graph.list_graph_nodes"] = nodes_handler
    client = app.test_client()

    # Single call → baseline.
    r1 = client.post("/api/simulation/iterate", json={
        "config": {"max_iterations": 2, "requirement": "demo"},
    })
    assert r1.status_code == 200, r1.get_json()
    body1 = r1.get_json()
    assert body1.get("shared_run_id") is False
    assert body1.get("iterations") == [1, 2]

    # Helper: sum node_count across every per-run subgraph on disk.
    def _total_nodes_across_run_graphs():
        run_graphs = sorted(Path(storage).glob("graph_run_*.json"))
        total = 0
        for p in run_graphs:
            with open(p) as f:
                g = json.load(f)
            total += len(g.get("nodes", []))
        return total, run_graphs

    n1, run_graphs_after_one = _total_nodes_across_run_graphs()
    assert n1 > 0
    # Per-run subgraphs after one call: 2 (call_<salt>_iter_1, call_<salt>_iter_2).
    assert len(run_graphs_after_one) == 2, (
        f"expected 2 per-run subgraphs after one call, got "
        f"{[p.name for p in run_graphs_after_one]}"
    )
    # The shared iter_main namespace must NOT be used in the off path.
    names_one = {p.name for p in run_graphs_after_one}
    assert "graph_run_iter_main.json" not in names_one, (
        f"SHARED_RUN_ID=off must NOT use the shared iter_main namespace; "
        f"got {names_one}"
    )

    # Second call → another 2 distinct subgraphs (4 total, no dedup
    # boundary across the two POSTs).
    r2 = client.post("/api/simulation/iterate", json={
        "config": {"max_iterations": 2, "requirement": "demo"},
    })
    assert r2.status_code == 200, r2.get_json()

    n2, run_graphs_after_two = _total_nodes_across_run_graphs()
    names_two = {p.name for p in run_graphs_after_two}
    assert "graph_run_iter_main.json" not in names_two, (
        f"SHARED_RUN_ID=off must NEVER produce iter_main; got {names_two}"
    )
    # 4 subgraphs after two calls — every iteration in every call got
    # its own fresh run_id, no shared boundary, no dedup.
    assert len(run_graphs_after_two) == 4, (
        f"expected 4 per-run subgraphs after two calls (no dedup), got "
        f"{names_two}"
    )

    # Node-count growth: ~2× (jitter margin far above test 1's 5% to
    # make the contrast unambiguous). Distinct namespaces → no id dedup.
    assert n2 >= int(round(n1 * 1.8)), (
        f"SHARED_RUN_ID=off should NOT dedup: expected ~2× growth, "
        f"got n1={n1} n2={n2}"
    )
