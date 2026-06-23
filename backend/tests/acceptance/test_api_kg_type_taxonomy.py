"""
Acceptance tests for STRATEGICMIND_KG_TYPE_TAXONOMY env override at
POST /api/graph/build_graph endpoint.

Endpoint contract under test (see backend/app/api/graph.py:50):
    POST /api/graph/build_graph
    body: {"doc_ids": [str, ...]}
    200: { "status": "success", ... counts ... }

KG-OPT-P2 [P2-5-taxonomy-extensible]: env-driven whitelist override.
The env vars under test:
    STRATEGICMIND_KG_TYPE_TAXONOMY (CSV): replaces the default 8-type
        whitelist (Person, Organization, Location, Event, Concept,
        Product, Policy, Coalition). Used for domain-specific corpora.
    STRATEGICMIND_KG_FALLBACK_TYPE (str): replaces the default fallback
        type ("Concept"). Demoted entities use this type.

These tests follow the same two-strategy pattern as
test_api_graph_build.py:
    1. Drive the service layer directly to inspect attributes /
       softdemote counters (which the HTTP layer does not expose).
    2. Hit the HTTP endpoint and assert on the documented shape (the
       endpoint requires a real LLM, so 200/500 are both tolerated; the
       load-bearing assertions live in the service layer).
"""

import sys
from pathlib import Path

import pytest

# Ensure backend/ is on sys.path so `import app` works
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Helpers (mirrors test_api_graph_build.py structure)
# ---------------------------------------------------------------------------

def _make_doc_files(tmp_path, n_docs: int = 1):
    """Write n_docs seed text files into tmp_path and return their doc_ids."""
    doc_ids = []
    for i in range(n_docs):
        doc_id = f"doc_{i:03d}"
        content = (
            f"Seed document {i}.\n"
            "Hubei Digital Industry Group is the central state-owned "
            "enterprise under SASAC. It operates the AI Middleware "
            "Platform, Government Cloud, Smart City solutions, and "
            "Digital Government business lines. Key people include the "
            "head of product, head of sales, head of technology, head "
            "of finance and head of strategic development. The company "
            "is regulated by the National Development and Reform "
            "Commission and the Hubei SASAC. Major regulations include "
            "the Data Security Law and the Cybersecurity Law.\n"
        ) * 4
        (tmp_path / f"{doc_id}_seed.txt").write_text(content, encoding="utf-8")
        doc_ids.append(doc_id)
    return doc_ids


def _build_client(tmp_path, monkeypatch):
    """
    Build a Flask test client with:
        - tmp_path as UPLOAD_FOLDER (via env)
        - STRATEGICMIND_USE_HARD_CAP=true (so whitelist filtering runs)
        - cap env values (25/40 hard)
        - All other KG-opt / taxonomy env vars reset to a known starting
          state so neighbouring tests cannot bleed in via process-global
          env.
    Returns (client, app, upload_folder).
    """
    upload_folder = str(tmp_path)
    monkeypatch.setenv("UPLOAD_FOLDER", upload_folder)
    # Reset all KG-opt / taxonomy flags before tests can flip them. Each
    # test that needs an override re-sets the specific var.
    for var in (
        "STRATEGICMIND_USE_HARD_CAP",
        "STRATEGICMIND_MAX_ENTITIES_PER_DOC",
        "STRATEGICMIND_MAX_RELATIONS_PER_DOC",
        "STRATEGICMIND_USE_NATURAL_KEY",
        "STRATEGICMIND_SHARED_RUN_ID",
        "STRATEGICMIND_KG_TYPE_TAXONOMY",
        "STRATEGICMIND_KG_FALLBACK_TYPE",
    ):
        monkeypatch.delenv(var, raising=False)

    # Hard-cap path: enables whitelist filtering + soft-demote. Tests
    # for the taxonomy override need this on to exercise the code path
    # that consults the whitelist.
    monkeypatch.setenv("STRATEGICMIND_USE_HARD_CAP", "true")
    monkeypatch.setenv("STRATEGICMIND_MAX_ENTITIES_PER_DOC", "25")
    monkeypatch.setenv("STRATEGICMIND_MAX_RELATIONS_PER_DOC", "40")

    from app import create_app
    app = create_app({"TESTING": True})
    return app.test_client(), app, upload_folder


