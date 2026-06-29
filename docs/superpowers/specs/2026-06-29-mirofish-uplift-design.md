---
status: DRAFT (awaiting user approval)
date: 2026-06-29
supersedes: docs/superpowers/specs/2026-06-25-p5-implementation-summary.md (if exists)
goals: G6, G7, G8, G9
related_decisions: docs/decisions/ADR-001..ADR-007 (any relevant)
---

# StrategicMind ↔ MiroFish Uplift — v2 Design (G6–G9)

## 1. Executive summary

StrategicMind's current Workbench is a 7-stage backend pipeline driving 22+ drilled props and 5 ad-hoc UI regions. MiroFish — a reference social-simulation frontend — ships a 5-step wizard (GraphBuild → EnvSetup → Simulation → Report → Interaction) with a post-simulation agent-interview IPC over a per-round JSONL trace. This spec uplifts StrategicMind to that UX without re-platforming the simulator: the v2 LoopEngine, its 12 BusinessActionType, 6-slice WorldState, and AgentScheduler are kept verbatim. Four goals land the change: **G6** kills 3 showstopper console bugs (hook order, 404, zustand equality); **G7** swaps the in-memory KG for a deterministic nano-graphRAG adapter so the profile stage is retrieval-grounded; **G8** decomposes Workbench into a slice-based zustand store with atomic-selector tab panels; **G9** ships the 5-step wizard at `/process/:runId` plus the interview IPC (`/api/interview/<run_id>/...`) over a per-round JSONL written by LoopEngine. Out of scope: Zep Cloud, d3 port, multi-platform, Postgres/Neo4j.

## 2. Scope

**In:** showstopper bug fixes (G6), KG adapter swap (G7), zustand slice refactor + tab decomposition (G8), 5-step wizard + interview IPC + per-round JSONL (G9). **Out:** Zep, Neo4j/Postgres, d3 force-graph port, wall-clock 30-min/round pacing, multi-platform parallel sim, full MiroFish rewrite, OASIS internals.

## 3. Goals index

| # | Title | Status | Files | Est. effort |
|---|---|---|---:|---|
| G6 | Fix 3 showstopper console bugs (hook order, 404, zustand equality) | DRAFT | 6 | 0.5 day |
| G7 | nano-graphRAG KG adapter + deterministic retrieval | DRAFT | 5 | 3 days |
| G8 | Refactor Workbench to atomic-selector slices; kill prop-drilling | DRAFT | 21 | 4 days |
| G9 | 5-step wizard + post-simulation agent interview IPC | DRAFT | 20 | 5 days |

**Sequencing:** G6 → G8 → G9 (G7 parallelizable any time after G6). Total: ~12–13 days one engineer.

## 4. Goal G6 — Fix 3 showstopper console bugs

### 4.1 Rationale
Frontend shows "Rendered more hooks than during the previous render" in `RoundTimeline.tsx:94`, a mystery 404 on `/api/simulation/<id>` (called at `views/Simulation.tsx:57`), and re-render storms from bare `zustand create` at `store/pipeline.ts:577`. These block reliable Workbench/Simulation use and gate G7–G9.

### 4.2 Scope
**In:**
- (a) Lift `useMemo` at `RoundTimeline.tsx:109-112` and `useEffect` at line 82 above the `if (!data)` early return.
- (b) Pin the 404 by capturing the request in DevTools, then add the missing backend route OR rename the caller (one-line fix).
- (c) Swap `create` → `createWithEqualityFn` from `zustand/traditional` at `store/pipeline.ts:577`; add `shallow` to the 6 object/array-returning atomic selectors; keep scalar selectors single-arg.
- 2 vitest regression tests: `RoundTimeline.hookorder.test.tsx`, `pipeline.shallow.test.ts`.

**Out:** Workbench prop-drilling (G8), wizard (G9), selector return-shape changes, backend logic in `services/loop/engine.py`.

### 4.3 Files

| Path | Action | Intent |
|---|---|---|
| `frontend/src/components/RoundTimeline.tsx` | modify | Lift 4 useMemo + 1 useEffect above the `if (!data)` early return |
| `frontend/src/store/pipeline.ts` | modify | Swap `create` → `createWithEqualityFn` at line 577; add `shallow` to 6 array/object selectors |
| `backend/app/api/simulation.py` | modify | Add `GET /simulation/<run_id>` returning `{status, run_id, current_round, ...}` |
| `backend/app/api/pipeline.py` | modify | (Conditional) Add `/logs` + `/realtime` thin routes IF DevTools pin proves they're the 404 source |
| `frontend/src/components/__tests__/RoundTimeline.hookorder.test.tsx` | create | renderHook with null then non-null data; assert no "Rendered more hooks" |
| `frontend/src/store/__tests__/pipeline.shallow.test.ts` | create | Assert `useGraphNodes` does NOT re-render on unrelated `runId` mutation |

### 4.4 Acceptance criteria
1. Zero "Rendered more hooks" console errors with `simRounds=[]` then `[fixture]`.
2. Zero 404s in DevTools Network during Workbench + Simulation mount.
3. `curl http://localhost:8765/api/simulation/<id>` → 200 with `{status, run_id, current_round}`.
4. `grep createWithEqualityFn frontend/src/store/pipeline.ts` returns a hit.
5. Every object/array selector uses `usePipelineStore(..., shallow)`.
6. New vitest files pass; existing frontend suite has zero regressions.
7. Manual click-through of Dashboard/Workbench/Simulation shows live SSE updates still flow.

