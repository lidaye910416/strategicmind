# Goal G7 — Replace file-based JSON KG with in-house `kg_engine` (NetworkX)

> Status: PENDING · Owner: claude (autonomous) · Depends on: G6 · Blocks: G8, G9

## What this goal proves

StrategicMind's knowledge graph is queryable via deterministic BFS + lexical
retrieval, persisted to JSON, and gated behind a feature flag so the existing
prompt-only path remains the default until the new path passes an A/B check.

## Concrete changes

### New package `backend/services/kg_engine/`
- `__init__.py` (package marker)
- `graph_index.py` — `KGIndex` class
  - `add_entity(entity: dict) -> None`
  - `add_relation(src_id: str, rel: str, dst_id: str) -> None`
  - `neighbors(entity_id, depth=2) -> list[dict]`
  - `retrieval(query: str, k=5) -> list[dict]` (BFS over networkx.Graph + token-overlap scoring)
  - `persist(path) -> None` / `@classmethod load(path) -> KGIndex`
  - Persists to JSON (use `networkx.readwrite.json_graph.node_link_data`).
- `builder.py` — thin adapter that `GRAPH_BUILDING` calls instead of building an in-memory dict. The adapter wraps `KGIndex` with the public shape of `LocalKnowledgeStore` (the existing file) so call sites in the orchestrator don't change.

### Dependency bootstrap
- Create `backend/requirements.txt` (does not exist yet) pinning `networkx>=3.0`.

### Wire up
- `backend/services/strategic_profile_generator.py` — read `STRATEGICMIND_PROFILE_RETRIEVAL` env. When `=1`, call `kg_index.retrieval(query, k=5)` and inject results into the profile prompt as a "retrieved context" block.
- `STRATEGICMIND_PROFILE_RETRIEVAL=0` (default) → no retrieval call (verify via mock in the unit test).

### A/B harness
- `backend/scripts/eval_profile_retrieval.py` runs 5 fixture runs through both pipelines and writes a markdown report to `data/reports/eval_<ts>.md`. The script must be runnable with the project's `STRATEGICMIND_LLM_OVERRIDE` env to skip real LLM cost during eval.

### Tests
- `backend/services/kg_engine/tests/test_graph_index.py` covering: add/neighbors roundtrip, retrieval lexical scoring, persist/load isomorphism (`networkx.is_isomorphic`), A/B harness smoke test.
- Snapshot test confirming `STRATEGICMIND_PROFILE_RETRIEVAL=1` injects a non-empty context block; `=0` injects nothing.

## Files

| Path | Action |
|---|---|
| `backend/requirements.txt` | create (pin `networkx>=3.0`) |
| `backend/services/kg_engine/__init__.py` | create |
| `backend/services/kg_engine/graph_index.py` | create |
| `backend/services/kg_engine/builder.py` | create |
| `backend/services/kg_engine/tests/__init__.py` | create |
| `backend/services/kg_engine/tests/test_graph_index.py` | create |
| `backend/services/strategic_profile_generator.py` | modify (retrieval hook + flag) |
| `backend/scripts/eval_profile_retrieval.py` | create (A/B harness) |

## Verification

```bash
cd /Users/jasonlee/strategicmind
python3 -m pytest backend/services/kg_engine/tests/ -v
# A/B harness smoke test:
STRATEGICMIND_LLM_OVERRIDE=mocks.MockProvider python3 backend/scripts/eval_profile_retrieval.py --quick
# Verify default-off path:
STRATEGICMIND_PROFILE_RETRIEVAL=0 python3 -c "
import backend.services.kg_engine.builder as b
idx = b.build_from_dict({})
assert idx.retrieval is not None  # the API is wired but the orchestrator doesn't call it
print('OK default-off')
"
# Verify default-on retrieval injects context:
STRATEGICMIND_PROFILE_RETRIEVAL=1 STRATEGICMIND_LLM_OVERRIDE=mocks.MockProvider \
  python3 -m backend.services.strategic_profile_generator._test_retrieval_hook
```

## Acceptance

- [ ] `pip install -r backend/requirements.txt` succeeds; `networkx>=3.0` importable.
- [ ] `pytest backend/services/kg_engine/` passes (all green).
- [ ] `STRATEGICMIND_PROFILE_RETRIEVAL=0` (default) produces byte-identical profile output to the prior pipeline on a known seed (snapshot test).
- [ ] A/B harness writes a report file under `data/reports/` and finishes in <60s with `MockProvider`.
- [ ] `GraphBuilderService` no longer holds the in-memory dict it built directly; the dict is now an attachment to `KGIndex`.

## Stop conditions

- `local_knowledge_store.py` API has callers I haven't enumerated — STOP and grep first.
- `networkx` install conflicts with anything in the host Python (e.g. PyTorch ABI) — STOP.
- The retrieval snapshot test shows any non-trivial profile regression (>1 changed token per 1000) — flag and do NOT flip the default.
