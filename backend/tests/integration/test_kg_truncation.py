"""
Agent 3A v2 — global signal-density 二次截断 + 软降级桶独立计数 (Bug #1 N-fix)

覆盖 (N1/N2 from docs/bugs/01-kg-node-explosion.md):
  - test_global_truncation_with_5_docs: 5 doc × 50 entity → 持久化 ≤ 200
  - test_whitelist_protection: whitelist entity 不被 fallback bucket 挤掉
  - test_secondary_pool_disabled: STRATEGICMIND_KG_USES_SECONDARY_POOL=false 时跳过 global truncate
  - test_fallback_bucket_independent_counting: 软降级桶独立 MAX_FALLBACK_ENTITIES 截断
  - test_global_truncate_keeps_high_density: 截断后幸存 entity density ≥ 阈值
"""
import os
import sys
from pathlib import Path
from typing import List

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))


def _make_entity(name: str, entity_type: str, signal_density: float = 0.5):
    """Build a real Entity instance (avoids mocking to_dict / entity_type)."""
    from backend.models.entity import Entity

    return Entity(
        name=name,
        entity_type=entity_type,
        summary=f"summary for {name}",
        attributes={"signal_density": signal_density},
    )


def _stub_extractor(entities_per_call: List):
    """Stub EntityExtractor that returns the given entity list on every call."""

    class _StubExtractor:
        def __init__(self, ents):
            self._ents = ents
            self.knowledge_store = None

        async def extract_entities(self, content, ontology=None):
            return list(self._ents)

        async def extract_relations(self, content, entities, ontology=None):
            return []

    return _StubExtractor(entities_per_call)


def _stub_store():
    """Stub IKnowledgeStore that records inserted entities."""

    class _StubStore:
        def __init__(self):
            self.inserted = []

        async def insert_entity(self, entity_dict, metadata=None):
            self.inserted.append((entity_dict, metadata))
            return entity_dict.get("uuid") or f"id_{len(self.inserted)}"

        async def insert_relation(self, relation_dict):
            return None

    return _StubStore()


@pytest.mark.asyncio
async def test_global_truncation_with_5_docs(monkeypatch):
    """5 doc × 50 entity → 持久化 ≤ 200, 高 density 优先保留."""
    from backend.services.graph_builder_service import GraphBuilderService

    # Force low global target so we can verify the cap fires.
    monkeypatch.setenv("STRATEGICMIND_KG_GLOBAL_TARGET", "100")
    monkeypatch.setenv("STRATEGICMIND_KG_USES_SECONDARY_POOL", "true")
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "true")

    # Build 250 entities, mix of densities
    per_doc = []
    for i in range(50):
        # 25 high density, 25 low density per doc
        et = "Person" if i % 2 == 0 else "Organization"
        sd = 0.9 if i < 25 else 0.1
        per_doc.append(_make_entity(f"d0_e{i}", et, sd))

    extractor = _stub_extractor(per_doc)
    store = _stub_store()
    builder = GraphBuilderService(extractor, store)

    from backend.models.seed_document import SeedDocument, DocumentType

    docs = [
        SeedDocument(
            doc_id=f"doc_{k}",
            title=f"d{k}",
            content="x",
            doc_type=DocumentType.NEWS,
        )
        for k in range(5)
    ]
    result = await builder.build(docs)
    # 250 entities input, 100 cap, all whitelist → expect ≤ 100
    assert result["entities_created"] <= 100
    # Surviving entities should all be high density (0.9)
    surviving_sd = [
        (e.get("attributes") or {}).get("signal_density", 0.5)
        for e, _ in store.inserted
    ]
    if surviving_sd:
        assert min(surviving_sd) >= 0.5


@pytest.mark.asyncio
async def test_whitelist_protection(monkeypatch):
    """Whitelist entity 不被 fallback bucket 挤掉."""
    from backend.services.graph_builder_service import GraphBuilderService

    monkeypatch.setenv("STRATEGICMIND_KG_GLOBAL_TARGET", "20")
    monkeypatch.setenv("STRATEGICMIND_KG_USES_SECONDARY_POOL", "true")
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "true")

    # 10 primary (Person) + 80 fallback ("Other" type, gets soft-demoted to Concept)
    per_doc = []
    for i in range(10):
        per_doc.append(_make_entity(f"person_{i}", "Person", 0.9))
    for i in range(80):
        per_doc.append(_make_entity(f"noise_{i}", "Other", 0.1))

    extractor = _stub_extractor(per_doc)
    store = _stub_store()
    builder = GraphBuilderService(extractor, store)

    from backend.models.seed_document import SeedDocument, DocumentType

    docs = [SeedDocument(doc_id="d", title="d", content="x", doc_type=DocumentType.NEWS)]
    await builder.build(docs)

    types = [e.get("entity_type") for e, _ in store.inserted]
    # primary preserved (no soft-demote of Person)
    person_count = types.count("Person")
    assert person_count >= 8  # almost all primary retained

    # fallback bucket: at most 10 (MAX_FALLBACK_ENTITIES), all "Concept"
    concept_count = types.count("Concept")
    assert concept_count <= 10