### 4.5 Tests
1. `renderHook` with `simRoundsRaw=[]` then push 1 SimRound → no exception matching `/Rendered more hooks/`.
2. Snapshot hook-order count across two renders → counts equal.
3. Mount `useGraphNodes` consumer, mutate `runId` → component does NOT re-render.
4. Mount `useStatus` consumer, mutate `graphNodes` → component re-renders.
5. `curl /api/simulation/<known>` → 200 + JSON with required keys.
6. Manual browser open → no 404 in Network tab.
7. `npm run typecheck && npm test` → both green.

## 5. Goal G7 — nano-graphRAG KG adapter + deterministic retrieval

### 5.1 Rationale
StrategicMind's KG is an in-memory dict built by the GRAPH_BUILDING stage and read by PROFILE_GENERATION via a static prompt. Without retrieval, profile rewrite quality is non-deterministic and the post-hoc interview in G9 has nothing to ground on. Zep Cloud is the ideal target but is out of scope (per the synthesis). A nano-graphRAG adapter (NetworkX + JSON store + deterministic BFS retrieval) gives the same retrieval contract with 1/100th the integration cost.

### 5.2 Scope
**In:**
- New package `backend/services/kg_engine/` with `graph_index.py` (`KGIndex` class — name does NOT collide with the PyPI `nano-graphrag` package). Methods: `add_entity`, `add_relation`, `neighbors`, `retrieval(query, k=5)` (BFS + lexical overlap), persisted to `backend/data/knowledge_graphs/<run_id>.json`.
- New adapter `backend/services/kg_engine/builder.py`: a thin wrapper that GRAPH_BUILDING calls instead of the in-memory dict; same `entity_id, neighbors` interface.
- PROFILE_GENERATION (currently in `backend/services/strategic_profile_generator.py`) gains an optional retrieval step gated by `STRATEGICMIND_PROFILE_RETRIEVAL=1`; prompt template adds a "retrieved context" block.
- A/B eval script `backend/scripts/eval_profile_retrieval.py` comparing prompt-only vs. retrieval-grounded on 5 fixture runs.
- Feature flag `STRATEGICMIND_PROFILE_RETRIEVAL=0` (default off); rollout via flag-flip.
- **Bootstrap dependency:** create `backend/requirements.txt` pinning `networkx>=3.0` (currently no requirements file or pyproject.toml exists in backend/).

**Out:** Zep, Neo4j, Postgres, ontology versioning, dynamic schema inference.

### 5.3 Architecture narrative
The KG interface contract is `(entity_id, neighbors(entity_id, depth=2), retrieval(query, k)) → list[KGEntity]`. Today's `LocalKnowledgeStore` (at `backend/services/local_knowledge_store.py`) returns neighbors from an in-memory dict; the swap is to `kg_engine.graph_index.KGIndex.neighbors` which queries a `networkx.Graph` persisted to JSON. The orchestrator's `GRAPH_BUILDING` stage (`services/pipeline_orchestrator.py`, NOT `services/orchestrator.py` which does not exist) calls `kg_index.add_entity()` for each extracted entity and `add_relation()` for each extracted edge; the JSON snapshot is the only state holder. PROFILE_GENERATION (`services/strategic_profile_generator.py`, NOT `strategic_config_generator.py`) reads the same `kg_index.retrieval(query, k)` API. Because the public contract is stable, `services/pipeline_orchestrator.py` and the 7 stage handlers are unchanged. The A/B script writes a small markdown report to `data/reports/eval_<ts>.md` so we can compare retrieval hit-rate and a 5-question sanity check before flag-flip.

### 5.4 Files
| Path | Action | Intent |
|---|---|---|
| `backend/services/kg_engine/__init__.py` | create | Package marker (namespace `kg_engine` to avoid PyPI `nano-graphrag` collision) |
| `backend/services/kg_engine/graph_index.py` | create | `KGIndex` class: NetworkX + JSON persistence + BFS retrieval |
| `backend/services/kg_engine/builder.py` | create | Adapter wrapping `KGIndex` with the same shape as `LocalKnowledgeStore`'s public API |
| `backend/services/strategic_profile_generator.py` | modify | Read `STRATEGICMIND_PROFILE_RETRIEVAL`; inject retrieved context into the profile prompt |
| `backend/scripts/eval_profile_retrieval.py` | create | A/B harness: prompt-only vs. retrieval-grounded on 5 fixture runs |
| `backend/services/kg_engine/tests/__init__.py` | create | Test package |
| `backend/services/kg_engine/tests/test_graph_index.py` | create | Unit: add/neighbors/retrieval/persistence roundtrip |
| `backend/requirements.txt` | create | Pin `networkx>=3.0` (required by `kg_engine`; does not exist yet) |