# ---------------------------------------------------------------------------
# Service-layer fakes (Entity, Store, Extractor) — same shape as
# test_api_graph_build.py so the assertions compare like-for-like.
# ---------------------------------------------------------------------------

class _FakeEntity:
    """Minimal Entity-like object: name, summary, entity_type, attributes,
    uuid, to_dict(). GraphBuilderService mutates entity_type and
    attributes.__is_fallback during the soft-demote path."""

    def __init__(self, name, entity_type, summary="", attributes=None):
        self.name = name
        self.entity_type = entity_type
        self.summary = summary
        self.attributes = attributes or {}
        self.uuid = ""
        self.metadata = {}

    def to_dict(self):
        return {
            "uuid": self.uuid,
            "name": self.name,
            "entity_type": self.entity_type,
            "summary": self.summary,
            "attributes": self.attributes,
            "metadata": self.metadata,
        }


class _RecordingStore:
    """Minimal in-memory IKnowledgeStore — records insert_entity /
    insert_relation so we can inspect what the soft-demote path actually
    persisted."""

    def __init__(self):
        self.entities = []
        self.relations = []

    async def insert_entity(self, entity_dict, metadata=None):
        self.entities.append(entity_dict)
        return entity_dict.get("uuid") or f"uuid-{len(self.entities)}"

    async def insert_relation(self, relation_dict):
        self.relations.append(relation_dict)
        return f"rel-{len(self.relations)}"


class _FixedExtractor:
    """Returns a fixed list of entities/relations on every call. Used to
    deterministically feed the build pipeline from a mock LLM."""

    def __init__(self, entities, relations):
        self._entities = entities
        self._relations = relations

    async def extract_entities(self, content, ontology=None):
        return list(self._entities)

    async def extract_relations(self, content, entities, ontology=None):
        return list(self._relations)


@pytest.fixture
def graph_builder_module():
    """Lazy import so monkeypatch can flip env between tests."""
    from backend.services import graph_builder_service
    return graph_builder_module if False else graph_builder_service


@pytest.fixture
def kg_prompts_module():
    """Lazy import for the single source of truth for whitelist / fallback."""
    from backend.services import kg_prompts
    return kg_prompts


# ===========================================================================
# 1. test_taxonomy_env_override_whitelist
# ===========================================================================

