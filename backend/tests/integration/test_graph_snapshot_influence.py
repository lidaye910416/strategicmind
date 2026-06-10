"""
Loop engine v2 — T0.2 backend integration test for graph-snapshot influence.

The plan's acceptance criterion (Phase 0 §T0.2) is:
    "integration test that node has influence field after graph build"

We test the public API surface that the frontend consumes:
* ``_read_graph_from_knowledge_store`` (the helper powering
  ``GET /api/pipeline/<id>/graph-snapshot``) must put a numeric
  ``influence`` on every node.
* Edges must carry an integer ``weight``.

This is a pure unit test of the helper — no live HTTP server required.
"""
import json
import os
import tempfile
from typing import List

import pytest

from backend.app.api import pipeline as pipeline_api


def _write_entity(storage_path: str, name: str, entity_type: str, influence=None) -> str:
    """Write a single entity JSON file and return its id."""
    import uuid

    eid = str(uuid.uuid4())
    payload = {
        "uuid": eid,
        "name": name,
        "entity_type": entity_type,
        "summary": f"summary-of-{name}",
        "attributes": {"influence": influence} if influence is not None else {},
        "metadata": {"source_doc": "test"},
    }
    fname = f"{eid}.json"
    with open(os.path.join(storage_path, fname), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return eid


def _write_relation(
    storage_path: str, source_id: str, target_id: str, weight: float = 1.0
) -> str:
    import uuid

    rid = str(uuid.uuid4())
    payload = {
        "uuid": rid,
        "source_id": source_id,
        "target_id": target_id,
        "relation_type": "RELATED_TO",
        "attributes": {"weight": weight},
    }
    fname = f"relation_{rid}.json"
    with open(os.path.join(storage_path, fname), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return rid


class _StubKnowledgeStore:
    """Stand-in for LocalKnowledgeStore: just exposes storage_path."""

    def __init__(self, storage_path: str) -> None:
        self.storage_path = storage_path


def test_graph_snapshot_node_has_influence_field():
    """T0.2 acceptance: node has influence field after graph build."""
    with tempfile.TemporaryDirectory() as tmp:
        # Three entities: one with explicit influence, one with attribute
        # influence, one with none (default 0.5).
        a = _write_entity(tmp, "Alpha", "PERSON", influence=0.9)
        b = _write_entity(tmp, "Beta", "COMPANY")  # no influence → default 0.5
        c = _write_entity(tmp, "Gamma", "PRODUCT")
        _write_relation(tmp, a, b, weight=2.0)
        _write_relation(tmp, a, c, weight=0.5)

        store = _StubKnowledgeStore(tmp)
        result = pipeline_api._read_graph_from_knowledge_store(store)

        assert {"nodes", "edges"} <= result.keys()
        assert len(result["nodes"]) == 3
        assert len(result["edges"]) == 2

        # Every node has a numeric influence in [0, 1].
        for node in result["nodes"]:
            assert "influence" in node, f"node missing influence: {node}"
            assert isinstance(node["influence"], (int, float))
            assert 0.0 <= float(node["influence"]) <= 1.0

        # Default is 0.5 when no influence is specified.
        by_id = {n["id"]: n for n in result["nodes"]}
        assert by_id[a]["influence"] == 0.9
        assert by_id[b]["influence"] == 0.5
        assert by_id[c]["influence"] == 0.5


def test_graph_snapshot_edge_has_integer_weight():
    with tempfile.TemporaryDirectory() as tmp:
        a = _write_entity(tmp, "A", "PERSON")
        b = _write_entity(tmp, "B", "PERSON")
        _write_relation(tmp, a, b, weight=3.7)  # fractional input

        store = _StubKnowledgeStore(tmp)
        result = pipeline_api._read_graph_from_knowledge_store(store)
        assert len(result["edges"]) == 1
        edge = result["edges"][0]
        assert "weight" in edge
        # The frontend selectWeight treats it as a count; we coerce to int.
        assert isinstance(edge["weight"], int)
        assert edge["weight"] == 4  # round(3.7)


def test_graph_snapshot_handles_missing_influence_gracefully():
    """An entity with no influence at all (even missing from attrs) → 0.5."""
    with tempfile.TemporaryDirectory() as tmp:
        # Entity with completely empty attributes
        import uuid

        eid = str(uuid.uuid4())
        with open(os.path.join(tmp, f"{eid}.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "uuid": eid,
                    "name": "Empty",
                    "entity_type": "UNKNOWN",
                    "attributes": {},
                },
                f,
            )

        store = _StubKnowledgeStore(tmp)
        result = pipeline_api._read_graph_from_knowledge_store(store)
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["influence"] == 0.5


def test_graph_snapshot_clamps_out_of_range_influence():
    """Influence > 1 or < 0 must be clamped into [0, 1]."""
    with tempfile.TemporaryDirectory() as tmp:
        too_high = _write_entity(tmp, "High", "PERSON", influence=1.7)
        too_low = _write_entity(tmp, "Low", "PERSON", influence=-0.4)
        store = _StubKnowledgeStore(tmp)
        result = pipeline_api._read_graph_from_knowledge_store(store)
        by_id = {n["id"]: n for n in result["nodes"]}
        assert by_id[too_high]["influence"] == 1.0
        assert by_id[too_low]["influence"] == 0.0