### 5.5 Interfaces
- `kg_engine.graph_index.KGIndex.add_entity(entity: KGEntity) -> None`
- `kg_engine.graph_index.KGIndex.add_relation(src_id, rel, dst_id) -> None`
- `kg_engine.graph_index.KGIndex.neighbors(entity_id, depth=2) -> list[KGEntity]`
- `kg_engine.graph_index.KGIndex.retrieval(query: str, k: int = 5) -> list[KGEntity]`
- `kg_engine.graph_index.KGIndex.persist(path) -> None` / `kg_engine.graph_index.KGIndex.load(path) -> KGIndex`
- Env: `STRATEGICMIND_PROFILE_RETRIEVAL=0|1` (default 0)
- PyPI import to AVOID: `from nano_graphrag import GraphRAG` — using that package would pull in openai/tiktoken/graspologic/nano-vectordb. Our `kg_engine` is in-house, not a wrapper around it.

### 5.6 Tests
1. `add_entity` → `neighbors` roundtrip on a 10-node fixture.
2. `retrieval("competitor pricing", k=3)` returns entities with highest lexical overlap.
3. `persist()` then `load()` → identical graph topology (assert `networkx.is_isomorphic`).
4. PROFILE_GENERATION with `STRATEGICMIND_PROFILE_RETRIEVAL=1` produces a non-empty `retrieved_context` block in the prompt (snapshot test).
5. A/B script runs 5 fixtures; asserts retrieved variant wins ≥ 3/5 sanity questions.
6. `STRATEGICMIND_PROFILE_RETRIEVAL=0` (default) → no retrieval call is made (assert via mock).

### 5.7 Risks
- **Retrieval quality may regress visibly vs. Zep dynamic-ontology.** Mitigation: keep prompt-only as the default; expose hit-rate and the A/B script; only flag-flip after A/B ≥ 3/5.
- **JSON persistence is single-writer.** Mitigation: write to a tmp file + `os.replace`; do not allow concurrent GRAPH_BUILDING for the same run_id.
- **BFS retrieval ignores edge weights.** Mitigation: document in the API; upgrade to weighted PageRank in a follow-up if quality is insufficient.

## 6. Goal G8 — Refactor Workbench to atomic-selector slices; kill prop-drilling

### 6.1 Rationale
`Workbench.tsx:413-438` drills 22+ props into `InnerWorkbenchContent`; `RoundTimeline.tsx:94` has an early-return between hooks (already fixed in G6 but G8 re-enforces); `store/pipeline.ts:577` uses bare `create` (fixed in G6) but the bigger issue is that the store is one monolithic `PipelineState` with 309 call sites selecting compound objects/arrays. G6/G9 both need this surface to be clean.

### 6.2 Scope
**In:**
- Swap `create` → `createWithEqualityFn` at `store/pipeline.ts:577`.
- Split `PipelineState` into 4 typed slices (`graphSlice`, `simSlice`, `configSlice`, `uiSlice`) co-located with their setters.
- Keep the exported `usePipelineStore` name as a thin composite re-export (zero call-site migration).
- Decompose `InnerWorkbenchContent` into 6 per-tab sub-components: `RealtimeTabPanel`, `DepartmentsTabPanel`, `DebateTabPanel`, `InterviewTabPanel`, `AnalysisTabPanel`, `TopicsTabPanel`.
- `Workbench.tsx` loses the 22-prop drill; keeps only `runId/status/stage` + company context + 4 handler closures.
- Lift `useMemo` above `RoundTimeline.tsx`'s early-return (re-enforces G6); wrap export in `React.memo` + named export `RoundTimelineMemo`.
- Audit all 309 `usePipelineStore` call sites; add `shallow` to every object/array selector (or replace with a dedicated atomic hook).
- Keep `WorkbenchStateProvider` (derive-level state) unchanged semantically; it now reads slice-resolved hooks.
- Add `WorkbenchTabContext` so the tab rail can switch panels without prop-drilling the tab id.

**Out:** Backend REST/SSE changes; 5-step wizard UI (G9); 404 fix (G6); zustand version bump or middleware; semantic renames inside the store.

### 6.3 Architecture narrative
Introduce a slices pattern inside the existing `store/pipeline.ts`. The single `usePipelineStore = create<PipelineState>(...)` at line 577 is replaced by `usePipelineStore = createWithEqualityFn<PipelineState>(sliceCreator, ...)` where `sliceCreator = (...a) => graphSlice(...a) & simSlice(...a) & configSlice(...a) & uiSlice(...a)`. Each slice owns its own fields: `graphSlice` (graphNodes/graphEdges/graphProgress + addGraphNode/setGraphProgress/evictNodes), `simSlice` (simRounds/marketEvents/recentShocks/yearAdvanced/roundStartedBanner + appendSimRound/pushMarketEvent), `configSlice` (lastRunConfig/uploads/isStarting/lastEventAt + startPipeline/pause/resume/cancel/advanceYear), `uiSlice` (runId/status/progress/error/snapshot/currentStage + setRunId/hydrateFromRunId/_openSSE/_handleSSE). Existing atomic hooks (useRunId, useStatus, useGraphNodes, useSimRounds, useNetworkFrames, useMarketEvents, useRecentShocks, useYearAdvanced, useReportRisks) are kept as zero-cost re-exports.