def test_taxonomy_env_override_whitelist(
    tmp_path, monkeypatch, graph_builder_module, kg_prompts_module,
):
    """
    KG-OPT-P2 [P2-5-taxonomy-extensible]: When STRATEGICMIND_KG_TYPE_TAXONOMY
    is set to a custom CSV ("Foo,Bar"), it replaces the default 8-type
    whitelist. Entities with type in {"Foo", "Bar"} pass through; entities
    with non-whitelist types (e.g. "Baz") are soft-demoted to
    entity_type="Concept" (the default fallback) and tagged with
    attributes.__is_fallback=True.

    Mock LLM feed: two entities — one with entity_type="Foo" (passes) and
    one with entity_type="Baz" (demoted).
    """
    _client, _app, _upload = _build_client(tmp_path, monkeypatch)

    # Set the env override AFTER building the client (env is read on the
    # hot path; setting it here is sufficient to affect the next call).
    monkeypatch.setenv("STRATEGICMIND_KG_TYPE_TAXONOMY", "Foo,Bar")
    # Default fallback is "Concept"; the demoted entity should land there.
    monkeypatch.delenv("STRATEGICMIND_KG_FALLBACK_TYPE", raising=False)

    # Sanity check the kg_prompts hot-path resolver sees the override.
    wl = kg_prompts_module.get_whitelist()
    assert wl == frozenset({"Foo", "Bar"}), (
        f"get_whitelist() should reflect STRATEGICMIND_KG_TYPE_TAXONOMY=Foo,Bar, "
        f"got {wl}"
    )

    # Mock LLM: one entity passes the new whitelist, one doesn't.
    foo = _FakeEntity(
        name="FooEntity",
        entity_type="Foo",
        summary="alpha beta gamma delta epsilon",
        attributes={"signal_density": 0.8},
    )
    baz = _FakeEntity(
        name="BazEntity",
        entity_type="Baz",
        summary="alpha beta gamma delta epsilon",
        attributes={"signal_density": 0.8},
    )
    entities = [foo, baz]
    relations = [
        _FakeEntity(
            name="rel_0", entity_type="RELATED_TO", summary="",
            attributes={
                "source": "FooEntity",
                "target": "BazEntity",
                "relation_type": "RELATED_TO",
            },
        )
    ]
    for r in relations:
        r.source = r.attributes["source"]
        r.target = r.attributes["target"]
        r.relation_type = r.attributes["relation_type"]

    # Drive the service directly so we can inspect entity_type /
    # attributes after the soft-demote pass.
    service = graph_builder_module.GraphBuilderService(
        entity_extractor=_FixedExtractor(entities, relations),
        knowledge_store=_RecordingStore(),
    )
    import asyncio
    seed_docs = [
        __import__("backend.models.seed_document", fromlist=["SeedDocument"])
        .SeedDocument(
            doc_id="doc_0", title="doc_0.txt", content="x" * 200,
            doc_type=__import__(
                "backend.models.seed_document", fromlist=["DocumentType"]
            ).DocumentType.UNKNOWN,
        )
    ]
    result = asyncio.run(service.build(seed_docs))

    # Sanity: we inserted 2 entities (both pass the per-doc cap of 25).
    assert result["entities_created"] == 2

    # --- "Foo" passes the whitelist — its entity_type is preserved. ------
    assert foo.entity_type == "Foo", (
        f"Foo is in the custom whitelist — its entity_type must be "
        f"preserved, got {foo.entity_type!r}"
    )
    assert not foo.attributes.get("__is_fallback"), (
        "Foo passes the whitelist — __is_fallback must NOT be set, "
        f"got attributes={foo.attributes!r}"
    )

    # --- "Baz" is NOT in {"Foo","Bar"} — soft-demoted to "Concept". ------
    assert baz.entity_type == "Concept", (
        f"Baz is outside the custom whitelist — it must be soft-demoted "
        f"to entity_type='Concept' (default fallback), got "
        f"{baz.entity_type!r}"
    )
    assert baz.attributes.get("__is_fallback") is True, (
        f"Demoted entity must carry attributes.__is_fallback=True, "
        f"got attributes={baz.attributes!r}"
    )
    # Original type recorded for audit / re-tracing.
    assert baz.attributes.get("original_entity_type") == "Baz", (
        f"Demoted entity must record original_entity_type='Baz', "
        f"got {baz.attributes.get('original_entity_type')!r}"
    )

    # --- Service-layer softdemote counter reflects the single demote. ----
    assert service.get_softdemote_count() == 1, (
        f"expected exactly 1 soft-demote event (BazEntity only), "
        f"got {service.get_softdemote_count()}"
    )


# ===========================================================================
# 2. test_taxonomy_env_empty_falls_back
# ===========================================================================

