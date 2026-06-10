# StrategicMind Loop-Engine v2 — Implementation Spec

> **Document version:** v1.0 · 2026-06-08
> **Status:** Ready for sign-off → `subagent-driven-development` dispatch
> **Owner:** Ralph (planning)
> **Synthesized from:** `LoopEngine` design + `RealtimeKG v2` design + `Workbench UI` design + 3 adversarial critiques (sim / ui / graph)

---

## 0. TL;DR

StrategicMind runs temporal multi-round simulation with continuous-time semantics, but four structural problems make the output feel **mediocre** rather than emergent:

1. **17 action types share one belief-delta function** — the LLM's choice of action type is decorative.
2. **No writeback** from the simulation loop to the knowledge store — the report has nothing to quote, falls back to hallucination.
3. **No temporal mechanics** — no `time_of_day`, `activity_level`, or `active_hours` — so rounds are a metronome.
4. **The clock is broken** — `SimClock.advance()` doesn't actually advance; it returns a constant `simulated_hour` per round.
5. **The pipeline is uniform** — all 7 stages take `1/7` of the progress bar; simulation is not visually privileged.

This spec implements **31 tasks** across 5 phases (Phase 0–4) that fix all five problems and ship a Workbench UI + Cosmic Observatory graph that surfaces the loop as the centerpiece.

**Effort:** ~4L + 13M + 12S (≈ 4–6 weeks one engineer, or 2–3 weeks with two engineers in parallel).
**Acceptance gates:** 8 (enumerated in §5) — every gate must pass before flag-flip.
**No-go list:** 8 items (enumerated in §6) — explicit scope cuts.

---

## 1. Why this exists — the 5 root causes of "mediocre emergence"

The audit (`result.audit.pipeline`) compared StrategicMind against the social-simulation baseline across 11 patterns and scored **3 of 11 complete, 2 partial, 6 missing**. Five structural causes compound:

### 1.1 Decorative action types (CRITICAL — biggest contributor)

**File:** `backend/services/simulation_loop.py:380-412`

```python
# Current behavior — every ActionType writes 0.5 to the same belief slot
def _update_beliefs(self, agent, action, all_agents):
    for topic in agent.beliefs.keys():
        belief_engine.update_belief(
            agent, topic, new_value=0.5   # ← constant, regardless of action_type
        )
```

All 17 `ActionType` enum values pass through the **same constant-delta function**. A `FORM_COALITION` and a `MAKE_STATEMENT` and a `CONCEALED_TRADE` produce **byte-identical downstream effects**. The LLM is wasting output tokens choosing action types that have no effect.

**Impact:** 30 agents × 12 rounds = 360 LLM calls whose `action_type` field is decorative. No narrative distinction can emerge because the simulation cannot distinguish "coalition formed" from "statement made".

### 1.2 No knowledge-store writeback (HIGH)

**File:** `grep -n "knowledge_store" backend/services/simulation_loop.py` → **0 hits**.

The `LocalKnowledgeStore` is built once in stage 2 (`pipeline_orchestrator.py:551-554, 596`) and only consulted by `ReportAgent`'s `SearchTool`. So when the report LLM calls `search_tool.execute("strategic decision business impact")`, it retrieves the **seed document's entity graph** — not the simulation's emergent content.

**Impact:** The report references "Document says X" instead of "Agent 张三 in Round 4 said: '我们要推动部门重组以应对新竞争者'." No verbatim quote requirement → the LLM hallucinates the latter freely.

### 1.3 No temporal mechanics (HIGH)

**Files:** `simulation_loop.py:159-194` (clock), `simulation_loop.py:429-465` (agent selection), `models/strategic_agent.py:170-294` (no fields)

- `simulated_hour` is a **constant** (`self.hours_per_round = 6`), not a clock. Round 1 and Round 36 both report "hour 6".
- `StrategicAgent` has no `time_of_day`, `activity_level`, `active_hours`, or `timezone_offset`.
- `get_active_agents` is influence-threshold round-robin, not time-gated.

**Impact:** the prior-art's pattern "agents are only active 9-11, 14-16, 19-22 in their local timezone" creates a natural rhythm — bursts of activity, quiet gaps, opinion formation overnight. Without it, the simulation is a **metronome**: every round the same 30% of "other" agents activate.

### 1.4 Broken `SimClock` (HIGH — required for #3)

**File:** `backend/services/loop/clock.py` (current state in old `simulation_loop.py:166, 189`)

```python
# Current — hour never actually advances per round
simulated_hour = self.hours_per_round   # always 6
```

The clock returns the **same** simulated hour for every round. `day_index`, `day_of_week`, `quarter`, `fiscal_year` rollovers are never computed. The data model claims to be temporal but isn't.

**Impact:** Nothing downstream can reason temporally — the agent LLM prompt cannot reference "morning" or "quarter-end", which means CFO/board activity patterns cannot be modeled.

### 1.5 Uniform pipeline privilege (MEDIUM — UX)

**File:** `pipeline_orchestrator.py:81-89, 1311-1318`

```python
# Current — every stage is 1/7 of the bar
STAGE_WEIGHTS = {  # implicit
    SEED_PARSING: 1, GRAPH_BUILDING: 1, CONFIG_GENERATION: 1,
    PERSONA_BUILDING: 1, WORLD_INIT: 1, SIMULATION_RUNNING: 1, REPORT_GENERATING: 1
}
```

The progress bar shows `71% → 86%` when SIMULATION_RUNNING finishes, regardless of whether 1 or 36 rounds ran. Within SIMULATION_RUNNING there is **no sub-stage progress**. The user cannot tell if 4 of 12 rounds have completed.

**Impact:** Multi-round simulation is not visually the centerpiece — the framing says it is, the UI contradicts it.

---

## 2. Design — what we're building

### 2.1 The hero: `LoopEngine` (Phase 1)

