# Goal G6 — Fix the 3 showstopper console bugs

> Status: PENDING · Owner: claude (autonomous) · Depends on: — · Blocks: G7, G8, G9

## What this goal proves

A user can run a strategic simulation in the browser with **zero console errors**.
All 3 known bugs (hook order, mystery 404, Zustand deprecation) are fixed and protected by
regression tests.

## Concrete changes

### Bug (a) — RoundTimeline.tsx hooks violation
- **File:** `frontend/src/components/RoundTimeline.tsx`
- **Defect:** Lines 109, 115, 131, 140 contain 4 `useMemo` blocks sitting BELOW the `if (!data) return ...` early-return at line 94. The `useEffect` at line 82 is already above the early-return, so the violation is the 4 `useMemo`s.
- **Fix:** Lift the 4 `useMemo`s ABOVE the early-return; when data is null return `[]`/`null`. The early-return moves to the very end of the component body.
- **Reference:** `docs/superpowers/specs/2026-06-29-mirofish-uplift-design.md` §4

### Bug (b) — Mystery 404
- **Likely source:** `GET /api/simulation/<run_id>` — referenced by `frontend/src/views/Simulation.tsx:57` but the backend only has `/api/simulation/<id>/stakeholders`, `/clusters`, `/rounds`, `/beliefs` (no plain `/<id>`).
- **Fix path 1 (preferred):** Add `GET /api/simulation/<run_id>` returning `{status, run_id, current_round, sim_status, current_round_idx}` in `backend/app/api/simulation.py`.
- **Fallback only if DevTools proves otherwise:** add thin routes for `/api/pipeline/<id>/logs` and `/realtime` in `backend/app/api/pipeline.py`.
- **Action:** When implementing, start by `curl -v http://localhost:8765/api/simulation/<a-real-run-id>` to confirm the 404 path empirically before adding code.

### Bug (c) — Zustand deprecation
- **File:** `frontend/src/store/pipeline.ts:18, :577`
- **Fix:** `import { create } from 'zustand'` → `import { createWithEqualityFn } from 'zustand/traditional'`; wrap the store creator at line 577.
- **Selector sweep:** audit each `usePipelineStore((s) => …)` callsite. Pass `shallow` as the second arg ONLY for selectors returning objects/arrays (`useSimRounds`, `useGraphNodes`, `useGraphEdges`, `useGraphProgress`, `useMarketEvents`, `useRecentShocks`, `useNetworkFrames`, `useReportRisks`). Scalar selectors (`useRunId`, `useStatus`, `useCurrentStage`) stay single-arg.

## Files

| Path | Action |
|---|---|
| `frontend/src/components/RoundTimeline.tsx` | modify (lift useMemos) |
| `frontend/src/store/pipeline.ts` | modify (createWithEqualityFn + shallow sweep) |
| `backend/app/api/simulation.py` | modify (add GET /api/simulation/<id>) |
| `frontend/src/components/__tests__/RoundTimeline.hookOrder.test.tsx` | create |
| `frontend/src/store/__tests__/pipeline.shallow.test.ts` | create |

## Verification

```bash
# 1. Hook order fix
cd frontend && npx vitest run src/components/__tests__/RoundTimeline.hookOrder.test.tsx -t "renders same hooks"
# 2. Zustand shallow fix
npx vitest run src/store/__tests__/pipeline.shallow.test.ts
# 3. 404 fix
# Boot backend (:8765) and frontend (:5334). Open browser, navigate to
# /simulator/<any-run-id>. DevTools → Network → filter status:404 → must be empty.
# 4. Manual: start a simulation end-to-end; copy any console error to clipboard — must be empty.
```

## Acceptance

- [ ] Browser console shows 0 "Rendered more hooks" errors during Workbench mount + Simulation start.
- [ ] Browser console shows 0 `[DEPRECATED] Use createWithEqualityFn` warnings during Workbench mount.
- [ ] Browser DevTools Network tab shows 0 requests with status 404 during a full sim run.
- [ ] `curl http://localhost:8765/api/simulation/<real_run_id>` returns 200 with `{status, run_id, current_round, sim_status, current_round_idx}` keys.
- [ ] All 3 new vitest tests pass. Existing `frontend/src/{store,lib,services}/__tests__/` shows no regressions.

## Stop conditions (when to pause and report)

- `frontend/src/store/pipeline.ts` has more than 1 line of import structural change beyond the swap — STOP and flag.
- Adding `/logs` or `/realtime` route triggers a CORS or auth concern beyond a 5-line handler — STOP.