def test_taxonomy_env_empty_falls_back(
    tmp_path, monkeypatch, graph_builder_module, kg_prompts_module,
):
    """
    KG-OPT-P2 [P2-5-taxonomy-extensible]: Setting STRATEGICMIND_KG_TYPE_TAXONOMY
    to the empty string ("") is treated as "use the default 8-type
    whitelist" — same behaviour as if the env var were not set at all.

    The default whitelist is:
        Person, Organization, Location, Event, Concept, Product, Policy, Coalition

    All 8 default types must pass through; non-default types must be
    soft-demoted to the default fallback ("Concept").
    """
    _client, _app, _upload = _build_client(tmp_path, monkeypatch)

    # Explicitly set the env to the empty string (not unset). This is the
    # load-bearing case: "" must NOT accidentally become {"Unknown"} or
    # similar; it must fall back to the 8-type default.
    monkeypatch.setenv("STRATEGICMIND_KG_TYPE_TAXONOMY", "")
    monkeypatch.delenv("STRATEGICMIND_KG_FALLBACK_TYPE", raising=False)

    # Sanity check the kg_prompts hot-path resolver interprets "" as
    # "use the default 8-type whitelist".
    wl = kg_prompts_module.get_whitelist()
    expected_default = frozenset({
        "Person", "Organization", "Location", "Event",
        "Concept", "Product", "Policy", "Coalition",
    })
    assert wl == expected_default, (
        f"Empty STRATEGICMIND_KG_TYPE_TAXONOMY must fall back to the "
        f"default 8-type whitelist, got {wl}"
    )

    # Mock LLM: one entity per default-whitelist type — all must pass.
    default_types = [
        "Person", "Organization", "Location", "Event",
        "Concept", "Product", "Policy", "Coalition",
    ]
    pass_entities = {
        t: _FakeEntity(
            name=f"Pass_{t}",
            entity_type=t,
            summary=f"default type entity alpha beta gamma delta {t}",
            attributes={"signal_density": 0.7},
        )
        for t in default_types
    }
    # Plus one tail entity that must be demoted.
    tail_entity = _FakeEntity(
        name="TailEntity",
        entity_type="TailType",
        summary="tail entity alpha beta gamma delta epsilon",
        attributes={"signal_density": 0.7},
    )
    entities = list(pass_entities.values()) + [tail_entity]
    relations = [
        _FakeEntity(
            name="rel_0", entity_type="RELATED_TO", summary="",
            attributes={
                "source": "Pass_Person",
                "target": "Pass_Organization",
                "relation_type": "RELATED_TO",
            },
        )
    ]
    for r in relations:
        r.source = r.attributes["source"]
        r.target = r.attributes["target"]
        r.relation_type = r.attributes["relation_type"]

    service = graph_builder_module.GraphBuilderService(
        entity_extractor=_FixedExtractor(entities, relations),
        knowledge_store=_RecordingStore(),
    )
    import asyncio
    seed_docs = [
        __import__("backend.models.seed_document", fromlist=["SeedDocument"])
        .SeedDocument(
            doc_id="doc_0", title="doc_0.txt", content="x" * 200,
            doc_type=__import__(
                "backend.models.seed_document", fromlist=["DocumentType"]
            ).DocumentType.UNKNOWN,
        )
    ]
    result = asyncio.run(service.build(seed_docs))

    # 8 default + 1 tail = 9 total; all under the cap of 25.
    assert result["entities_created"] == 9

    # --- All 8 default-type entities preserved. ---------------------------
    for t in default_types:
        e = pass_entities[t]
        assert e.entity_type == t, (
            f"Default-whitelist type {t!r} must be preserved when env is "
            f"empty; got entity_type={e.entity_type!r}"
        )
        assert not e.attributes.get("__is_fallback"), (
            f"Default-whitelist entity {t!r} must not be marked as "
            f"fallback; attributes={e.attributes!r}"
        )

    # --- The tail entity is demoted. --------------------------------------
    assert tail_entity.entity_type == "Concept", (
        f"TailType must be soft-demoted to 'Concept' under the default "
        f"whitelist, got {tail_entity.entity_type!r}"
    )
    assert tail_entity.attributes.get("__is_fallback") is True
    assert tail_entity.attributes.get("original_entity_type") == "TailType"

    # --- Exactly one demote event. ----------------------------------------
    assert service.get_softdemote_count() == 1


# ===========================================================================
# 3. test_taxonomy_3type_softdemotes_rest
# ===========================================================================