`InnerWorkbenchContent.tsx:73-80` decomposes into `components/Workbench/tabs/{Realtime,Departments,Debate,Interview,Analysis,Topics}TabPanel.tsx`. Each panel subscribes only to its own slice(s) via `usePipelineStore(..., shallow)`. The active-tab routing state (activeTab) lives in `WorkbenchTabContext` so the WorkbenchLayout can switch panels without re-rendering hidden ones. The 22-prop drill at `views/Workbench.tsx:413-438` is deleted; `Workbench.tsx` keeps only: `runId/status/stage`, `company/companyId`, `topicInput` setter, `simResult`, `simulating` flag, and 4 handler closures.

Canonical logic preserved verbatim: SEED_PARSING → SIMULATION_RUNNING orchestrator stages, EventBus event names, MAX_GRAPH_NODES=1000, `_sseRef` lifecycle, `hydrateFromRunId` active-flag, and `ROUND_FLASH_TTL=1500 / YEAR_FLASH_TTL=3000` in `WorkbenchStateProvider`. The slice boundaries are the only new mental model.

### 6.4 Files

| Path | Action | Intent |
|---|---|---|
| `frontend/src/store/pipeline.ts` | modify | Swap `create` → `createWithEqualityFn`; split into 4 slices; keep atomic hook exports |
| `frontend/src/store/slices/graphSlice.ts` | create | graphNodes/edges/progress + addGraphNode/evictNodes/setGraphProgress |
| `frontend/src/store/slices/simSlice.ts` | create | simRounds/marketEvents/recentShocks/yearAdvanced/banner + setters |
| `frontend/src/store/slices/configSlice.ts` | create | lastRunConfig/uploads/isStarting/lastEventAt + start/pause/resume/cancel/advance |
| `frontend/src/store/slices/uiSlice.ts` | create | runId/status/progress/error/snapshot/stage + setRunId/hydrateFromRunId/SSE |
| `frontend/src/components/Workbench/InnerWorkbenchContent.tsx` | modify | Shrink to tab-router shell |
| `frontend/src/components/Workbench/WorkbenchTabContext.tsx` | create | `{activeTab, setActiveTab}` context |
| `frontend/src/components/Workbench/tabs/RealtimeTabPanel.tsx` | create | graphSlice + simSlice consumer |
| `frontend/src/components/Workbench/tabs/DepartmentsTabPanel.tsx` | create | company-context consumer |
| `frontend/src/components/Workbench/tabs/DebateTabPanel.tsx` | create | simResult + local topicInput |
| `frontend/src/components/Workbench/tabs/InterviewTabPanel.tsx` | create | companyId consumer |
| `frontend/src/components/Workbench/tabs/AnalysisTabPanel.tsx` | create | simSlice + reportRisks + networkFrames |
| `frontend/src/components/Workbench/tabs/TopicsTabPanel.tsx` | create | simSlice for rounds |
| `frontend/src/components/RoundTimeline.tsx` | modify | Lift useMemo; React.memo; named export `RoundTimelineMemo` |
| `frontend/src/views/Workbench.tsx` | modify | Drop 22-prop drill; pass activeTab via context |
| `frontend/src/components/Workbench/index.ts` | modify | Re-export 6 TabPanels; rename duplicate `RoundTimeline` to `WorkbenchRoundTimeline` |
| `frontend/src/components/Workbench/WorkbenchStateProvider.tsx` | modify | Verify it still resolves under `createWithEqualityFn` |
| `frontend/src/store/__tests__/slices.test.ts` | create | Each slice's setters mutate only its own keys |
| `frontend/src/components/__tests__/RoundTimeline.hookOrder.test.tsx` | create | render twice; assert no warning + render count == 2 |
| `frontend/src/components/__tests__/InnerWorkbenchContent.sliceBoundary.test.tsx` | create | Mutate simSlice; assert only active tab re-renders |
| `frontend/src/store/__tests__/selectors.test.ts` | modify | Append: `usePipelineStore((s)=>s.simRounds, shallow)` returns same ref on unrelated state changes |

### 6.5 Interfaces
- `usePipelineStore<T>(selector, equality?)` — composite, same shape as today, shallow now honored.
- `createGraphSlice`, `createSimSlice`, `createConfigSlice`, `createUiSlice` — each `(set, get) => Slice`.
- `WorkbenchTabContext` — `{activeTab: TabId, setActiveTab}`.
- `RoundTimelineMemo` — `React.memo(({simulationId}) => JSX.Element)`.

### 6.6 Tests
1. Mount `RoundTimeline` with `useSimRounds=[]` then `[fixture]`; assert no "Rendered more hooks" + render count == 2.
2. Mount `InnerWorkbenchContent` with `activeTab='realtime'`; push one round; assert `RealtimeTabPanel` re-rendered +1, `AnalysisTabPanel`/`TopicsTabPanel` render count == 0.
3. `createGraphSlice` addGraphNode: graphNodes grows; graphEdges/simRounds/status keep `===` identity.
4. `createSimSlice` appendSimRound: simRounds changes; graphNodes/lastRunConfig/status keep `===`.
5. `createWithEqualityFn`: subscribe to `({runId, status}, shallow)`; mutate simSlice → NOT notified; mutate runId → notified once.
6. Regression: all `selectors.test.ts` + `pipeline.test.ts` + `realtime-graph.test.ts` stay green.
7. Visual smoke: load `/workbench`, start a run, switch tabs, no console warnings.
8. `npm run typecheck && npm run lint` pass; no new exhaustive-deps warnings.

