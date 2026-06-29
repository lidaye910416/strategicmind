# Goal G9 — 5-step wizard UI + agent interview IPC

> Status: PENDING · Owner: claude (autonomous) · Depends on: G6, G7, G8 · Blocks: —

## What this goal proves

A user reaches `/process/<run_id>` and walks a 5-step wizard that mirrors MiroFish
(GraphBuild → EnvSetup → Simulation → Report → Interaction). After the simulation,
Step 5 lets them chat with any agent via SSE-streamed replies. Conversation
transcripts persist as JSONL.

## Frontend — wizard

### Route + nav
- `frontend/src/router/index.tsx` — add `/process/:runId` → new `views/Process.tsx`.
- `views/Process.tsx` is the wizard orchestrator. Reads `?step=N` (default 1) and pushes back via `setSearchParams({ step: '...' })`. Keeps current `Workbench` view intact at `/workbench`.

### Wizard primitives
- `frontend/src/components/wizard/WizardShell.tsx` — frame + content area + top progress + step rail.
- `frontend/src/components/wizard/StepHeader.tsx` — title, subtitle, status icon.
- `frontend/src/components/wizard/StepNav.tsx` — Prev / Next / Re-run buttons with disabled-state logic per step.

### Step components (each ~thin wrapper adapting Workbench pieces)
- `frontend/src/components/wizard/Step1GraphBuild.tsx` — seed upload + KG build progress; reads `useStatus` + `useGraphProgress` from the existing pipeline store via the same atomic hooks (works because G8 sliced the store).
- `frontend/src/components/wizard/Step2EnvSetup.tsx` — entity extraction + profile generation + config; reads `useSnapshot`.
- `frontend/src/components/wizard/Step3Simulation.tsx` — round scrubber + graph + radar + belief shifts; the heavy lifting view.
- `frontend/src/components/wizard/Step4Report.tsx` — markdown report reader + chat-with-report.
- `frontend/src/components/wizard/Step5Interaction.tsx` — agent sidebar + chat panel + transcript history. Polls transcript JSONL every 2s (parity with MiroFish's polling cadence).

### Styling
- Use existing `framer-motion` + Tailwind palette. No new deps.

## Backend — interview IPC

### New blueprint
- `backend/app/api/interview.py` with:
  - `POST /api/interview/<run_id>/agents/<agent_id>/message` — body `{question, round_ref?}` → response `{role, agent_id, content, timestamp, metadata}`. Reuses `AgentInterviewService` (no rewrite). Persists to `backend/data/interviews/<run_id>_<agent_id>.jsonl`.
  - `GET /api/interview/<run_id>/trace?agent_id=<id>` — returns the per-agent transcript JSONL as a JSON array.
  - `GET /api/interview/<run_id>/trace?kind=round` — returns the per-round trace from the loop engine JSONL.
  - `GET /api/interview/<run_id>/events` — SSE channel. Emits `interview_token` (chunked LLM reply), `interview_done` (final), `round_appended` (when the loop JSONL gets a new line).
  - `?kind=round` takes precedence over `agent_id`; missing both returns `400 {error: 'agent_id or kind required'}`.
- `metadata` schema: `{question: str, round_ref?: int, model: str, latency_ms: int}`.

### Loop JSONL writer
- `backend/services/loop/engine.py:227` — append a JSONL line to `backend/data/interviews/<run_id>.jsonl` AFTER the existing `_emit_event("round_completed", payload)` call. Record shape: `{round, events: [...]}`.
- `STRATEGICMIND_TRACE_DISABLE=1` env turns the writer off (testing only); default ON.

### Registration
- Wire `interview_bp` into `backend/app/__init__.py:create_app()`.
- Wire `/process/:runId` into `frontend/src/router/index.tsx`.

## Files

| Path | Action |
|---|---|
| `frontend/src/router/index.tsx` | modify |
| `frontend/src/views/Process.tsx` | create |
| `frontend/src/components/wizard/WizardShell.tsx` | create |
| `frontend/src/components/wizard/StepHeader.tsx` | create |
| `frontend/src/components/wizard/StepNav.tsx` | create |
| `frontend/src/components/wizard/Step1GraphBuild.tsx` | create |
| `frontend/src/components/wizard/Step2EnvSetup.tsx` | create |
| `frontend/src/components/wizard/Step3Simulation.tsx` | create |
| `frontend/src/components/wizard/Step4Report.tsx` | create |
| `frontend/src/components/wizard/Step5Interaction.tsx` | create |
| `frontend/src/components/wizard/__tests__/Process.router.test.tsx` | create |
| `backend/app/api/interview.py` | create |
| `backend/app/__init__.py` | modify (register blueprint) |
| `backend/services/loop/engine.py` | modify (JSONL append at line 227) |
| `backend/tests/integration/test_interview_ipc.py` | create |

## Verification

```bash
# Backend tests
cd /Users/jasonlee/strategicmind
python3 -m pytest backend/tests/integration/test_interview_ipc.py -v
python3 -m pytest backend/tests/unit/ -k "loop or jsonl"

# Frontend route + wizard render test
cd frontend
npx vitest run src/components/wizard/__tests__/Process.router.test.tsx

# End-to-end manual:
# 1. Open http://localhost:5334/process/<a-real-run-id>?step=3
# 2. Step 3 shows the simulation in flight
# 3. Reach step 5, ask an agent a question; reply arrives via SSE within 30s
# 4. Transcripts are written under backend/data/interviews/
# 5. Reload page — old transcripts still loadable
```

## Acceptance

- [ ] `/process/<id>?step=N` renders each of the 5 steps; deep links work after refresh.
- [ ] Round JSONL writer produces `<run_id>.jsonl` with one line per `round_completed` event.
- [ ] `POST /api/interview/<id>/agents/<agent_id>/message` returns 200 with `{role: 'agent', content: non-empty}`.
- [ ] SSE `/events` emits `interview_token` / `interview_done` events within 30s on real `ollama`.
- [ ] `?kind=round` takes precedence over `agent_id`; missing both → 400.
- [ ] Transcripts survive a page reload.

## Stop conditions

- MiroFish-style dual-platform (Twitter + Reddit) parallel sim asked for — STOP and confirm scope.
- SSE replays the loop buffer and clobbers transcript JSONL — STOP and isolate the writer.