def test_taxonomy_3type_softdemotes_rest(
    tmp_path, monkeypatch, graph_builder_module, kg_prompts_module,
):
    """
    KG-OPT-P2 [P2-5-taxonomy-extensible]: A custom whitelist of 3 types
    ("Person,Organization,Location") means every other type — including
    the other 5 default types — must be soft-demoted to the fallback
    ("Concept") with __is_fallback=True.

    This validates the "extensible taxonomy" contract: the whitelist is
    NOT required to be a superset of the default 8; it can be an
    arbitrary subset (or superset) and the soft-demote path must respect
    it.
    """
    _client, _app, _upload = _build_client(tmp_path, monkeypatch)

    monkeypatch.setenv("STRATEGICMIND_KG_TYPE_TAXONOMY", "Person,Organization,Location")
    monkeypatch.delenv("STRATEGICMIND_KG_FALLBACK_TYPE", raising=False)

    # Sanity check the resolver.
    wl = kg_prompts_module.get_whitelist()
    assert wl == frozenset({"Person", "Organization", "Location"}), (
        f"expected 3-type whitelist, got {wl}"
    )

    # Build a payload mixing: 3 whitelist types (pass) + 5 other-default
    # types (must be demoted) + 1 explicit non-default type (demoted).
    in_types = [
        "Person", "Organization", "Location",          # whitelist
        "Event", "Concept", "Product", "Policy",      # default-but-not-in-3
        "Coalition",                                   # default-but-not-in-3
        "CustomTail",                                  # not in default at all
    ]
    # Keep direct references per type so we can assert after the
    # soft-demote path (which mutates entity.name with a "[fallback] "
    # prefix and would otherwise make name-based lookup unreliable).
    by_type = {
        t: _FakeEntity(
            name=f"E_{t}",
            entity_type=t,
            summary=f"mixed entity alpha beta gamma delta {t}",
            attributes={"signal_density": 0.7},
        )
        for t in in_types
    }
    entities = list(by_type.values())
    relations = [
        _FakeEntity(
            name="rel_0", entity_type="RELATED_TO", summary="",
            attributes={
                "source": "E_Person",
                "target": "E_Organization",
                "relation_type": "RELATED_TO",
            },
        )
    ]
    for r in relations:
        r.source = r.attributes["source"]
        r.target = r.attributes["target"]
        r.relation_type = r.attributes["relation_type"]

    service = graph_builder_module.GraphBuilderService(
        entity_extractor=_FixedExtractor(entities, relations),
        knowledge_store=_RecordingStore(),
    )
    import asyncio
    seed_docs = [
        __import__("backend.models.seed_document", fromlist=["SeedDocument"])
        .SeedDocument(
            doc_id="doc_0", title="doc_0.txt", content="x" * 200,
            doc_type=__import__(
                "backend.models.seed_document", fromlist=["DocumentType"]
            ).DocumentType.UNKNOWN,
        )
    ]
    result = asyncio.run(service.build(seed_docs))

    # 9 entities all under the cap of 25.
    assert result["entities_created"] == 9

    # --- The 3 whitelist types are preserved. ----------------------------
    for t in ("Person", "Organization", "Location"):
        e = by_type[t]
        assert e.entity_type == t, (
            f"{t!r} is in the 3-type whitelist — must be preserved, "
            f"got {e.entity_type!r}"
        )
        assert not e.attributes.get("__is_fallback"), (
            f"{t!r} must not be marked as fallback; "
            f"attributes={e.attributes!r}"
        )

    # --- The remaining 6 types are demoted to "Concept". ------------------
    # Note: when the original type equals the default fallback ("Concept"),
    # graph_builder_service deliberately does NOT record original_entity_type
    # (to avoid pollution), so we only assert it for the other 5 demoted
    # types. The Concept entity is still demoted (entity_type stays the
    # same, but __is_fallback is set and the softdemote counter ticks).
    demoted_types = {"Event", "Concept", "Product", "Policy", "Coalition", "CustomTail"}
    for t in demoted_types:
        e = by_type[t]
        assert e.entity_type == "Concept", (
            f"{t!r} is outside the 3-type whitelist — must be "
            f"soft-demoted to 'Concept', got {e.entity_type!r}"
        )
        assert e.attributes.get("__is_fallback") is True, (
            f"{t!r} must carry __is_fallback=True; "
            f"attributes={e.attributes!r}"
        )
        if t != "Concept":
            # When the original type equals the fallback target, the
            # service intentionally skips the original_entity_type field.
            assert e.attributes.get("original_entity_type") == t, (
                f"{t!r} must record original_entity_type; got "
                f"{e.attributes.get('original_entity_type')!r}"
            )

    # --- The softdemote counter is positive and equals the demote count. --
    softdemote_count = service.get_softdemote_count()
    assert softdemote_count > 0, (
        "softdemote_to_Concept counter must be > 0 when the 3-type "
        f"whitelist excludes other types, got {softdemote_count}"
    )
    assert softdemote_count == 6, (
        f"expected exactly 6 demote events (one per non-whitelist type), "
        f"got {softdemote_count}"
    )


# ===========================================================================
# 4. test_fallback_type_override
# ===========================================================================