### 6.7 Risks
- **309 call sites; bare-object selectors will silently stop re-rendering.** Mitigation: `grep -rn "usePipelineStore((s) =>" src` audit; add `shallow` or atomic hook; unit test that bare-object subscribers are NOT called on irrelevant updates.
- **Six new TabPanel files overlap with existing `components/Workbench/*` leaves.** Mitigation: TabPanels are thin orchestrators composing existing leaves; new files live under `components/Workbench/tabs/`.
- **`WorkbenchStateProvider` reads 4 atomic hooks that may re-render differently under `createWithEqualityFn`.** Mitigation: unit test that mutating each of runId/status/simRounds/yearAdvanced independently yields correct derived state and no thrash.
- **Merge conflict with G9.** Mitigation: G8 ships first as a pure mechanical refactor with zero behavior delta; G9 rebases.

### 6.8 Acceptance criteria
1. `RoundTimeline.tsx` has no early-return between hooks; loading with `simRounds=[]` then `[fixture]` produces zero "Rendered more hooks" errors and exactly 2 inner renders.
2. `store/pipeline.ts` uses `createWithEqualityFn` (verifiable by grep).
3. `InnerWorkbenchContent`'s exported Props is empty (or `dataTestId`-only).
4. 6 files exist at `components/Workbench/tabs/*.tsx`; each is a default-exported React component reading its own slice.
5. Subscribing to `({runId, status}, shallow)` does NOT re-render on unrelated simSlice field changes.
6. Mounting `InnerWorkbenchContent` with `activeTab='realtime'` + simRounds mutation re-renders RealtimeTabPanel once; does not mount AnalysisTabPanel/TopicsTabPanel.
7. All existing tests stay green; `npm run typecheck && npm run lint` pass.
8. External API contract unchanged: SSE event names, REST paths, atomic hook names are byte-for-byte identical.
9. `components/Workbench/index.ts` re-exports `WorkbenchRoundTimeline` (renamed) and the 6 TabPanels.
10. `WorkbenchStateProvider` still derives the same 9 states (idle/configuring/running/paused/round-complete/year-complete/completed/failed/cancelled).

## 7. Goal G9 — 5-step wizard UI + post-simulation agent interview IPC

### 7.1 Rationale
Closes the UX parity gap with MiroFish. The 7 backend stages collapse to 5 user-visible wizard steps, and Step 5 (Interaction) exposes a per-round JSONL-backed agent interview over a new IPC. Mirrors MiroFish's 2-second polling cadence and SSE-streamed agent reply.

### 7.2 Scope
**In:**
- New wizard view `views/Process.tsx` at `/process/:runId` with 5 steps driven by `?step=N`.
- New `components/wizard/{WizardShell,StepHeader,StepNav,Step1..Step5}.tsx`.
- New backend blueprint `backend/app/api/interview.py` with 4 routes (see §7.6).
- Per-round JSONL writer hooked into `LoopEngine.run()` AFTER the existing `_emit_event("round_completed", payload)` call at `services/loop/engine.py:227`; persisted to `backend/data/interviews/<run_id>.jsonl`.
- Conversation transcript at `backend/data/interviews/<run_id>_<agent_id>.jsonl`.
- Reuse `services/agent_interview.py:AgentInterviewService` (no rewrite).
- `Step5Interaction.tsx`: agent sidebar + chat panel + transcript history, polling every 2s.
- Route + blueprint registration in `frontend/src/router/index.tsx` and `backend/app/__init__.py:create_app`.

**Out:** Modifying Workbench behavior; replacing `agent_interview.py`; Zep/Neo4j/Postgres/sqlite; multi-platform; 30-min wall-clock pacing; d3 force-graph port; G6 console bug fixes.

### 7.3 Architecture narrative
**Frontend (React, no Vue port):** `views/Process.tsx` is registered at `/process/:runId` and reads `?step=N` from the URL search params. The current step is pushed back into the URL via `router.replace`, giving deep-linkable refresh-stable navigation. `Process.tsx` owns no business state; it composes 5 step components from `components/wizard/Step{1..5}*.tsx`. Each step is a thin adapter: it reads `run_id` from `useParams`, subscribes to existing `usePipelineStore` atomic selectors (round, status, graph nodes, agents, reportId), and renders a step-specific layout that wraps existing Workbench sub-components (`InnerWorkbenchContent`, `RoundTimeline`, `DepartmentGraph`, `ReportViewer`, `AgentInterview`). `WizardShell` + `StepHeader` + `StepNav` provide the step rail, progress chips, and Prev/Next buttons. The shell calls `usePipelineStore` selectors only (no prop drilling), so steps re-render independently. `Step5Interaction.tsx` does not import `AgentInterview.tsx` directly; it calls the new IPC client `services/interviewClient.ts` (a thin fetch wrapper). The chat panel streams replies via `EventSource` on `/api/interview/<run_id>/events`; transcript history comes from a 2s-polling `GET /api/interview/<run_id>/trace?agent_id=...` that reads the per-agent JSONL. Legacy routes `/workbench/:runId` and `/simulation/:runId` stay unchanged.