`backend/services/loop/engine.py` — a new class that owns the round loop. It is wired to **explicit dependencies** (the critique's #6 demand):

```python
class LoopEngine:
    def __init__(
        self,
        run_id: str,
        clock: SimClock,                       # fixed in T1.1
        agents: List[StrategicAgent],          # extended in T1.2
        knowledge_store: LocalKnowledgeStore,   # extended in T1.5
        event_bus: EventBus,                    # orchestrator's singleton
        config: SimConfig,                      # extended in T1.2
        llm_client: LLMClient,                  # ← EXPLICIT INJECTION
        world_state: WorldState,                # new in T0.1
        action_resolver: ActionResolver,        # new in T1.4
        memory_writer: MemoryWriteback,         # new in T1.5
        event_injector: EventInjector,          # new in T1.6 (no LLM)
        scheduler: AgentScheduler,              # new in T1.7
    ): ...

    def run(self) -> List[RoundResult]:
        """Drives rounds; returns a list of RoundResult, each with to_event() for SSE."""
```

**Critical property:** `llm_client` is **explicit** — the engine never falls back to "look up `os.environ`" or "import a module-level singleton." This is the single change that makes the engine **testable** with a stub LLM (T1.8 acceptance test depends on this).

### 2.2 The state model: `WorldState` (Phase 0, T0.1)

```python
@dataclass
class WorldState:
    coalitions: Dict[CoalitionId, Set[AgentId]]
    budget_ledger: Dict[ProjectId, float]      # department_id → project_id → remaining
    asset_registry: Dict[AssetId, AssetEntry]  # owner, value, transferable
    proposals: Dict[ProposalId, ProposalStatus]  # PENDING / ENDORSED / BLOCKED
    beliefs: Dict[AgentId, BeliefVector]       # per-topic position + confidence
    events: List[Event]
    # helpers
    def to_dict(self) -> dict: ...
    def from_dict(d: dict) -> "WorldState": ...
    def diff(self, prev: "WorldState") -> List[ChangeRecord]: ...
```

**Why first:** Without a state model, `FORM_COALITION` and `ENDORSE_PROPOSAL` are indistinguishable downstream. T1.4 (Resolver) and T1.5 (Episode-graph writeback) both depend on it.

### 2.3 The 12 business action types (Phase 1, T1.3)

Per the sim design §3 — the enum that the LLM actually sees:

| # | Type | State mutation | Channel |
|---|---|---|---|
| 1 | `FORM_COALITION` | `coalitions` + broadcast trust | SOCIAL_MEDIA |
| 2 | `ENDORSE_PROPOSAL` | `proposals[pid].status = ENDORSED` | OFFICIAL |
| 3 | `BLOCK_PROPOSAL` | `proposals[pid].status = BLOCKED` | OFFICIAL |
| 4 | `PIVOT_STRATEGY` | `budget_ledger` re-weight ±X% | OFFICIAL |
| 5 | `ALLOCATE_BUDGET` | `budget_ledger[project] += δ` | OFFICIAL |
| 6 | `TRADE_ASSET` | `asset_registry` ownership transfer | MARKET_SIGNAL |
| 7 | `CONCEALED_TRADE` | same as TRADE_ASSET + rumor channel leak | MARKET_SIGNAL + RUMOR |
| 8 | `LEAK_INFORMATION` | trust + discovery roll | RUMOR |
| 9 | `MAKE_STATEMENT` | trust + position delta | MEDIA |
| 10 | `PROPOSE_INITIATIVE` | new `proposals[pid]` (PENDING) | DIRECT |
| 11 | `WITHDRAW_SUPPORT` | `proposals[pid].status = BLOCKED` | DIRECT |
| 12 | `SEEK_CLARIFICATION` | trust delta only | DIRECT |

Each is a real `ACTION_PROFILE` in `action_resolver.py` (T1.4). Each mutates a **specific slice** of `WorldState` — unit-tested with `diff()` assertions.

### 2.4 The Workbench hero (Phase 2)

Three-region layout (per UI critique):

```
┌───────────────────────────────────────────────────────────────┐
│  ExecSummary (large, persistent, 1-line "what just happened") │  64-88px
├───────────────────────────────────────────────────────────────┤
│ RoundTimeline (12 round cards, current = glowing magenta)    │
├──────────────────────────────────────┬────────────────────────┤
│                                      │  RoundControls         │
│                                      │  ─────────────────     │
│     Graph canvas (full-bleed)        │  RoundSummary          │
│     (Cosmic Observatory)             │  ─────────────────     │
│                                      │  EmergingEntities      │
│                                      │  ─────────────────     │
│                                      │  NextEventPreview      │
├──────────────────────────────────────┴────────────────────────┤
│ Status strip (run state, progress %)                          │  32px
└───────────────────────────────────────────────────────────────┘
```

**9 explicit UI states** (T2.6): `idle / configuring / running / paused / round-complete / year-complete / completed / failed / cancelled` — each with its own hero, right-rail content, and timeline highlighting.

### 2.5 The Cosmic Observatory (Phase 3, scoped down)

Per the graph critique: ship the visual pass, drop the over-engineered empty/loading states and 20 affordances.

**In scope:**
- d3-force layout with measured settle + freeze toggle (T3.1)
- Dot-grid background, dark base `#0B1020`, 10-type palette, halo-stroke labels (T3.3)
- 5 affordances: hover-highlight / click-detail / double-click-drill / Trace toggle / F+Esc (T3.4)
- 280 px slide-over `NodeDetailPanel` (T3.5)
- Curved multi-edges via quadratic Bézier (T3.6)
- Chip-row filter bar (T3.7)

**Out of scope (deferred):** compass-rose empty state, ghost-pill loaders, mini-map, time slider, department dropdown, keyboard number-row filtering, right-click context menu, label toggle, `0`/`1`-`9` shortcuts.

### 2.6 The external-shock library (T1.6)

Replaces `maybe_generate_external_event` (the LLM-curated shocks that the sim critique called out as fabricated). 12 hand-authored entries per category:

```python
SHOCK_LIBRARY = {
    "regulatory": [
        {"text": "反垄断监管新规出台", "shock_level": 0.6, "channels": [OFFICIAL, MEDIA]},
        # ... 11 more
    ],
    "supply": [
        {"text": "核心供应商因灾停产", "shock_level": 0.4, "channels": [MARKET_SIGNAL]},
        # ... 11 more
    ],
    "competitor": [...],  # 12 entries
    "market_shift": [...],  # 12 entries
}
```

Sampled with probability 0.10 per round (1.5× at burst rounds). Deterministic given seed. `EventInjector` makes **zero LLM calls** — verified by an assertion in T1.6's acceptance test.

---

## 3. The 5-phase plan — all 31 tasks

### Phase 0: Foundation (preparatory, blocks everything else)

> **Why first:** T0.1 (WorldState) is required for T1.4 (Resolver) and T1.5 (Episode-graph writeback). T0.2 (influence/weight selectors) is the only "new state" the graph redesign needs. T0.3 (feature flags) lets us ship Phase 1+2+3 behind flags and flip in Phase 4.

#### T0.1 — Define `WorldState` schema (the missing state model)
- **File:** `backend/models/world_state.py` (NEW)
- **Why first:** Six of twelve actions produce only `trust +X` in the current code. Without a state model, `FORM_COALITION` and `ENDORSE_PROPOSAL` are indistinguishable downstream. This is the foundation for T1.4 and T1.5.
- **Do:** Define the `WorldState` dataclass with `coalitions`, `budget_ledger`, `asset_registry`, `proposals`, `beliefs`, `events`, plus `to_dict` / `from_dict` / `diff(prev)`.
- **Acceptance test:** `backend/tests/unit/test_world_state.py` — construct a state, apply 3 mutations (`FORM_COALITION`, `PIVOT_STRATEGY`, `TRADE_ASSET`), assert `diff()` returns 3 distinct non-empty change records; round-trip `to_dict`/`from_dict` is lossless.
- **Effort:** M

#### T0.2 — Add `influence` and `weight` selectors to the pipeline store
- **File:** `frontend/src/store/pipeline.ts` (MODIFY)
- **Why first:** The graph design references `influence` (size + hot-pulse) and `weight` (edge stroke) but they don't exist in the store. This is the only "new state" the redesign genuinely needs.
- **Do:** Add two pure derived selectors:
  - `selectInfluence(node) → 0.4·normalized(degree) + 0.3·recencyScore + 0.3·(node.properties.influence ?? 0.4)`, clamped to `[0,1]`
  - `selectWeight(edge, currentRound) → 0.5·normalized(count) + 0.5·exp(-0.15·(currentRound - edge.lastTouchRound))`, clamped to `[0,1]`
- **Acceptance test:** `frontend/src/store/__tests__/pipeline.test.ts` — fixture with 5 nodes + 6 edges, assert influence/weight formulas match spec for round 0, 5, 10.
- **Effort:** S

#### T0.3 — Feature flag plumbing
- **Files:** `backend/config.py` (MODIFY) + `frontend/.env.example` (MODIFY)
- **Do:** Add `STRATEGICMIND_LOOP_ENGINE_V2` (default `0`) and `STRATEGICMIND_RKG_D3` (default `0`). Orchestrator and `<RealtimeKnowledgeGraph>` read the flag and branch. Ship Phase 1+2+3 behind flags, flip in Phase 4.
- **Acceptance test:** With flag off, current behavior is byte-identical to `main`. With flag on, the new code path is reachable via a unit test that imports the new module.
- **Effort:** S

---

### Phase 1: Multi-round simulation engine (the hero)

> **Addresses:** Sim critique #1 (broken clock), #2 (decorative actions), #3 (tautological grounding), #4 (LLM-fabricated shocks), #6 (un-implementable edits — wire LLM explicitly).

#### T1.1 — `SimClock` v2 (fix the broken advance logic)
- **File:** `backend/services/loop/clock.py` (NEW)
- **Do:** Rewrite `SimClock.advance(hours)` with a single `divmod` returning `(day_bump, hour_of_day)`. Implement `day_index`, `day_of_week`, `quarter`, `fiscal_year` rollovers. Add `is_business_hours()`, `is_quarter_boundary()`, `days_into_quarter()`. Invariant: `hour_of_day ∈ [0,24) ∧ day_index ≥ 0`.
- **Acceptance test:** `backend/tests/unit/test_sim_clock.py` — parametrized test advancing 1h, 24h, 25h, 90·24h, 365·24h; assert all invariants and rollovers.
- **Effort:** S

#### T1.2 — `SimConfig` extension (active_hours, timezone, coalition, budget)
- **Files:** `backend/services/strategic_config_generator.py` (MODIFY, L120-180) + `backend/models/strategic_agent.py` (MODIFY, L170-294)
- **Do:** Extend `StrategicAgent` with `activity_level: float = 0.5`, `active_hours: List[int] = field(default_factory=lambda: list(range(9,18)))`, `timezone_offset: int = 0`. Extend `SimConfig` with `company.budget_per_dept: Dict[DeptName, float]`, `company.assets: List[Asset]`, `company.coalition_seeds: List[Tuple[AgentId, AgentId]]`. Have `_generate_with_user_params` populate these from `user_params`.
- **Acceptance test:** Integration test — run a stub orchestrator with user_params, dump `SimConfig`, assert budget sums to ≤ `total_cap` and at least 3 distinct `active_hours` lists across agents.
- **Effort:** M

#### T1.3 — `BusinessActionType` + `StrategicAction` extension
- **Files:** `backend/models/action_type.py` (MODIFY, L102-180) + `backend/services/loop/action_taxonomy.py` (NEW)
- **Do:** Define the 12 `BusinessActionType` enum (per design §3). Extend `StrategicAction` with `action_id` (uuid4), `post_content`, `post_author_name`, `in_reply_to`, `propagation_channels`, `evidence`. Add 6-channel `PropagationChannel` enum.
- **Acceptance test:** Unit test — construct each of the 12 action types via factory, validate `action_id` unique, `post_content` ≤ 280 chars enforced, `in_reply_to` only references prior `action_id`.
- **Effort:** S

#### T1.4 — `ActionResolver` + `ACTION_PROFILES` (real state mutation)
- **File:** `backend/services/loop/action_resolver.py` (NEW)
- **Do:** Implement 12 `ACTION_PROFILES` per design §3.1. Each profile mutates a **specific slice** of `WorldState`:
  - `FORM_COALITION` → `coalitions` + trust broadcast
  - `PIVOT_STRATEGY` → `budget_ledger` re-weight ±X% between two depts
  - `ALLOCATE_BUDGET` → `budget_ledger[project] += δ`
  - `TRADE_ASSET` / `CONCEALED_TRADE` → `asset_registry` transfer
  - `BLOCK_PROPOSAL` / `ENDORSE_PROPOSAL` → `proposals[pid].status`
  - `LEAK_INFORMATION` → RUMOR channel + trust delta + discovery roll
  - Others → trust + position deltas only
- **Acceptance test:** Unit test — for each of the 12 types, apply one action to a fixture `WorldState`, assert the relevant slice changed AND the irrelevant slice did NOT.
- **Effort:** L

#### T1.5 — `MemoryWriteback` — episodes ARE a graph, not a transcript
- **Files:** `backend/services/loop/memory_writeback.py` (NEW) + `backend/services/knowledge_store.py` (MODIFY)
- **Do:** For every `StrategicAction`, the writer creates:
  - 1 `Episode` node (natural-language text — verbatim content)
  - 1+ `Relation` edges in the **existing** knowledge graph (not a parallel store):
    - `agent:ACTOR -[PERFORMED]-> episode:EP_ID`
    - `episode:EP_ID -[IN_REPLY_TO]-> episode:PREDECESSOR_ID` (if any)
    - `episode:EP_ID -[CAUSED]-> world_state_node:WS_NODE` (for actions with world mutation)
  - `world_state_node` is a first-class node representing the post-action `WorldState` snapshot (or diff).
- **Acceptance test:** Integration test — run a 2-round loop, query the graph, assert: round-1 episode has PERFORMED edge to actor; round-2 episode (in_reply_to round-1) has both PERFORMED and IN_REPLY_TO edges; a `FORM_COALITION` round has a `Coalition` world_state_node reachable from the episode in ≤ 2 hops.
- **Effort:** L — **this is the highest-leverage task in the whole plan.**

#### T1.6 — `EventInjector` with deterministic library (replaces LLM-curated shocks)
- **Files:** `backend/services/loop/event_injector.py` (NEW) + `backend/services/loop/shock_library.py` (NEW)
- **Do:** Drop `maybe_generate_external_event`. Replace with:
  - **Round 0:** `user_params.external_factors` → typed `MARKET_PRIMER` events (path 1).
  - **`POST /<run_id>/advance-year`:** schedules typed events (regulatory / supply / competitor / market-shift) for round 1 of next year (path 2).
  - **Per-round:** pull from typed shock library with ~12 entries per category, sampled with probability 0.10 per round. Library is hand-authored, deterministic given seed, `shock_level` calibrated to event type (regulatory=0.6, supply=0.4, etc.) — not a free LLM call.
  - **Burst events** (round 12 = 1-year mark) sample at 1.5× probability.
- **Acceptance test:** Unit test with seeded RNG — 12-round run produces 1-3 external events with `shock_level ∈ {0.4, 0.6, 0.8}` only; assert no LLM call is made (mock the LLM client and assert zero invocations from `EventInjector`).
- **Effort:** M

#### T1.7 — `AgentScheduler` v2 (uses SimClock substantively)
- **File:** `backend/services/loop/scheduler.py` (NEW)
- **Do:** Replace decorative `active_hours` filter with **substantive time gates**:
  - CFO / Finance: only on `day_of_month == 1 OR day_of_month == 30` AND business hours
  - Sales: weekday business hours only
  - Board / CEO: only on `is_quarter_boundary()`
  - Engineers: extended hours `[9, 22]`
  - Apply `activity_level * burst` Bernoulli sample, burnished with time gate
  - Add `force_one_action_per_round_minimum` policy so at least one agent acts every round
- **Acceptance test:** Unit test — 90 days simulated, count actions per agent; assert CFO acts on day 1 + day 30 only; board only on day 90; no agent violates time gate.
- **Effort:** M

#### T1.8 — `LoopEngine` (the centerpiece) — wire LLM explicitly
- **File:** `backend/services/loop/engine.py` (NEW)
- **Do:** `LoopEngine.__init__(self, run_id, clock, agents, knowledge_store, event_bus, config, llm_client, ...)` — **the `llm_client: LLMClient` is the explicit injection** that critique #6 demanded. Implement the round loop per design §2.2. `_execute_round` returns a `RoundResult` with `to_event()` for SSE.
- **Acceptance test:** Integration test — instantiate LoopEngine with a stub LLM (returns canned `StrategicAction` JSON); run 3 rounds; assert: clock advanced 3×24h, 3 `Episode` nodes in knowledge store, 3 `round_completed` events emitted, every action has unique `action_id` and `in_reply_to` reference (or `None`).
- **Effort:** L

#### T1.9 — Orchestrator integration (one-line swap, behind flag)
- **File:** `backend/services/pipeline_orchestrator.py` (MODIFY, L920-926 and L1311-1318)
- **Do:** When `STRATEGICMIND_LOOP_ENGINE_V2=1`, instantiate and run `LoopEngine` instead of `simulation_loop.run()`. Sub-progress emit: `_on_round_complete(round_num, total, result) → self._update_stage(run, Stage.SIMULATION_LOOP, round_num/total, sub_label=f"Round {round_num}/{total} · {len(result.actions)} actions")`. SSE `round_completed` payload includes `action_id`, `in_reply_to`, `post_content`, `post_author_name`, `propagation_channels`, `evidence` (per edit #4).
- **Acceptance test:** End-to-end test — `STRATEGICMIND_LOOP_ENGINE_V2=1` runs a full pipeline; assert `round_completed` events contain the new fields, progress bar reaches 65% during loop, reaches 100% at end, and `data/knowledge_graphs/<run>.json` is written with ≥ N=`round_count` Episode nodes.
- **Effort:** M

---

### Phase 2: Workbench UI redesign (the visual hero)

> **Addresses:** UI critique (adopt defaults, fix 50/50 split, state coverage, exec summary).

#### T2.1 — Defaults locked in
- **Decision (no implementation):**
  1. Hero: full-bleed center canvas with right rail
  2. Round timeline: top, 64–88 px, single row
  3. State coverage: all 9 states
  4. Right rail: round controls + current-round summary + emerging entities + next event preview
  5. Executive summary: large, persistent, top-of-page, updates on round transition

#### T2.2 — `Workbench` layout shell (hero + timeline + right rail)
- **Files:** `frontend/src/components/Workbench/index.tsx` (MODIFY) + `frontend/src/components/Workbench/WorkbenchLayout.tsx` (NEW)
- **Do:** Three-region layout — top (64 px round timeline), center (full-bleed graph canvas + 320 px right rail), bottom (32 px status strip). Replace existing 2-column split. Resize existing components to fit.
- **Acceptance test:** Storybook snapshot at 1440×900 — graph region ≥ 60% width, timeline row shows 12 round cards, right rail shows controls + summary.
- **Effort:** M

#### T2.3 — `RoundTimeline` (top horizontal rail)
- **File:** `frontend/src/components/Workbench/RoundTimeline.tsx` (NEW)
- **Do:** 1 card per round, current round enlarged + glowing (magenta `#E879F9` 2-px ring). Click a card to jump to that round's snapshot. Show `Round N · {actionCount} actions · {beliefShifts} shifts`. Emits `onRoundSelect(runId, roundNum)`.
- **Acceptance test:** Component test — fixture with 12 rounds, assert 12 cards render, current round (4) has glowing class, click on round 7 fires the right callback.
- **Effort:** M

#### T2.4 — `RightRail` (controls + summary + emerging entities + next event)
- **File:** `frontend/src/components/Workbench/RightRail.tsx` (NEW)
- **Do:** Four stacked sections in the order from T2.1.4. Icon-only buttons per CLAUDE.md "UI 规范". Big color-block badges for state (emerald/blue/amber/rose/ink). Live-update via `useGraphStream` deltas.
- **Acceptance test:** Component test — when a new `entity_emerged` SSE event arrives, the "emerging entities" section prepends a row ≤ 40 px tall with the entity's first 80 chars.
- **Effort:** M

#### T2.5 — `ExecSummary` (one-line "what just happened" / "what's next")
- **File:** `frontend/src/components/Workbench/ExecSummary.tsx` (NEW)
- **Do:** Two-line component: line 1 = "What just happened in Round N" (1 sentence from LLM, or template if no LLM), line 2 = "What's next" (next scheduled external event, or "等待下一轮"). Large type (16-20 px). Updates on `round_completed`.
- **Acceptance test:** Component test — mock `round_completed` events, assert text changes on each event, no layout shift (fixed height).
- **Effort:** S

#### T2.6 — State coverage: 9 explicit states
- **Files:** `frontend/src/components/Workbench/WorkbenchStateProvider.tsx` (NEW) + per-state render branches
- **Do:** Define the 9 states — `idle / configuring / running / paused / round-complete / year-complete / completed / failed / cancelled`. Each state has: (a) hero treatment, (b) right-rail content, (c) timeline highlighting. `idle` shows the project's "🚀 推演工作台就绪" hero (per CLAUDE.md). `running` shows the live timeline + pulsing current round. `paused` shows a banner + Resume button. `failed` shows a rose banner + Retry.
- **Acceptance test:** Component tests × 9 — for each state, set the run to that state, assert the right hero + right-rail + timeline content.
- **Effort:** M

#### T2.7 — i18n audit
- **File:** all of `frontend/src/locales/{zh,en}/workbench.json` (MODIFY)
- **Do:** Grep for any hardcoded Chinese/English strings in the new components (T2.2–T2.6) and replace with `WORKBENCH.*` keys. Add the 9 state labels, the 12 action-type names, the 5 right-rail section titles.
- **Acceptance test:** `grep -rn '"[一-鿿]\+"' frontend/src/components/Workbench/*.{ts,tsx}` returns zero matches outside the locale files.
- **Effort:** S

---

### Phase 3: Knowledge graph upgrade (Cosmic Observatory, scoped down)

> **Addresses:** Graph critique #1 (recolored demo → typed layout), #2 (wishful perf → measured), #3 (over-engineered empty/loading), #4 (20 affordances → 5), #5 (under-tested hard parts).

#### T3.1 — PR #1 from design: d3-force swap, with measured settle and freeze toggle
- **Files:** `frontend/src/components/RealtimeKnowledgeGraph.tsx` (MODIFY) + `frontend/src/components/graph/useD3Force.ts` (NEW)
- **Do:** Replace the hand-rolled rAF loop with `d3-forceSimulation` configured per design §5.2. Wrap tick callback in `requestAnimationFrame` to avoid blocking. Add a `freezeLayout: boolean` toggle (header button) that sets `simulation.alphaTarget(0)`. Add a "settling" detection: if `alpha < 0.005` for 60 consecutive frames, mark as settled and stop the rAF loop until next restart.
- **Acceptance test:** Component test — fixture with 500 synthetic nodes + 1000 edges; mock `performance.now()` to advance; assert: (a) settle completes in ≤ 2 s on a mid-tier laptop (CI: ≤ 8 s), (b) after settle, rAF loop stops (assert callback not invoked), (c) `freezeLayout=true` prevents re-settle when new nodes arrive.
- **Effort:** L

#### T3.2 — Layout benchmark (graph critique #2, #5)
- **File:** `frontend/src/components/graph/__bench__/settle.bench.ts` (NEW)
- **Do:** Benchmark script (run via `vitest bench`): 50 / 200 / 500 / 1000 nodes, with simulated SSE firing 10 events/sec. Report settle time, frame budget, max jitter, memory. Fail the build if 500-node settle > 2.5 s or jitter > 16 ms.
- **Acceptance test:** `npm run bench:graph` exits 0 with report showing all thresholds met.
- **Effort:** M

#### T3.3 — Cosmic Observatory visual pass (scoped)
- **Files:** `frontend/src/components/graph/GraphCanvas.tsx` (NEW) + `frontend/src/components/graph/palette.ts` (NEW)
- **Do:** Dot-grid background, dark base (`#0B1020`), the 10-type palette from design §2, halo-stroke labels.
- **Skip:** the "compass rose" empty state (single icon + sentence per critique #3), the "ghost pills" loading state, the custom "compass rose" SVG.
- **Acceptance test:** Storybook visual snapshot — canvas at 200 nodes looks like the spec (dotted bg, type-colored nodes, halo-stroke labels). Playwright snapshot comparison test.
- **Effort:** M

#### T3.4 — Interaction surface cut to 5 affordances (graph critique #4)
- **Decision:** Ship exactly:
  1. Hover-highlight neighbors
  2. Click to open detail panel
  3. Double-click to drill-down
  4. Header "Trace" toggle (combines old "Trace path" + "Focus mode" into one mode)
  5. Keyboard `F` to fit-to-view + `Esc` to close
- **Drop:** keyboard number-row filtering, right-click context menu, mini-map (defer to post-launch), "Drill" header button (double-click is enough), `L` label toggle (always on), `0`/`1`-`9` shortcuts.
- **File:** `frontend/src/components/RealtimeKnowledgeGraph.tsx` (MODIFY) — remove the dropped affordances.
- **Acceptance test:** `grep -c 'onKeyDown\|onContextMenu' frontend/src/components/RealtimeKnowledgeGraph.tsx` returns ≤ 2 (only F + Esc).
- **Effort:** S

#### T3.5 — `NodeDetailPanel` (rich, glass, ≤ 280 px slide-over)
- **File:** `frontend/src/components/graph/NodeDetailPanel.tsx` (NEW)
- **Do:** Properties table, summary block, labels list, episodes list (top 5 from `search_episodes`), related-edges accordion. `bg-slate-900/85 backdrop-blur-xl ring-1 ring-white/10`. **Width: 280 px (not 360 px) per critique #6.** Detail is a slide-over, not a same-row panel.
- **Acceptance test:** Component test — click a node, assert panel slides in from right in 220 ms, width is 280 px, Properties table renders `node.properties` keys, Episodes list shows ≤ 5 items.
- **Effort:** M

#### T3.6 — Curved multi-edges + always-on labels
- **Files:** `frontend/src/components/graph/EdgePath.tsx` (NEW) + `frontend/src/components/RealtimeKnowledgeGraph.tsx` (MODIFY)
- **Do:** Replace `<line>` with `<path>` quadratic Bézier. Fan-curvature algorithm (the prior-art `GraphPanel.vue:435-447`, transcribed). Halo-stroke label at midpoint. Drop-on-zoom labels: skip the label rect at `nodes.length > 100`.
- **Acceptance test:** Pure-function test for `EdgePath` — given 3 edges between A and B, assert the `d` attribute contains 3 distinct `Q` curves with different control points.
- **Effort:** M

#### T3.7 — Filter bar (one mode: chip row)
- **File:** `frontend/src/components/graph/FilterBar.tsx` (NEW)
- **Do:** Horizontal chip row at top of panel: `[ All (N) ] [ COMPANY (12) × ] ... [⌕ search]`. Click chip = filter; multi-select = union. Search box = fuzzy match on label. **No time slider, no department dropdown** (defer to post-launch — the audit's "20 affordances" complaint applies).
- **Acceptance test:** Component test — fixture with 5 types; click `PERSON` chip, assert only PERSON nodes render at full opacity; click again, assert all return.
- **Effort:** S

---

### Phase 4: Integration + verification

#### T4.1 — End-to-end run with all flags on
- **File:** `backend/tests/integration/test_loop_v2_e2e.py` (NEW)
- **Do:** Start the backend with `STRATEGICMIND_LOOP_ENGINE_V2=1 STRATEGICMIND_RKG_D3=1`. Drive a full pipeline: seed → graph → config → personas → world init → 12-round loop → report. Assert:
  - 12 `round_completed` SSE events, each with new fields
  - ≥ 30 `Episode` nodes in knowledge graph
  - ≥ 3 distinct `WorldState` graph nodes (from `FORM_COALITION` / `PIVOT_STRATEGY` / `TRADE_ASSET` rounds)
  - Report contains ≥ 3 verbatim quotes per section, each substring-matchable in an `Episode`
  - 0 LLM calls from `EventInjector`
  - Total wall time ≤ 25 min for 12 rounds
- **Acceptance test:** `pytest backend/tests/integration/test_loop_v2_e2e.py -q` passes.
- **Effort:** L

#### T4.2 — Frontend integration test
- **File:** `frontend/e2e/loop-v2-workbench.spec.ts` (NEW, but skip by default per CLAUDE.md test convention)
- **Do:** Drive the UI: start a run, watch the timeline populate, click a round, verify the right-rail + graph update, verify the exec summary updates.
- **Acceptance test:** Playwright test (skipped by default) — passes when run manually.
- **Effort:** M

#### T4.3 — A/B comparison
- **File:** `backend/tests/acceptance/test_quote_grounding.py` (NEW)
- **Do:** Run 10 sample runs with V1 (current) and V2 (new) on the same seed. Compare:
  - Verbatim-quote count per report section (target: V2 ≥ 3/section in 100% of runs vs V1 ~0%)
  - `FORM_COALITION` rounds produce a `Coalition` world_state_node reachable in ≤ 2 graph hops
  - `SimClock` invariants hold after every round
  - No fabricated LLM shocks
- **Acceptance test:** Acceptance test passes with the target metric values.
- **Effort:** M

#### T4.4 — Flag flip + docs
- **Files:** `CLAUDE.md` (MODIFY) + `README.md` (MODIFY)
- **Do:** Flip `STRATEGICMIND_LOOP_ENGINE_V2` and `STRATEGICMIND_RKG_D3` to default `1`. Update CLAUDE.md "5 目标" → keep G1-G5 (per critique #7, do **NOT** add G6/G7 yet — wait for the demo). Add a "Phase 1 / Phase 2 / Phase 3 / Phase 4" section to README explaining the rollout.
- **Acceptance test:** `git grep -n "STRATEGICMIND_LOOP_ENGINE_V2"` shows `1` in `.env.example`. `git grep -n "G6\|G7"` returns no matches.
- **Effort:** S

#### T4.5 — Rollback plan
- **File:** `docs/rollback/loop-v2-rollback.md` (NEW)
- **Do:** Document: how to set both flags to `0` to revert, which 2 env vars to flip, which 1 `git revert` covers all 7 PRs. Keep the old `simulation_loop.py` for one release.
- **Acceptance test:** Following the doc flips both flags and a smoke test passes.
- **Effort:** S

---

## 4. Dependency graph (must-do order)

```
T0.1 WorldState ─────────────────┐
T0.2 influence/weight ───────────┼──→ T1.1..T1.9 ──→ T2.1..T2.7 ──→ T3.1..T3.7 ──→ T4.1..T4.5
T0.3 feature flag ───────────────┘                                                  ↑
                                                                              (no LLM-fab shocks)
```

**Critical path:** T0.1 → T1.4 → T1.5 → T1.8 → T1.9 → T4.1 (the simulation engine end-to-end).
**Parallelizable:** Phase 2 (UI) and Phase 3 (graph) are independent of each other and can run in parallel after Phase 1 ships.

### 4.1 Effort summary

| Phase | Tasks | Total effort |
|---|---|---|
| 0 | 3 | S + S + S = 3S |
| 1 | 9 | S + M + S + L + L + M + M + L + M = 2L + 4M + 3S |
| 2 | 7 | (defaults) S + M + M + M + S + M + S = 3M + 4S |
| 3 | 7 | L + M + M + S + M + M + S = 1L + 4M + 2S |
| 4 | 5 | L + M + M + S + S = 1L + 2M + 2S |
| **Total** | **31 tasks** | **~4L + 13M + 12S** (≈ 4-6 weeks one engineer, or 2-3 weeks two engineers in parallel) |

---

## 5. Acceptance gates (overall, not per-task)

These 8 gates must all pass before the flag-flip in T4.4. Per-task acceptance tests live in §3 above; these are the *system-level* gates.

### Gate 1 — Grounding is real, not theater
Every report-section verbatim quote is substring-matchable in an `Episode` node AND that Episode is reachable from a `WorldState` graph node in ≤ 2 hops.

**Why it matters:** Tautological grounding (the LLM quoting itself) was the #1 "mediocre emergence" symptom. This gate enforces that quotes trace back to the actual simulation.

### Gate 2 — Actions mutate state, not just trust
All 12 `BusinessActionType` produce a distinct `WorldState` diff (proven by unit test in T1.4).

**Why it matters:** Decorative action types were the #1 root cause. The diff test is the unit-level enforcement.

### Gate 3 — Clock ticks correctly
90 days simulated = 1 quarter; 365 days = 1 fiscal year; CFO acts on day 1+30; board on day 90 only.

**Why it matters:** The broken clock was the prerequisite for all temporal mechanics. If the clock doesn't tick, the scheduler can't gate.

### Gate 4 — No LLM-fabricated shocks
`EventInjector` makes 0 LLM calls; shocks come from the typed library only.

**Why it matters:** The sim critique explicitly identified LLM-curated shocks as a fabrication. This gate is the assertion.

### Gate 5 — UI states covered
All 9 Workbench states render correctly (component tests in T2.6).

**Why it matters:** The audit found the current Workbench silently handled most non-`running` states. The 9-state coverage is the fix.

### Gate 6 — Graph performance measured
500 nodes settle in ≤ 2.5 s; freeze toggle works; 0 dropped frames during drag.

**Why it matters:** The "Cosmic Observatory" name required a real perf budget. Vitest bench in T3.2 is the measurement.

### Gate 7 — Graph affordances ≤ 5
Hover / click / double-click / Trace toggle / F+Esc — nothing more.

**Why it matters:** The audit's "20 affordances" complaint was a load-bearing finding. The grep test in T3.4 is the assertion.

### Gate 8 — G6/G7 not added
CLAUDE.md keeps the original 5-goal table; the demo earns the rename later.

**Why it matters:** Per the sim critique #7, "renaming a goal is not a deliverable." The grep test in T4.4 is the assertion.

---

## 6. What this plan explicitly does NOT do (and why)

This is the no-go list — the items intentionally cut from scope. Each has a documented reason.

### 6.1 No G6/G7 rename
**Reason:** Per sim critique #7, renaming a goal is not a deliverable. The 5-goal table stays. The demo earns the rename later.

### 6.2 No "compass rose" empty state, no ghost pills, no twinkling loaders
**Reason:** Per graph critique #3, those are scope creep. Empty = single icon + sentence. Loading = counter. The audit's "over-engineered empty/loading" finding was load-bearing.

### 6.3 No mini-map in v1
**Reason:** Per graph critique #4, defer to post-launch. The interaction budget is already at 5. Adding a 6th affordance breaks the "≤ 5" gate.

### 6.4 No LLM-curated external shocks
**Reason:** Per sim critique #4, replace with a typed library. The doc admitted the round-timing was a lie anyway. The library has ~12 entries per category, hand-authored, deterministic.

### 6.5 No parallel `LocalKnowledgeStore`
**Reason:** Per sim critique "Missing patterns from the social-simulation baseline #1," Episode nodes live in the **same** knowledge graph as entities. The report's grounding becomes a graph-path check, not a substring tautology.

### 6.6 No 65% progress weight in v1
**Reason:** Phase 2 ships the Workbench redesign first; the progress-bar promotion is a one-line change in T1.9 sub-progress. The "loop is the centerpiece" claim is earned by the demo, not the framing.

### 6.7 No "branching worlds" / ensemble
**Reason:** Out of scope. The single-thread deterministic engine with a typed shock library already produces 12 distinct rounds; branching is a v2 follow-up.

### 6.8 No time decay on episode salience in v1
**Reason:** Per sim critique "Missing patterns #3," append-only log ships first; recency-weighted retrieval is a v2 follow-up (added to `search_episodes` as a `recencyBias` parameter).

---

## 7. File map — all files that will be touched

### 7.1 Backend (Python)

| File | Action | Task | Why |
|---|---|---|---|
| `backend/models/world_state.py` | NEW | T0.1 | State model — required for Resolver and Writeback |
| `backend/services/loop/clock.py` | NEW | T1.1 | SimClock v2 (fix broken advance) |
| `backend/services/loop/action_taxonomy.py` | NEW | T1.3 | 12-type enum + profile table |
| `backend/services/loop/action_resolver.py` | NEW | T1.4 | Resolver that mutates WorldState per type |
| `backend/services/loop/memory_writeback.py` | NEW | T1.5 | Episode-as-graph writeback |
| `backend/services/loop/event_injector.py` | NEW | T1.6 | Deterministic shock library (no LLM) |
| `backend/services/loop/shock_library.py` | NEW | T1.6 | Hand-authored ~12 entries per category |
| `backend/services/loop/scheduler.py` | NEW | T1.7 | Time-gated agent scheduling |
| `backend/services/loop/engine.py` | NEW | T1.8 | LoopEngine (the centerpiece) |
| `backend/services/knowledge_store.py` | MODIFY | T1.5 | Support Episode + world_state_node writes |
| `backend/services/strategic_config_generator.py` | MODIFY (L120-180) | T1.2 | Populate budget, assets, coalition_seeds |
| `backend/models/strategic_agent.py` | MODIFY (L170-294) | T1.2 | Add activity_level, active_hours, timezone_offset |
| `backend/models/action_type.py` | MODIFY (L102-180, L139-141) | T1.3 | Add post_content, post_author_name, in_reply_to, action_id, propagation_channels, evidence |
| `backend/services/pipeline_orchestrator.py` | MODIFY (L920-926, L1311-1318) | T1.9 | One-line swap to LoopEngine, sub-progress emit |
| `backend/config.py` | MODIFY | T0.3 | Add `STRATEGICMIND_LOOP_ENGINE_V2` flag |
| `backend/tests/unit/test_world_state.py` | NEW | T0.1 | WorldState unit tests |
| `backend/tests/unit/test_sim_clock.py` | NEW | T1.1 | SimClock parametrize |
| `backend/tests/integration/test_loop_v2_e2e.py` | NEW | T4.1 | End-to-end with all flags on |
| `backend/tests/acceptance/test_quote_grounding.py` | NEW | T4.3 | A/B comparison |
| `docs/rollback/loop-v2-rollback.md` | NEW | T4.5 | Rollback plan |

### 7.2 Frontend (TypeScript / React)

| File | Action | Task | Why |
|---|---|---|---|
| `frontend/src/components/Workbench/index.tsx` | MODIFY | T2.2 | Three-region layout |
| `frontend/src/components/Workbench/WorkbenchLayout.tsx` | NEW | T2.2 | Layout shell |
| `frontend/src/components/Workbench/RoundTimeline.tsx` | NEW | T2.3 | Top horizontal rail |
| `frontend/src/components/Workbench/RightRail.tsx` | NEW | T2.4 | Controls + summary + emerging + next event |
| `frontend/src/components/Workbench/ExecSummary.tsx` | NEW | T2.5 | Two-line "what just happened" / "what's next" |
| `frontend/src/components/Workbench/WorkbenchStateProvider.tsx` | NEW | T2.6 | 9-state context |
| `frontend/src/locales/{zh,en}/workbench.json` | MODIFY | T2.7 | i18n keys for 9 states, 12 actions, 5 rail sections |
| `frontend/src/components/RealtimeKnowledgeGraph.tsx` | MODIFY | T3.1, T3.4, T3.6 | d3-force swap, drop 15 affordances, curved edges |
| `frontend/src/components/graph/useD3Force.ts` | NEW | T3.1 | d3-force hook with settle detection |
| `frontend/src/components/graph/GraphCanvas.tsx` | NEW | T3.3 | Cosmic Observatory canvas |
| `frontend/src/components/graph/palette.ts` | NEW | T3.3 | 10-type color palette |
| `frontend/src/components/graph/NodeDetailPanel.tsx` | NEW | T3.5 | 280 px slide-over |
| `frontend/src/components/graph/EdgePath.tsx` | NEW | T3.6 | Quadratic Bézier multi-edge |
| `frontend/src/components/graph/FilterBar.tsx` | NEW | T3.7 | Chip-row filter |
| `frontend/src/components/graph/__bench__/settle.bench.ts` | NEW | T3.2 | Vitest bench script |
| `frontend/src/store/pipeline.ts` | MODIFY | T0.2 | `selectInfluence` + `selectWeight` |
| `frontend/src/store/__tests__/pipeline.test.ts` | NEW | T0.2 | Selector unit tests |
| `frontend/.env.example` | MODIFY | T0.3, T4.4 | `STRATEGICMIND_RKG_D3` flag (default 0 → 1) |
| `frontend/e2e/loop-v2-workbench.spec.ts` | NEW (skip by default) | T4.2 | Playwright e2e |
| `CLAUDE.md` | MODIFY | T4.4 | Keep 5-goal table; add Phase 1-4 section note |
| `README.md` | MODIFY | T4.4 | Rollout section |

### 7.3 Total counts

| Bucket | NEW | MODIFY | Total |
|---|---|---|---|
| Backend | 13 | 6 | 19 |
| Frontend | 12 | 5 | 17 |
| Docs / root | 1 | 3 | 4 |
| **Total** | **26** | **14** | **40 files** |

---

## 8. How to ship this

### 8.1 PR slicing (≤ 7 PRs)

Per the rollback plan (T4.5), all 31 tasks should land in ≤ 7 PRs so a single `git revert` covers everything. Suggested slicing:

| PR | Tasks | Theme |
|---|---|---|
| 1 | T0.1, T0.2, T0.3 | Foundation (state + selectors + flags) |
| 2 | T1.1, T1.2, T1.3 | Clock + SimConfig + ActionType |
| 3 | T1.4, T1.5, T1.6 | Resolver + Writeback + EventInjector (no-LLM shocks) |
| 4 | T1.7, T1.8, T1.9 | Scheduler + LoopEngine + Orchestrator integration |
| 5 | T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T2.7 | Workbench redesign (all UI tasks) |
| 6 | T3.1, T3.2, T3.3, T3.4, T3.5, T3.6, T3.7 | Cosmic Observatory (all graph tasks) |
| 7 | T4.1, T4.2, T4.3, T4.4, T4.5 | Integration + flag flip + rollback |

### 8.2 Rollout sequence

1. Land PR1-2 behind flags (default `0`). All existing tests pass.
2. Land PR3 — measurable improvement in unit tests (action type tests in T1.4).
3. Land PR4 — backend can run with `STRATEGICMIND_LOOP_ENGINE_V2=1`. Run T4.1 integration test.
4. Land PR5 — frontend can render with the new Workbench.
5. Land PR6 — frontend can render with the Cosmic Observatory.
6. Land PR7 — flip flags to default `1`. Run T4.3 A/B test. Verify all 8 acceptance gates.
7. Tag release. Add Phase 1-4 section to README. Update CLAUDE.md 5-goal table to point to the new spec.

### 8.3 Rollback

If any acceptance gate fails after the flip:

```bash
# Revert the flag
sed -i '' 's/STRATEGICMIND_LOOP_ENGINE_V2=1/STRATEGICMIND_LOOP_ENGINE_V2=0/' .env
sed -i '' 's/STRATEGICMIND_RKG_D3=1/STRATEGICMIND_RKG_D3=0/' .env
# Or revert all 7 PRs in one shot
git revert --no-commit HEAD~7..HEAD
```

See `docs/rollback/loop-v2-rollback.md` (T4.5) for the full procedure.

---

## 9. Open questions / future work

These are NOT blockers but are worth flagging:

1. **Branching worlds / ensemble runs** — The prior-art supports parallel worlds. The sim critique deferred this; revisit after v1 ships.
2. **Recency-weighted episode retrieval** — append-only log ships first; `search_episodes` will get a `recencyBias` parameter in v2.
3. **Department dropdown + time slider in filter bar** — explicitly deferred to v1.1; the audit's "20 affordances" finding says hold.
4. **Mini-map** — explicitly deferred. v2.
5. **G6/G7 rename** — only after the demo earns it. Per the critique, not before.

---

## 10. References

- Audit (pipeline + ui + graph): `result.audit`
- Designs (sim + ui + graph + 3 critiques): `result.design`
- Synthesized plan: `result.plan` (this document's source)
- Prior-art baseline: 11-pattern comparison in audit §6 (3 complete, 2 partial, 6 missing)
- CLAUDE.md "5 目标": G1–G5 (kept as-is; do not add G6/G7)
- CLAUDE.md "测试约定": integration / unit / e2e conventions followed throughout

---

**Document version:** v1.0 · 2026-06-08
**Status:** Plan only. No code written. Ready for sign-off → `subagent-driven-development` dispatch.