def test_fallback_type_override(
    tmp_path, monkeypatch, graph_builder_module, kg_prompts_module,
):
    """
    KG-OPT-P2 [P2-5-taxonomy-extensible]: STRATEGICMIND_KG_FALLBACK_TYPE
    replaces the default fallback ("Concept"). Demoted entities must
    land in entity_type=<env value> instead of "Concept".

    Uses the default 8-type whitelist (no taxonomy override) and feeds a
    single non-whitelist entity — verifies that it gets demoted to
    entity_type="Misc" (the env override), with the appropriate
    __is_fallback / original_entity_type attributes.
    """
    _client, _app, _upload = _build_client(tmp_path, monkeypatch)

    # Default 8-type whitelist (do not set the taxonomy env var).
    monkeypatch.delenv("STRATEGICMIND_KG_TYPE_TAXONOMY", raising=False)
    # Override the fallback target to "Misc".
    monkeypatch.setenv("STRATEGICMIND_KG_FALLBACK_TYPE", "Misc")

    # Sanity check the kg_prompts resolver reflects the override.
    assert kg_prompts_module.get_fallback_type() == "Misc", (
        f"get_fallback_type() should reflect STRATEGICMIND_KG_FALLBACK_TYPE=Misc, "
        f"got {kg_prompts_module.get_fallback_type()!r}"
    )

    # Mock LLM: one entity outside the default 8-type whitelist.
    entity = _FakeEntity(
        name="TailEntity",
        entity_type="TailType",
        summary="tail entity alpha beta gamma delta epsilon",
        attributes={"signal_density": 0.7},
    )
    entities = [entity]
    relations = []  # no relations needed for this assertion

    service = graph_builder_module.GraphBuilderService(
        entity_extractor=_FixedExtractor(entities, relations),
        knowledge_store=_RecordingStore(),
    )
    import asyncio
    seed_docs = [
        __import__("backend.models.seed_document", fromlist=["SeedDocument"])
        .SeedDocument(
            doc_id="doc_0", title="doc_0.txt", content="x" * 200,
            doc_type=__import__(
                "backend.models.seed_document", fromlist=["DocumentType"]
            ).DocumentType.UNKNOWN,
        )
    ]
    result = asyncio.run(service.build(seed_docs))

    # Sanity: the single entity was kept (under the cap).
    assert result["entities_created"] == 1

    # --- Demoted entity uses "Misc" as its new entity_type. ---------------
    e = entities[0]
    assert e.entity_type == "Misc", (
        f"Demoted entity must use STRATEGICMIND_KG_FALLBACK_TYPE='Misc' "
        f"as its new entity_type, got {e.entity_type!r}"
    )
    assert e.attributes.get("__is_fallback") is True, (
        f"Demoted entity must carry __is_fallback=True; "
        f"attributes={e.attributes!r}"
    )
    assert e.attributes.get("original_entity_type") == "TailType", (
        f"Demoted entity must record original_entity_type='TailType'; "
        f"got {e.attributes.get('original_entity_type')!r}"
    )
    # --- And the softdemote counter incremented. --------------------------
    assert service.get_softdemote_count() == 1, (
        f"expected exactly 1 soft-demote event, got "
        f"{service.get_softdemote_count()}"
    )

    # --- And a control: a whitelist entity stays as its original type. ---
    wl_entity = _FakeEntity(
        name="WhitelistEntity",
        entity_type="Person",  # in the default 8-type whitelist
        summary="whitelist entity alpha beta gamma delta epsilon",
        attributes={"signal_density": 0.7},
    )
    store = _RecordingStore()
    service2 = graph_builder_module.GraphBuilderService(
        entity_extractor=_FixedExtractor([wl_entity], []),
        knowledge_store=store,
    )
    asyncio.run(service2.build(seed_docs))
    assert wl_entity.entity_type == "Person", (
        f"Whitelist entity must keep entity_type='Person'; got "
        f"{wl_entity.entity_type!r}"
    )
    assert not wl_entity.attributes.get("__is_fallback"), (
        f"Whitelist entity must not be marked as fallback; "
        f"attributes={wl_entity.attributes!r}"
    )
    assert service2.get_softdemote_count() == 0