**Backend (Flask):** A new blueprint `backend/app/api/interview.py` is registered in `create_app` at `app.register_blueprint(interview_bp)`. Four routes: (1) `GET /api/interview/<run_id>/agents` — list built by `AgentInterviewService.list_interviewable_agents()` resolved from the orchestrator's snapshot (`artifacts.SIMULATION_RUNNING.company_state`). (2) `POST /api/interview/<run_id>/agents/<agent_id>/message` body `{question, round_ref?}` — calls `AgentInterviewService.ask()`; response is appended to `backend/data/interviews/<run_id>_<agent_id>.jsonl` and a live event is published via the in-process `_publish_event` bus shared with `pipeline.py`. (3) `GET /api/interview/<run_id>/trace?agent_id=&limit=` — tails the per-agent JSONL file and returns up to N most recent `InterviewMessage` dicts; `?kind=round` returns per-round records from `<run_id>.jsonl`. (4) `GET /api/interview/<run_id>/events` — SSE stream of `{type: 'interview_token' | 'interview_done' | 'round_appended', agent_id?, delta?, message?, round?}` with `retry: 3000`.

The per-round JSONL writer is added as a small adapter in `services/loop/engine.py` after each `round_completed` emit: open `backend/data/interviews/<run_id>.jsonl` in append mode, write `{round, ts, actions, beliefs, world_state_slice}` using `json.dumps`, flush every 10 rounds via an in-memory buffer. This is the same file `GET /api/interview/<run_id>/trace?kind=round` reads, so the report stage (R) and interview trace (I) share a single source of truth: **R = I**. All LLM calls go through the existing `services/llm_factory.py:describe_provider()` pipeline (ollama default, bailian, MiniMax-M3, mock).

### 7.4 5-step mapping table

| Wizard step | MiroFish step | Backend stages covered | UI composition |
|---|---|---|---|
| 1 GraphBuild | GraphBuild | SEED_PARSING, GRAPH_BUILDING | DocumentUploader + graph progress bar |
| 2 EnvSetup | EnvSetup | ENTITY_EXTRACTION, PROFILE_GENERATION, CONFIG_GENERATION | entity list, profile cards, config panel |
| 3 Simulation | Simulation | SIMULATION_RUNNING | round counter, RoundTimeline, belief shift, shocks |
| 4 Report | Report | REPORT_GENERATING | ReportViewer with reportId |
| 5 Interaction | Interaction | (post-simulation) | agent sidebar + chat panel + transcript history |

### 7.5 Files

| Path | Action | Intent |
|---|---|---|
| `frontend/src/views/Process.tsx` | create | Wizard orchestrator driven by `?step=N` |
| `frontend/src/components/wizard/WizardShell.tsx` | create | Step rail + progress chips + Prev/Next |
| `frontend/src/components/wizard/StepHeader.tsx` | create | Per-step title, subtitle, status pill |
| `frontend/src/components/wizard/StepNav.tsx` | create | Numbered step nav with deep-link click |
| `frontend/src/components/wizard/Step1GraphBuild.tsx` | create | Adapter for SEED_PARSING + GRAPH_BUILDING |
| `frontend/src/components/wizard/Step2EnvSetup.tsx` | create | Adapter for ENTITY_EXTRACTION + PROFILE_GENERATION + CONFIG_GENERATION |
| `frontend/src/components/wizard/Step3Simulation.tsx` | create | Adapter for SIMULATION_RUNNING |
| `frontend/src/components/wizard/Step4Report.tsx` | create | Adapter for REPORT_GENERATING |
| `frontend/src/components/wizard/Step5Interaction.tsx` | create | Agent sidebar + chat + transcript |
| `frontend/src/services/interviewClient.ts` | create | Thin fetch wrapper for the 4 IPC endpoints + EventSource |
| `frontend/src/router/index.tsx` | modify | Register lazy `/process/:runId` route |
| `frontend/src/store/pipeline.ts` | modify | Add `useInterviewAgents` atomic selector |
| `backend/app/api/interview.py` | create | New blueprint: agents, message, trace, SSE events |
| `backend/app/__init__.py` | modify | Register `interview_bp` in `create_app` |
| `backend/services/loop/engine.py` | modify | Append per-round JSONL after each `round_completed` |
| `backend/data/interviews/` | create | Storage dir |
| `frontend/src/components/wizard/__tests__/Process.test.tsx` | create | Step routing from `?step=2` |
| `frontend/src/components/wizard/__tests__/Step5Interaction.test.tsx` | create | Mock `interviewClient`; assert send/receive transcript render |
| `backend/app/api/__tests__/test_interview_api.py` | create | Flask `test_client` for 4 endpoints + JSONL append + SSE shape |

### 7.6 IPC blueprint table

