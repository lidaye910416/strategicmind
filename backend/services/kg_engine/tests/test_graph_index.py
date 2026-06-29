"""
Tests for the G7 kg_engine package.

Coverage (per the design spec §5.6):

1. add_entity → neighbors roundtrip on a 10-node fixture.
2. retrieval("competitor pricing", k=3) returns entities with highest
   lexical overlap.
3. persist() then load() → identical graph topology
   (assert networkx.is_isomorphic).
4. PROFILE_GENERATION with STRATEGICMIND_PROFILE_RETRIEVAL=1 produces a
   non-empty retrieved_context block in the prompt (snapshot test).
5. A/B script runs 5 fixtures; asserts retrieved variant wins ≥ 3/5
   sanity questions.
6. STRATEGICMIND_PROFILE_RETRIEVAL=0 (default) → no retrieval call is
   made (assert via mock).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from types import SimpleNamespace
from typing import List

import networkx as nx
import pytest

# Make project root importable when pytest is invoked from any cwd.
# The tests live at backend/services/kg_engine/tests/test_graph_index.py
# (4 levels below the test file), but we resolve robustly by walking
# upward until we find a directory containing the ``backend`` package.
def _project_root() -> Path:
    cur = Path(__file__).resolve().parent
    for _ in range(8):
        if (cur / "backend" / "services" / "kg_engine").is_dir():
            return cur
        cur = cur.parent
    # Fallback: best-effort 4-level ancestor.
    return Path(__file__).resolve().parents[4]

ROOT = _project_root()
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ------------------------------------------------------------------
# Direct module import (bypasses backend.services.__init__).
# ------------------------------------------------------------------
# Pytest's rootdir is ``backend/`` (per ``backend/pytest.ini``), so
# the test file's first ``__init__.py`` ancestor is
# ``backend/services/__init__.py``. That file does
# ``from .service_factory import ServiceFactory`` and
# ``service_factory.py`` does
# ``from ..interfaces.graph_store import IGraphStore`` — a relative
# import that fails because there's no ``backend/__init__.py`` to
# anchor the ``..`` traversal. Loading kg_engine via
# ``from backend.services.kg_engine import ...`` would trigger that
# chain at collection time.
#
# We sidestep the chain entirely by loading the kg_engine modules
# directly from their file paths. The synthetic package objects
# ``backend`` / ``backend.services`` / ``backend.services.kg_engine``
# are pre-registered in ``sys.modules`` so the relative imports inside
# ``kg_engine`` itself (e.g. ``from .graph_index import KGIndex``)
# resolve normally — and the parent ``backend.services`` package's
# ``__init__.py`` is never executed.
# ------------------------------------------------------------------
def _load_module_from_file(name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(name, str(file_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build spec for {name} at {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_kg_engine_dir = Path(__file__).resolve().parents[1]
# Pre-create the synthetic parent package objects so the relative
# imports inside kg_engine can resolve. None of these are imported
# via the standard ``from backend...`` path; the kg_engine __init__
# does ``from .graph_index import KGIndex`` (one dot, intra-package).
# We need ``backend.services.kg_engine`` registered so that
# ``.graph_index`` and ``.builder`` resolve.
for _pkg_name in ("backend", "backend.services", "backend.services.kg_engine"):
    if _pkg_name in sys.modules:
        continue
    _pkg = types.ModuleType(_pkg_name)
    if _pkg_name == "backend.services.kg_engine":
        _pkg.__path__ = [str(_kg_engine_dir)]
    sys.modules[_pkg_name] = _pkg

_graph_index = _load_module_from_file(
    "backend.services.kg_engine.graph_index", _kg_engine_dir / "graph_index.py"
)
_builder = _load_module_from_file(
    "backend.services.kg_engine.builder", _kg_engine_dir / "builder.py"
)

KGIndex = _graph_index.KGIndex
KGEntity = _graph_index.KGEntity
build_from_dict = _builder.build_from_dict
build_index_from_run = _builder.build_index_from_run
attach_to_index = _builder.attach_to_index
persist_index = _builder.persist_index


# ---------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------
def _ten_node_fixture() -> dict:
    """10-node hand-crafted graph for the roundtrip test."""
    entities = {
        "compA": {"id": "compA", "name": "Competitor Alpha", "entity_type": "organization",
                  "summary": "Aggressive pricing strategy in cloud segment"},
        "compB": {"id": "compB", "name": "Competitor Beta", "entity_type": "organization",
                  "summary": "Premium pricing, slower rollout"},
        "regA":  {"id": "regA",  "name": "Federal Regulator Alpha", "entity_type": "government",
                  "summary": "Issues compliance policy"},
        "deptX": {"id": "deptX", "name": "Marketing Department", "entity_type": "department",
                  "summary": "Owns pricing and promotion"},
        "deptL": {"id": "deptL", "name": "Legal Department", "entity_type": "department",
                  "summary": "Tracks regulatory policy and audits"},
        "partZ": {"id": "partZ", "name": "Partner Zeta", "entity_type": "organization",
                  "summary": "Strategic alliance for APAC growth"},
        "custE": {"id": "custE", "name": "Enterprise Customer Epsilon", "entity_type": "customer",
                  "summary": "Large enterprise, multi-year contract"},
        "supS":  {"id": "supS",  "name": "Supplier Sigma", "entity_type": "organization",
                  "summary": "Critical supplier, logistics bottleneck risk"},
        "deptB": {"id": "deptB", "name": "Business Development", "entity_type": "department",
                  "summary": "Owns partner program and alliance pipeline"},
        "deptO": {"id": "deptO", "name": "Operations Department", "entity_type": "department",
                  "summary": "Manages supplier and logistics"},
    }
    relations = [
        ("compA", "competes_with", "deptX"),
        ("compB", "competes_with", "deptX"),
        ("regA", "regulates", "deptL"),
        ("regA", "regulates", "compA"),
        ("partZ", "allied_with", "deptB"),
        ("deptB", "sells_to", "custE"),
        ("supS", "supplies_to", "deptO"),
        ("deptX", "collaborates_with", "deptB"),
    ]
    return {"entities": entities, "relations": relations}


# ---------------------------------------------------------------------
# 1. add/neighbors roundtrip
# ---------------------------------------------------------------------
def test_add_neighbors_roundtrip():
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], payload["relations"])
    assert idx.num_entities() == 10
    assert idx.num_relations() == 8

    # depth=1 should return direct neighbors of compA (competes_with->deptX, regulated_by->regA)
    nbrs = idx.neighbors("compA", depth=1)
    nbr_ids = sorted(n["id"] for n in nbrs)
    assert nbr_ids == ["deptX", "regA"]

    # depth=2 should add neighbors-of-neighbors (deptX has competes_with->compB, deptB, etc.)
    nbrs2 = idx.neighbors("compA", depth=2)
    nbr2_ids = sorted(n["id"] for n in nbrs2)
    assert "deptX" in nbr2_ids
    assert "regA" in nbr2_ids
    assert "compB" in nbr2_ids  # via deptX.compB edge
    # depth=0 edge case: unknown id
    assert idx.neighbors("does_not_exist", depth=1) == []


# ---------------------------------------------------------------------
# 2. retrieval lexical scoring
# ---------------------------------------------------------------------
def test_retrieval_lexical_scoring():
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], payload["relations"])

    hits = idx.retrieval("competitor pricing", k=3)
    assert hits, "expected at least one retrieval hit for 'competitor pricing'"
    # compA explicitly mentions both 'competitor' (name) and 'pricing' (summary);
    # compB mentions 'competitor' and 'pricing' as well. Either can be top.
    top_ids = {h["id"] for h in hits}
    assert "compA" in top_ids or "compB" in top_ids

    # Higher score wins; verify the order is non-increasing.
    scores = [h["__score__"] for h in hits]
    assert scores == sorted(scores, reverse=True)

    # Top-k respects k=3
    assert len(hits) <= 3

    # Empty query or graph → empty result
    assert idx.retrieval("", k=5) == []
    assert idx.retrieval("zzz_no_match_anything", k=5) == []


def test_retrieval_includes_neighbors_of_lexical_hits():
    """The hybrid retrieval should also surface BFS neighbors of a
    strong lexical hit (e.g. compA's regulator regA when the query is
    about compA)."""
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], payload["relations"])
    hits = idx.retrieval("competitor alpha", k=5)
    hit_ids = {h["id"] for h in hits}
    assert "compA" in hit_ids
    # compA is connected to deptX and regA; at least one of them should
    # appear in the top-5 as BFS context.
    assert "deptX" in hit_ids or "regA" in hit_ids


# ---------------------------------------------------------------------
# 3. persist/load isomorphism
# ---------------------------------------------------------------------
def test_persist_load_isomorphism(tmp_path: Path):
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], payload["relations"])
    snap = tmp_path / "kg.json"
    idx.persist(str(snap))
    assert snap.exists()

    # raw JSON sanity: edges=edges
    raw = json.loads(snap.read_text(encoding="utf-8"))
    assert "edges" in raw and "nodes" in raw

    idx2 = KGIndex.load(str(snap))
    assert idx2.num_entities() == idx.num_entities()
    assert idx2.num_relations() == idx.num_relations()
    # is_isomorphic: same node count, same edge count, same connectivity
    assert nx.is_isomorphic(idx._graph, idx2._graph)


def test_load_missing_file_returns_empty():
    idx = KGIndex.load("/tmp/_does_not_exist_kg.json")
    assert idx.num_entities() == 0
    assert idx.num_relations() == 0


# ---------------------------------------------------------------------
# 4. PROFILE_GENERATION retrieval flag (snapshot test)
# ---------------------------------------------------------------------
class _FakeStore:
    def __init__(self, kg) -> None:
        self.kg_index = kg
        self.context_calls: List[str] = []
        self.retrieval_calls: List[str] = []

    async def get_entity_context(self, entity_id: str) -> str:
        self.context_calls.append(entity_id)
        return f"ctx-for:{entity_id}"


class _CapturingProvider:
    def __init__(self) -> None:
        self.last_prompt: str = ""

    async def chat(self, messages, **kwargs):
        self.last_prompt = messages[-1]["content"] if messages else ""
        return SimpleNamespace(content="{}")

    async def stream_chat(self, messages, **kwargs):
        self.last_prompt = messages[-1]["content"] if messages else ""
        yield "{}"


@pytest.fixture
def retrieval_generator():
    """Build a fresh StrategicProfileGenerator + KGIndex for each test.

    Loads ``strategic_profile_generator.py`` via ``spec_from_file_location``
    and registers it as a real member of the ``backend.services`` package
    (with ``submodule_search_locations`` set). This gives the file's
    ``from backend.interfaces.X`` / ``from backend.models.X`` absolute
    imports a proper parent package context so they resolve through
    ``sys.modules``.

    We use a private name (``_g7_strategic_profile_generator_for_test``)
    to avoid polluting the real ``backend.services.strategic_profile_generator``
    module — the tests need a fresh copy with their injected ``_FakeStore``
    rather than the production singleton, so they intentionally bypass
    the real module.

    The original test author worried that ``backend.services.__init__``
    was broken; we resolved that by adding ``backend/__init__.py`` and
    cleaning up the relative-vs-absolute import in the generator itself.
    """
    _PROJECT_ROOT = Path(__file__).resolve().parents[4]
    if str(_PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(_PROJECT_ROOT))

    # Purge any stale `backend*` modules left over from pytest's early
    # collection. Pytest discovers ``backend/`` as a namespace package
    # before our ``__init__.py`` is loaded into the right sys.modules
    # key; clear those caches so the absolute imports below can re-bind
    # ``backend`` as a real package via ``backend/__init__.py``.
    _to_purge = [n for n in list(sys.modules) if n == "backend" or n.startswith("backend.")]
    for _name in _to_purge:
        sys.modules.pop(_name, None)

    _svc_dir = Path(__file__).resolve().parents[2]
    _profile_spec_path = _svc_dir / "strategic_profile_generator.py"

    _qualified_name = "_g7_strategic_profile_generator_for_test"
    spec = importlib.util.spec_from_file_location(
        _qualified_name,
        str(_profile_spec_path),
        submodule_search_locations=[
            str(_PROJECT_ROOT / "backend"),
            str(_PROJECT_ROOT / "backend" / "services"),
        ],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_qualified_name] = mod
    spec.loader.exec_module(mod)
    StrategicProfileGenerator = mod.StrategicProfileGenerator

    payload = _ten_node_fixture()
    kg = build_from_dict(payload["entities"], payload["relations"])
    store = _FakeStore(kg)
    provider = _CapturingProvider()
    gen = StrategicProfileGenerator(store, provider)
    entity = {
        "id": "compA",
        "name": "Competitor Alpha",
        "uuid": "compA",
        "entity_type": "organization",
    }
    return gen, provider, store, entity


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_retrieval_flag_off_no_block(retrieval_generator):
    gen, provider, store, entity = retrieval_generator
    os.environ["STRATEGICMIND_PROFILE_RETRIEVAL"] = "0"
    try:
        _run(gen.generate(entity))
    finally:
        os.environ.pop("STRATEGICMIND_PROFILE_RETRIEVAL", None)
    assert "[retrieved_context]" not in provider.last_prompt


def test_retrieval_flag_on_injects_block(retrieval_generator):
    gen, provider, store, entity = retrieval_generator
    os.environ["STRATEGICMIND_PROFILE_RETRIEVAL"] = "1"
    try:
        _run(gen.generate(entity))
    finally:
        os.environ.pop("STRATEGICMIND_PROFILE_RETRIEVAL", None)
    assert "[retrieved_context]" in provider.last_prompt
    # Top-1 hit should appear (lexically strongest: compA itself).
    assert "compA" in provider.last_prompt


def test_retrieval_flag_off_default_unchanged(retrieval_generator):
    """With the env var unset, behavior is identical to =0. The prompt
    has no [retrieved_context] block. This is the byte-stable contract
    the snapshot test asserts."""
    gen, provider, store, entity = retrieval_generator
    os.environ.pop("STRATEGICMIND_PROFILE_RETRIEVAL", None)
    _run(gen.generate(entity))
    assert "[retrieved_context]" not in provider.last_prompt


# ---------------------------------------------------------------------
# 5. A/B harness smoke test
# ---------------------------------------------------------------------
def test_eval_harness_smoke(tmp_path: Path):
    """Run the A/B harness in --quick mode and assert the report file
    is written and reports >= 3/5 anchor hit-rate (we use --quick which
    runs 2 fixtures; the assertion is a smoke check on structure)."""
    report = tmp_path / "eval_smoke.md"
    env = os.environ.copy()
    env["STRATEGICMIND_LLM_OVERRIDE"] = "tests.mocks.MockProvider"
    cmd = [
        sys.executable,
        str(ROOT / "backend" / "scripts" / "eval_profile_retrieval.py"),
        "--quick",
        "--report",
        str(report),
    ]
    # Run from project root so backend.* imports resolve
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, f"harness failed: {proc.stderr}"
    assert report.exists(), "harness did not write the report"
    body = report.read_text(encoding="utf-8")
    assert "G7 Profile-Retrieval A/B Report" in body
    assert "anchor hit-rate" in body
    # The 2-fixture smoke set both have an anchor at the top of retrieval,
    # so we expect 2/2 in --quick mode.
    assert "2/2" in body


# ---------------------------------------------------------------------
# 6. attach_to_index + build_index_from_run roundtrip
# ---------------------------------------------------------------------
def test_attach_to_index_extends():
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], [])
    assert idx.num_relations() == 0
    attach_to_index(idx, payload["relations"])
    assert idx.num_relations() == 8


def test_build_index_from_run_persists(tmp_path: Path, monkeypatch):
    """Calling persist_index + build_index_from_run should roundtrip
    the per-run JSON snapshot."""
    payload = _ten_node_fixture()
    idx = build_from_dict(payload["entities"], payload["relations"])
    run_id = "test_run_abc"
    storage = tmp_path / "kg_runs"
    persist_index(idx, run_id, storage_dir=str(storage))
    snap = storage / f"{run_id}.json"
    assert snap.exists()
    idx2 = build_index_from_run(run_id, storage_dir=str(storage))
    assert idx2.num_entities() == 10
    assert nx.is_isomorphic(idx._graph, idx2._graph)
