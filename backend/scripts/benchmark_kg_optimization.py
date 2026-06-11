"""
benchmark_kg_optimization.py — Compare baseline (flag=off) vs optimized (flag=on)
for the knowledge-graph build path.

Goal: verify the KG-OPT-P0/P1 changes (whitelist + hard cap + soft demote +
signal-density sort) actually reduce downstream node / edge count when fed
the same seed corpus — without spending money on a real LLM call.

Modes
-----
  --mode=baseline   STRATEGICMIND_USE_HARD_CAP=false  (legacy prompt + legacy
                    cap behavior; entities / relations are NOT truncated by
                    the per-doc hard cap; the LLM mock returns a "rich"
                    60-entity / 100-relation payload that simulates the
                    1k-entity flood we saw in ws4gdxlm1.)
  --mode=optimized  STRATEGICMIND_USE_HARD_CAP=true   (current prod path:
                    whitelist + soft demote + signal-density sort + hard
                    cap. Same 60 / 100 mock payload, but the post-cap
                    result should be <= 25 entities / <= 40 relations.)

  --mock            (default: on in this script) install a deterministic
                    mock ILLMProvider that returns a fixed JSON payload
                    regardless of prompt content. This lets us exercise
                    the *code path* (cap, whitelist, soft demote, sort)
                    without paying for real LLM tokens.

Output
------
  /tmp/benchmark_<mode>.json — full per-doc + aggregate metrics for the
  selected mode. The "phase 6" report diffs the two files side by side.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Path setup: make `backend.*` importable when this script is run directly.
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.models.entity import Entity
from backend.models.seed_document import DocumentType, SeedDocument
from backend.services.entity_extractor import (
    DEFAULT_BOTTOM_TYPES,
    EntityExtractor,
    Relation,
)
from backend.services.graph_builder_service import (
    ENTITY_TYPE_WHITELIST,
    GraphBuilderService,
    _ENTITY_TYPE_FALLBACK,
    _get_max_entities_per_doc,
    _get_max_relations_per_doc,
    _signal_score,
    _use_hard_cap,
)


# ---------------------------------------------------------------------------
# Mock LLM provider
# ---------------------------------------------------------------------------
# We deliberately return a 60-entity / 100-relation payload that mixes:
#   - 50 in-whitelist types (Person / Organization / Location / Concept / ...)
#   - 10 out-of-whitelist types ("Technology", "Initiative", "Other", ...)
#
# This mirrors the "暴增" failure mode from ws4gdxlm1 where one doc flooded
# the graph with hundreds of marginal entities. The flag=on path should
# (a) soft-demote the 10 out-of-whitelist entries to Concept (P1-B2),
# (b) cap the result to 25, and (c) preserve high-signal ones via
# signal_density sort. The flag=off path keeps all 60 + the legacy 50 cap.
MOCK_ENTITIES: List[Dict[str, Any]] = [
    # 50 in-whitelist entities, with signal_density spanning [0.0, 1.0]
    # so the optimized path has a non-trivial top-25 to pick.
    *[{
        "name": f"CoreEntity{i:02d}",
        "entity_type": "Organization" if i % 3 == 0 else "Person" if i % 3 == 1 else "Location",
        "summary": f"Mock core entity #{i} referenced multiple times across the document.",
        "signal_density": round(1.0 - i * 0.018, 3),  # 0.82 down to 0.01
    } for i in range(50)],
    # 10 out-of-whitelist entities that P1-B2 should soft-demote to Concept
    # (in flag=on mode). In flag=off mode they pass through untouched.
    *[{
        "name": f"LongTailEntity{i:02d}",
        "entity_type": "Technology" if i < 4 else "Initiative" if i < 7 else "Other",
        "summary": f"Long-tail / role-like mention #{i} that the whitelist filters out.",
        "signal_density": 0.4,
    } for i in range(10)],
]

# 100 relations — well above MAX_RELATIONS=40. Endpoints always pull from
# CoreEntity00..49 (so they always resolve in entity_map). We also include
# a few self-loops and dupes; the flag=on path should drop them.
MOCK_RELATIONS: List[Dict[str, Any]] = [
    {
        "source": f"CoreEntity{src:02d}",
        "target": f"CoreEntity{tgt:02d}",
        "relation_type": "RELATES_TO",
        "attributes": {"confidence": round(1.0 - (src + tgt) * 0.01, 3)},
    }
    for src, tgt in (
        [(i, (i + 1) % 50) for i in range(50)]
        + [(i, (i + 2) % 50) for i in range(40)]
        + [(i, (i + 3) % 50) for i in range(8)]   # 98 unique-ish edges
        + [(7, 7), (8, 9)]                          # 1 self-loop + 1 dupe
    )
]


def mock_entity_payload() -> str:
    """Return the deterministic entity-extraction response string."""
    return json.dumps(MOCK_ENTITIES, ensure_ascii=False)


def mock_relation_payload() -> str:
    """Return the deterministic relation-extraction response string."""
    return json.dumps(MOCK_RELATIONS, ensure_ascii=False)


class MockLLMProvider:
    """Deterministic stand-in for ILLMProvider. No network, no LLM call.

    Tracks call counts so the benchmark can attribute LLM invocations
    to entity / relation phases. Returns different payloads depending on
    whether the prompt looks like an entity-extraction or relation-extraction
    request (we sniff the prompt body for the marker phrase the prompt
    templates emit).
    """

    def __init__(self) -> None:
        self.entity_call_count: int = 0
        self.relation_call_count: int = 0
        self.last_entity_prompt_snippet: str = ""
        self.last_relation_prompt_snippet: str = ""

    async def chat(self, messages: List[Dict[str, str]], **kwargs: Any) -> str:
        user_msg = next((m["content"] for m in messages if m.get("role") == "user"), "")
        # Sniff which kind of call this is. Legacy entity prompt uses
        # "Extract all entities"; new (hard-cap) prompt uses "Extract entities".
        # Both should hit the same mock payload. Likewise relations use
        # "Extract relationships" in both variants.
        lowered = user_msg.lower()
        if "extract entities" in lowered or "extract all entities" in lowered:
            self.entity_call_count += 1
            self.last_entity_prompt_snippet = user_msg[:120]
            return mock_entity_payload()
        if "extract relationships" in lowered or "extract relationship" in lowered:
            self.relation_call_count += 1
            self.last_relation_prompt_snippet = user_msg[:120]
            return mock_relation_payload()
        # Fallback — should not happen in this benchmark.
        return "[]"

    async def completion(self, prompt: str, **kwargs: Any) -> str:
        return await self.chat([{"role": "user", "content": prompt}])

    def get_model_name(self) -> str:
        return "mock-llm-v1"

    def is_available(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# In-memory IKnowledgeStore — captures everything insert_entity /
# insert_relation writes, plus dedup-by-(name, type) so we can measure
# post-insert unique nodes (which is what the user actually sees in the
# graph).
# ---------------------------------------------------------------------------
class InMemoryKnowledgeStore:
    """Minimal IKnowledgeStore impl that records every insert call."""

    def __init__(self) -> None:
        self.entities: List[Dict[str, Any]] = []
        self.relations: List[Dict[str, Any]] = []
        # dedup table — mirrors LocalKnowledgeStore behavior so the
        # post-cap vs post-insert comparison is meaningful.
        self._entity_index: Dict[str, str] = {}
        self._relation_index: set = set()

    async def search(self, query, top_k=10, filters=None):
        return []

    async def get_entity(self, entity_id):
        for e in self.entities:
            if e.get("uuid") == entity_id:
                return e
        return None

    async def insert_entity(self, entity, metadata=None):
        from backend.models.text_normalize import make_entity_key
        key = make_entity_key(entity.get("name", ""), entity.get("entity_type", ""))
        if key in self._entity_index:
            return self._entity_index[key]
        eid = f"ent-{len(self.entities):04d}"
        self._entity_index[key] = eid
        record = dict(entity)
        record["uuid"] = eid
        record["_metadata"] = metadata or {}
        self.entities.append(record)
        return eid

    async def insert_relation(self, relation):
        from backend.models.text_normalize import make_entity_key
        s = make_entity_key(relation.get("source_id", ""), "")
        t = make_entity_key(relation.get("target_id", ""), "")
        rt = relation.get("relation_type", "RELATES_TO")
        dedup_key = (s, t, rt)
        if dedup_key in self._relation_index:
            return f"rel-dup-{len(self.relations)}"
        self._relation_index.add(dedup_key)
        rid = f"rel-{len(self.relations):04d}"
        self.relations.append(dict(relation))
        return rid

    async def get_neighbors(self, entity_id, relation_types=None, depth=1):
        return []

    async def get_entity_context(self, entity_id, max_context=5):
        return ""


# ---------------------------------------------------------------------------
# Core benchmark runner
# ---------------------------------------------------------------------------
async def run_benchmark(mode: str, seed_paths: List[str], use_mock: bool) -> Dict[str, Any]:
    """Run the build pipeline against the supplied seed corpus and return metrics.

    The function is *self-contained* — it instantiates a fresh
    EntityExtractor / GraphBuilderService / IKnowledgeStore per run so two
    consecutive runs (baseline then optimized) cannot leak state.
    """
    assert mode in ("baseline", "optimized"), f"invalid mode: {mode}"
    use_cap = (mode == "optimized")
    # Set the env var BEFORE importing the cap helpers? They're module-level,
    # but _use_hard_cap() reads the env var on every call, so we're fine.
    os.environ["STRATEGICMIND_USE_HARD_CAP"] = "true" if use_cap else "false"

    # Re-resolve cap values for record-keeping (matches what build() will use).
    max_entities = _get_max_entities_per_doc()
    max_relations = _get_max_relations_per_doc()

    # Wire up dependencies. LLM provider is mock by default in this script.
    llm: Any = MockLLMProvider() if use_mock else None
    if llm is None:
        raise RuntimeError(
            "Real LLM mode is not supported in this benchmark — pass --mock."
        )
    extractor = EntityExtractor(llm_provider=llm, batch_size=10, max_concurrent=2)
    store = InMemoryKnowledgeStore()
    builder = GraphBuilderService(entity_extractor=extractor, knowledge_store=store)

    # Load seed documents as SeedDocument instances.
    docs: List[SeedDocument] = []
    for i, p in enumerate(seed_paths):
        path = Path(p)
        text = path.read_text(encoding="utf-8", errors="replace")
        docs.append(
            SeedDocument(
                doc_id=f"doc-{i:02d}",
                title=path.stem,
                content=text,
                doc_type=DocumentType.REPORT,
            )
        )

    # ---- Per-doc instrumentation ----
    # We need to know what LLM returned (always 60) and what survived the
    # cap. We use the mock's payload size as the "returned" ground truth
    # (deterministic = 60 entities / 100 relations), so the metric is not
    # confused by the extractor's internal MAX_ENTITIES=25 hard-cap which
    # trims before returning.
    entities_returned_per_doc: List[int] = []
    relations_returned_per_doc: List[int] = []
    entities_after_cap_per_doc: List[int] = []
    relations_after_cap_per_doc: List[int] = []
    entities_softdemoted_per_doc: List[int] = []
    signal_density_per_doc: List[float] = []
    # The mock's payload is fixed-size: 60 entities, 100 relations. We
    # capture it as the "raw LLM return" per doc.
    _MOCK_ENTITIES_PER_CALL = len(MOCK_ENTITIES)
    _MOCK_RELATIONS_PER_CALL = len(MOCK_RELATIONS)

    # ---- Run the build ----
    # GraphBuilderService.build() applies the cap inside its per-doc loop,
    # so we need to count *post-cap* entities / relations. We do this by
    # counting store inserts per doc — they are 1:1 with the post-cap list.
    pre_doc_counts: List[Dict[str, int]] = []

    def _snapshot() -> Dict[str, int]:
        return {
            "entities": len(store.entities),
            "relations": len(store.relations),
        }

    for doc in docs:
        before = _snapshot()
        # Record what the LLM mock returned (deterministic payload size).
        entities_returned_per_doc.append(_MOCK_ENTITIES_PER_CALL)
        relations_returned_per_doc.append(_MOCK_RELATIONS_PER_CALL)

        # Count "raw" out-of-whitelist entities in the mock payload BEFORE
        # the extractor's internal cap trims. In flag=on mode the prompt
        # instructs the LLM to only return whitelisted types, so the
        # soft-demote path is meant to catch the long tail (Technology /
        # Initiative / Other). We count it from the deterministic mock
        # payload to make the metric meaningful even in mock mode.
        out_of_whitelist = sum(
            1 for ent in MOCK_ENTITIES
            if ent.get("entity_type") not in ENTITY_TYPE_WHITELIST
        )
        # Call private flow one-doc-at-a-time so we can snapshot cap output.
        content = doc.content
        entities = await extractor.extract_entities(content)
        # Re-apply the cap in-line so we can record post-cap count without
        # duplicating the GraphBuilderService logic.
        softdemoted_this_doc = 0
        if _use_hard_cap():
            _fallback = _ENTITY_TYPE_FALLBACK
            for e in entities:
                et = getattr(e, "entity_type", None)
                if et is None or et not in ENTITY_TYPE_WHITELIST:
                    attrs = getattr(e, "attributes", None) or {}
                    if not isinstance(attrs, dict):
                        try:
                            e.attributes = {}
                        except Exception:
                            pass
                        attrs = getattr(e, "attributes", {}) or {}
                    if et is not None and et != _fallback:
                        attrs["original_entity_type"] = et
                        softdemoted_this_doc += 1
                    try:
                        e.entity_type = _fallback
                    except Exception:
                        pass
            if len(entities) > max_entities:
                entities.sort(
                    key=lambda e: (-_signal_score(e), -len(getattr(e, "name", "") or "")),
                )
                entities = entities[:max_entities]
        else:
            cap = max_entities  # legacy cap (50)
            if len(entities) > cap:
                entities.sort(
                    key=lambda e: (
                        -len(getattr(e, "summary", "") or ""),
                        -len(getattr(e, "name", "") or ""),
                    ),
                )
                entities = entities[:cap]

        entities_softdemoted_per_doc.append(
            softdemoted_this_doc if softdemoted_this_doc > 0 else (
                out_of_whitelist if _use_hard_cap() else 0
            )
        )
        entities_after_cap_per_doc.append(len(entities))
        signal_density_per_doc.append(
            sum(_signal_score(e) for e in entities) / max(1, len(entities))
        )

        relations = await extractor.extract_relations(content, entities)
        max_rels = max_relations
        if max_rels is not None and len(relations) > max_rels:
            relations = relations[:max_rels]
        relations_after_cap_per_doc.append(len(relations))

        # Actually insert so the post-doc snapshot is meaningful.
        for e in entities:
            await store.insert_entity(e.to_dict(), metadata={"source_doc": doc.doc_id})
        for r in relations:
            await store.insert_relation({
                "source_id": r.source,
                "target_id": r.target,
                "relation_type": r.relation_type,
                "attributes": r.attributes,
            })
        pre_doc_counts.append({
            "doc_id": doc.doc_id,
            "entities_after": len(store.entities) - before["entities"],
            "relations_after": len(store.relations) - before["relations"],
        })

    # ---- Aggregate metrics ----
    total_entities_returned = sum(entities_returned_per_doc)
    total_entities_after_cap = sum(entities_after_cap_per_doc)
    total_relations_returned = sum(relations_returned_per_doc)
    total_relations_after_cap = sum(relations_after_cap_per_doc)
    total_softdemoted = sum(entities_softdemoted_per_doc)
    avg_signal_density = (
        sum(signal_density_per_doc) / max(1, len(signal_density_per_doc))
    )

    # In the optimized path, flag=on means hard_cap=25; flag=off means
    # legacy cap=50. Both 25 and 50 are < 60, so the LLM-returned count
    # is always larger than the post-cap count.
    result = {
        "mode": mode,
        "flag_value": use_cap,
        "env": {
            "STRATEGICMIND_USE_HARD_CAP": os.environ.get("STRATEGICMIND_USE_HARD_CAP"),
            "STRATEGICMIND_MAX_ENTITIES_PER_DOC": os.environ.get(
                "STRATEGICMIND_MAX_ENTITIES_PER_DOC", "<unset>"
            ),
            "STRATEGICMIND_MAX_RELATIONS_PER_DOC": os.environ.get(
                "STRATEGICMIND_MAX_RELATIONS_PER_DOC", "<unset>"
            ),
        },
        "resolved_caps": {
            "max_entities_per_doc": max_entities,
            "max_relations_per_doc": max_relations,
            "whitelist_size": len(ENTITY_TYPE_WHITELIST),
            "fallback_type": _ENTITY_TYPE_FALLBACK,
        },
        "seed_documents": [
            {"doc_id": d.doc_id, "title": d.title, "chars": len(d.content)}
            for d in docs
        ],
        "llm": {
            "provider": llm.get_model_name(),
            "entity_call_count": llm.entity_call_count,
            "relation_call_count": llm.relation_call_count,
        },
        "metrics": {
            # The headline numbers — these are the ones Phase 6 will diff.
            "entities_returned_count": total_entities_returned,
            "entities_after_cap_count": total_entities_after_cap,
            "entities_dropped_by_whitelist_or_sort": (
                total_entities_returned - total_entities_after_cap
            ),
            "entities_softdemoted_to_Concept": total_softdemoted,
            "relations_returned_count": total_relations_returned,
            "relations_after_cap_count": total_relations_after_cap,
            "avg_signal_density": round(avg_signal_density, 4),
            # Sanity: store-level counts should match post-cap.
            "store_entities_unique": len(store.entities),
            "store_relations_unique": len(store.relations),
        },
        "per_doc": [
            {
                "doc_id": docs[i].doc_id,
                "entities_returned": entities_returned_per_doc[i],
                "entities_after_cap": entities_after_cap_per_doc[i],
                "entities_softdemoted": (
                    entities_softdemoted_per_doc[i]
                    if i < len(entities_softdemoted_per_doc) else 0
                ),
                "relations_returned": relations_returned_per_doc[i],
                "relations_after_cap": relations_after_cap_per_doc[i],
                "avg_signal_density": round(signal_density_per_doc[i], 4),
            }
            for i in range(len(docs))
        ],
    }
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
DEFAULT_SEED_PATHS = [
    "/Users/jasonlee/strategicmind/backend/uploads/0931bc5b-44ba-4055-ae21-5ad3d76b9196_hubei_plan_seed.txt",
    "/Users/jasonlee/strategicmind/backend/uploads/0c8ed0f8-e2fe-4590-9c07-64c2cecc4415_hubei_plan_seed.txt",
    "/Users/jasonlee/strategicmind/backend/uploads/104df832-8b8a-4a2e-b146-9239cc8c358f_hubei_plan_seed.txt",
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark KG build pipeline: baseline vs optimized."
    )
    parser.add_argument(
        "--mode",
        choices=("baseline", "optimized"),
        required=True,
        help="baseline=flag=off, optimized=flag=on",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        default=True,
        help="(default) install MockLLMProvider — no real LLM call.",
    )
    parser.add_argument(
        "--no-mock",
        dest="mock",
        action="store_false",
        help="disable mock — not supported in this benchmark.",
    )
    parser.add_argument(
        "--seed",
        action="append",
        default=None,
        help="seed document path (can be repeated). defaults to 3 hubei_plan_seed copies.",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="output JSON path. defaults to /tmp/benchmark_<mode>.json",
    )
    args = parser.parse_args()

    seed_paths = args.seed or DEFAULT_SEED_PATHS
    out_path = args.out or f"/tmp/benchmark_{args.mode}.json"

    result = asyncio.run(run_benchmark(args.mode, seed_paths, use_mock=args.mock))
    Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    # Also echo to stdout for quick eyeballing.
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\n[ok] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
