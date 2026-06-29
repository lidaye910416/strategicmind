# Goal G8 — Workbench atomic-selector slices (kill prop-drilling, fix RoundTimeline)

> Status: PENDING · Owner: claude (autonomous) · Depends on: G6 · Blocks: G9

## What this goal proves

`views/Workbench.tsx` stops passing 22+ props through `InnerWorkbenchContent`. The
single `usePipelineStore` is decomposed into 4 typed slices, each tab panel reads
its own selectors directly, and `RoundTimeline` is `React.memo`-wrapped so it
re-renders only when its inputs change.

## Concrete changes

### Store refactor
- `frontend/src/store/pipeline.ts` — switch to `createWithEqualityFn` (also done in G6 — this goal enforces it). Then split `PipelineState` into 4 typed slices:
  - `graphSlice` — `graphNodes`, `graphEdges`, `graphProgress`, plus `addGraphNode`, `evictNodes`, `setGraphProgress`.
  - `simSlice` — `simRounds`, `marketEvents`, `recentShocks`, `yearAdvanced`, `roundStartedBanner`, plus `appendSimRound`, `pushMarketEvent`, `pushShock`, `appendRoundStartedBanner`.
  - `configSlice` — `lastRunConfig`, `uploads`, `isStarting`, `lastEventAt`, plus `startPipeline`, `pause`, `resume`, `cancel`, `advanceYear`.
  - `uiSlice` — `status`, `progress`, `error`, `snapshot`, `currentStage`, `runId`, plus `setRunId`, `hydrateFromRunId`, `_openSSE`.
- The exported `usePipelineStore` becomes a thin composite of the 4 creators — call-site compatible (same import path, same hooks signature).
- All atomic hook re-exports (`useRunId`, `useStatus`, `useSimRounds`, etc.) remain at the same names so call sites don't change.

### Slice files
- `frontend/src/store/slices/graphSlice.ts` (new)
- `frontend/src/store/slices/simSlice.ts` (new)
- `frontend/src/store/slices/configSlice.ts` (new)
- `frontend/src/store/slices/uiSlice.ts` (new)

### Component refactor
- `frontend/src/components/Workbench/InnerWorkbenchContent.tsx` — shrink to a tab-router shell only (active tab from a small `WorkbenchTabContext`).
- New tab panels (each subscribes to its own slice(s), no prop drill from Workbench):
  - `components/Workbench/tabs/RealtimeTabPanel.tsx`
  - `components/Workbench/tabs/DepartmentsTabPanel.tsx`
  - `components/Workbench/tabs/DebateTabPanel.tsx`
  - `components/Workbench/tabs/InterviewTabPanel.tsx`
  - `components/Workbench/tabs/AnalysisTabPanel.tsx`
  - `components/Workbench/tabs/TopicsTabPanel.tsx`

### RoundTimeline
- Lift the 4 `useMemo`s above the early-return (G6 deliverable). Then in this goal: convert the export to `React.memo`, rename to a named export `RoundTimelineMemo` to disambiguate from any nested `WorkbenchRoundTimeline`.
- Add a selector that returns only the props RoundTimeline actually consumes, so the parent tab panel re-renders RoundTimeline only when those inputs change.

### Selector hygiene
- Replace any `usePipelineStore((s) => ({...compound object...}))` call sites with calls that pass `shallow` OR a dedicated atomic hook.
- Keep `WorkbenchStateProvider` unchanged in its public API; under the hood it reads slice-resolved atomic hooks.

## Files

| Path | Action |
|---|---|
| `frontend/src/store/pipeline.ts` | modify (slice composition + createWithEqualityFn enforce) |
| `frontend/src/store/slices/graphSlice.ts` | create |
| `frontend/src/store/slices/simSlice.ts` | create |
| `frontend/src/store/slices/configSlice.ts` | create |
| `frontend/src/store/slices/uiSlice.ts` | create |
| `frontend/src/components/Workbench/InnerWorkbenchContent.tsx` | modify (shrink to shell) |
| `frontend/src/components/Workbench/tabs/*TabPanel.tsx` | create (6 files) |
| `frontend/src/components/Workbench/WorkbenchStateProvider.tsx` | modify (slice-aware) |
| `frontend/src/components/RoundTimeline.tsx` | modify (memo + named export) |
| `frontend/src/components/Workbench/__tests__/SliceBoundaryRender.test.tsx` | create (re-render boundary) |

## Verification

```bash
cd frontend
npx tsc --noEmit                              # types check
npx vitest run src/store/__tests__/pipeline.shallow.test.ts
npx vitest run src/components/Workbench/__tests__/SliceBoundaryRender.test.tsx

# Manual: open /workbench, mount a run, then in DevTools React Profiler
# confirm RoundTimeline does not re-render when an unrelated slice (e.g.
# yearAdvanced) updates.
```

## Acceptance

- [ ] `tsc --noEmit` passes with 0 new errors.
- [ ] `grep -rn 'usePipelineStore(.*, shallow)' frontend/src/store` returns ≥ 8 matches (the 6 object/array atomic hooks + any compound-selector callsites).
- [ ] No remaining bare-object `usePipelineStore((s) => ({ a: ..., b: ... }))` (grep audit = 0 matches).
- [ ] `InnerWorkbenchContent` `props` interface has ≤ 4 props (down from 22+).
- [ ] `SliceBoundaryRender.test.tsx` asserts inactive tab panels do not re-render when an unrelated slice mutates.
- [ ] All existing frontend tests still green.

## Stop conditions

- A slice boundary forces an unrelated behavior change (e.g. SSE subscribe order) — STOP and revert to a single-store refactor path.
- React Profiler shows `InnerWorkbenchContent` STILL re-rendering on every store update despite the slice split — STOP, the slice creators aren't memoized.