| Method + path | Request | Response | Purpose |
|---|---|---|---|
| `GET /api/interview/<run_id>/agents` | — | `200 [{agent_id, name, agent_kind, agent_type, display_name_cn, description}]` \| `404 {error}` | List interviewable agents |
| `POST /api/interview/<run_id>/agents/<agent_id>/message` | `{question, round_ref?}` | `200 {role, agent_id, content, timestamp, metadata}` \| `404 {error}` | Ask a question, persist transcript, return reply |
| `GET /api/interview/<run_id>/trace` | `?agent_id=&limit=` or `?kind=round` | `200 [{role, agent_id, content, timestamp, metadata}]` or `200 [{round, ts, actions, beliefs, world_state_slice}]` | Tail per-agent transcript OR per-round trace |
| `GET /api/interview/<run_id>/events` | — | `text/event-stream` frames: `interview_token` / `interview_done` / `round_appended` | SSE stream of reply deltas, completion markers, round appends |

### 7.7 Tests
**Frontend:**
1. Render `Process.tsx` at `/process/abc?step=2` → Step2 mounts (data-testid='step-2'), Step1 absent.
2. Click Next on Step1 → URL becomes `?step=2` via `router.replace`; reload of URL re-mounts Step2.
3. `/process/abc?step=5` for unknown runId → sidebar shows empty state.
4. `Step5Interaction` send → POST to `/api/interview/abc/agents/dept_001/message` with `{question}`; on SSE `interview_done` the transcript row appears.
5. `Step5` polls `/api/interview/abc/trace?agent_id=dept_001` every 2s; new message visible within 2 ticks.
6. `?step=4` mounts Step4Report; renders ReportViewer with `reportId` from `artifacts.REPORT_GENERATING.reportId`.
7. Navigate `/workbench/abc` → `/process/abc` → no crash; no double EventSource.

**Backend:**
8. `app.test_client().get('/api/interview/unknown/agents')` → 404 `{error: 'Run not found'}`.
9. With seeded run, `GET /agents` returns ≥ 1 department + ≥ 1 competitor agent with `agent_kind` set.
10. `POST /agents/<dept_id>/message` with `question='Q'` → 200 `{role:'agent', content: non-empty}`; per-agent JSONL has 1 line with `metadata.question == 'Q'`.
11. `GET /trace?agent_id=<dept_id>&limit=10` returns the same line as JSON with ISO timestamps.
12. `GET /events` streams `200 text/event-stream` with `retry: 3000` preamble within 200ms.
13. Running LoopEngine for 2 rounds on a fresh run_id writes 2 lines to `<run_id>.jsonl`, each with `{round, ts, actions, beliefs, world_state_slice}`.
14. `interview_bp` registered in `create_app` (verified via `app.url_map`).
15. LLM provider is ollama in tests via `STRATEGICMIND_LLM_OVERRIDE=tests.mocks.MockProvider`.

### 7.8 Risks
- **Wizard and Workbench share the same `usePipelineStore`; rerouting could double-subscribe SSE.** Mitigation: lazy import; module-level singleton survives route changes; vitest asserts no duplicate EventSource via stubbed `sseClient`.
- **JSONL writer adds I/O on the hot path.** Mitigation: `os.open` with `O_APPEND`; flush every 10 rounds; `STRATEGICMIND_TRACE_DISABLE=1` to skip in tests; benchmark < 2ms p99 per round on local SSD.
- **SSE may buffer whole reply before sending if LLM is not streaming.** Mitigation: use `ILLMProvider.stream_chat()`; fallback to chunked single-frame emit with 200ms artificial delay; spinner after 1500ms no-token.
- **Per-agent transcript grows unbounded.** Mitigation: cap at 5000 lines (rotate to `<run_id>_<agent_id>.<seq>.jsonl`); `GET trace` returns last N=200 by default; prune command documented.
- **Step 4 may not have a `reportId` if run failed before REPORT_GENERATING.** Mitigation: Step 4 checks `reportId`; when missing and `status === 'failed'`, shows localized empty state with Back button; do not auto-advance to step 4 unless `status === 'done'` or `reportId` truthy.
- **G8 + G9 both rewrite `Workbench.tsx` and `InnerWorkbenchContent.tsx`.** Mitigation: G8 ships first as a pure mechanical change; G9 only adds `useInterviewAgents` to `pipeline.ts` and does not edit lines 1200-1284.

### 7.9 Acceptance criteria
1. `/process/<id>?step=1` shows 5-step rail with Step 1 highlighted + DocumentUploader; no console errors.
2. Next on Step 1 → `?step=2`; reload of URL still shows Step 2.
3. After SEED_PARSING + GRAPH_BUILDING finish, Step 1 status pill turns green; Next enabled.
4. After a full run, Step 5 lists ≥ 1 department + ≥ 1 competitor agent; sending a question returns a non-empty Chinese reply within 10s on ollama / 3s on bailian.
5. Second question appends a new line to `<run_id>_<agent_id>.jsonl` (verifiable via `wc -l`); chat panel shows both Q and A in order.
6. 2-round simulation produces `<run_id>.jsonl` with exactly 2 lines; `jq .round <file>` yields 1 and 2.
7. `GET /events` returns `text/event-stream`; emits ≥ 1 `interview_done` within 10s of a POST message.
8. `/workbench/:runId` and `/simulation/:runId` continue to work; switching back/forth does not crash and does not open duplicate SSE connections.
9. `STRATEGICMIND_TRACE_DISABLE=1` skips JSONL writes; tests use this flag.
10. `app.url_map` includes `/api/interview/<run_id>/{agents,agents/<agent_id>/message,trace,events}`; unknown run_ids return 404 (not 405).
11. `frontend/components/wizard/__tests__/` and `backend/app/api/test_interview_api.py` pass.