@pytest.mark.asyncio
async def test_secondary_pool_disabled(monkeypatch):
    """STRATEGICMIND_KG_USES_SECONDARY_POOL=false → 跳过 global truncate, 走 per-doc 旧路径."""
    from backend.services.graph_builder_service import GraphBuilderService

    monkeypatch.setenv("STRATEGICMIND_KG_GLOBAL_TARGET", "5")
    monkeypatch.setenv("STRATEGICMIND_KG_USES_SECONDARY_POOL", "false")
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "true")

    per_doc = [
        _make_entity(f"e{i}", "Person", 0.5 + i * 0.01) for i in range(20)
    ]
    extractor = _stub_extractor(per_doc)
    store = _stub_store()
    builder = GraphBuilderService(extractor, store)

    from backend.models.seed_document import SeedDocument, DocumentType

    docs = [SeedDocument(doc_id="d", title="d", content="x", doc_type=DocumentType.NEWS)]
    result = await builder.build(docs)

    # per-doc 旧路径保留全部 20 个 (cap=25 by default, 5 doc 没起来走单 doc 20)
    assert result["entities_created"] == 20


@pytest.mark.asyncio
async def test_fallback_bucket_independent_counting(monkeypatch):
    """软降级桶独立 MAX_FALLBACK_ENTITIES=10 截断."""
    from backend.services.entity_extractor import EntityExtractor

    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "true")
    monkeypatch.setenv("STRATEGICMIND_MAX_ENTITIES_PER_DOC", "100")

    # Build 50 Person (whitelist) + 30 Other (fallback)
    payload = []
    for i in range(50):
        payload.append({
            "name": f"p{i}", "entity_type": "Person",
            "summary": "x", "attributes": {"signal_density": 0.9},
        })
    for i in range(30):
        payload.append({
            "name": f"o{i}", "entity_type": "Other",
            "summary": "x", "attributes": {"signal_density": 0.1},
        })
    import json
    response = json.dumps(payload)

    extractor = EntityExtractor.__new__(EntityExtractor)
    extractor._use_hard_cap = True
    extractor._softdemote_count = 0
    extractor.knowledge_store = None

    entities = extractor._parse_entity_response(response)
    types = [e.entity_type for e in entities]
    # primary 50 (Person) → MAX_ENTITIES (25) primary + fallback ≤ 10 (Concept)
    person_count = types.count("Person")
    concept_count = types.count("Concept")
    assert person_count == 25  # capped by MAX_ENTITIES_HINT
    assert concept_count <= 10
    # softdemote should have been triggered 30 times
    assert extractor._softdemote_count == 30


@pytest.mark.asyncio
async def test_global_truncate_keeps_high_density(monkeypatch):
    """Truncation 后幸存 entity 的 density 全部 ≥ 0.5 (top 200 by density)."""
    from backend.services.graph_builder_service import (
        GraphBuilderService,
        _global_signal_truncate,
    )
    from backend.services.kg_prompts import get_whitelist

    monkeypatch.setenv("STRATEGICMIND_KG_GLOBAL_TARGET", "50")
    monkeypatch.setenv("STRATEGICMIND_KG_USES_SECONDARY_POOL", "true")

    # 200 entities: 100 Person sd=0.9 + 100 Person sd=0.1
    ents = []
    for i in range(100):
        ents.append(_make_entity(f"hi_{i}", "Person", 0.9))
    for i in range(100):
        ents.append(_make_entity(f"lo_{i}", "Person", 0.1))

    wl = get_whitelist()
    kept = _global_signal_truncate(ents, target=50, whitelist=wl)
    assert len(kept) == 50
    # All kept entities should be the high-density ones
    for e in kept:
        sd = (e.attributes or {}).get("signal_density", 0.5)
        assert sd >= 0.5