## 8. Cross-cutting

**SSE event compatibility:** the 7 internal stage names (SEED_PARSING → SIMULATION_RUNNING) and EventBus event names are preserved verbatim. G9 adds 3 new event types on the **interview** SSE channel only (`interview_token`, `interview_done`, `round_appended`); no new event types on the **pipeline** SSE channel. **Env vars:** new: `STRATEGICMIND_PROFILE_RETRIEVAL` (G7, default 0), `STRATEGICMIND_TRACE_DISABLE` (G9, default 0). Existing: `STRATEGICMIND_LLM_OVERRIDE` unchanged. **Feature flags:** G7 retrieval off by default; G9 JSONL writer off via `STRATEGICMIND_TRACE_DISABLE=1` in tests. **Seed doc:** none required (existing `uploads/*.txt` fixtures still apply). **Deployment:** single process; no new external services. **New dependencies (G7 only):** `networkx>=3.0`, currently **not pinned anywhere** — G7 must create `backend/requirements.txt` as part of its first PR. **Rollback:** G6/G8/G9 are mechanical frontend changes — revert the PR. G7 is gated by `STRATEGICMIND_PROFILE_RETRIEVAL=0`; flip off to roll back without redeploy.

## 9. Verification plan (human steps)

**G6:** Open frontend in browser; load Workbench; check DevTools Console for "Rendered more hooks" (must be zero). Check DevTools Network for 404s on `/api/simulation/*` (must be zero). `curl -sS http://localhost:8765/api/simulation/<id>` → 200. Run `npm test` → all green.

**G7:** With `STRATEGICMIND_PROFILE_RETRIEVAL=0`, start a run, verify PROFILE_GENERATION output is identical to baseline (snapshot test). With `=1`, verify the prompt includes a non-empty `retrieved_context` block. Run `python3 backend/scripts/eval_profile_retrieval.py` → markdown report; flip the flag only if the report shows ≥ 3/5 wins.

**G8:** Run `npm test` → all green. Load `/workbench`, start a run, switch between the 6 tabs. In React DevTools Profiler, mutate `useSimRounds` while on Realtime tab → only RealtimeTabPanel renders. `grep createWithEqualityFn frontend/src/store/pipeline.ts` → hit. `grep -rn "usePipelineStore(.*, shallow)" frontend/src` → ≥ 6 matches (the 6 object/array selectors).

**G9:** `curl http://localhost:8765/api/interview/<id>/agents` → 200 list. Open `/process/<id>?step=1`; click through to step 5; send a question; verify `<id>_<agent_id>.jsonl` grows (`wc -l`); verify chat panel shows Q+A. Reload `/process/<id>?step=3` → step 3 mounts. `STRATEGICMIND_TRACE_DISABLE=1 npm test` → all green.

**Cross-cutting:** Open both `/workbench/<id>` and `/process/<id>` in separate tabs; confirm no duplicate EventSource in DevTools Network; confirm live updates still flow on both. `git log --oneline` shows the 4 sequenced PRs (G6, G7, G8, G9) merged in that order.

## 10. Out of scope

- Zep Cloud adoption.
- Multi-platform parallel simulation (Twitter + Reddit).
- d3 force-graph port (StrategicMind keeps `components/graph/`).
- Postgres or Neo4j migration; the JSON store is the persistence target.
- Full MiroFish product rewrite — matching the 5-step UX and interview loop, not OASIS internals.
- Wall-clock round pacing (30 min/round) — StrategicMind keeps strategic-tick round semantics.
- Persist/immer middleware in zustand; version bump.
- Renaming SSE event names; renaming the 7 internal stage names; semantic renames inside `PipelineState`.

## 11. Open questions

1. **A/B threshold for G7 flag-flip:** is 3/5 wins on the 5-fixture sanity check sufficient, or do we require a larger sample (e.g., 20 fixtures)? *User input needed.*
2. **JSONL cap for G9:** is 5000 lines per agent enough, or should the cap be lower (e.g., 2000)? *User input needed.*
3. **`/workbench` deprecation:** once `/process` is the canonical UX, do we delete `/workbench` in a follow-up, or keep both indefinitely? *User input needed.*
4. **Step 4 gating:** should Step 4 auto-advance from Step 3 the moment `REPORT_GENERATING.done` fires, or wait for explicit user click? *User input needed.*
5. **Interview agent scope:** is the sidebar the full agent list (department + competitor + customer), or only a curated subset (e.g., only departments)? *User input needed.*
6. **JSONL writeback timing for the report stage:** does the report (R) consume the per-round JSONL directly, or does it continue to read the in-memory snapshot? *User input needed — affects whether the report stage needs refactoring.*
7. **WorkbenchStateProvider behavior under slice refactor:** the 9 states (idle/configuring/running/paused/round-complete/year-complete/completed/failed/cancelled) — any new states needed for the wizard? *User input needed.*
