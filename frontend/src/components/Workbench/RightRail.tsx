/**
 * RightRail — Workbench redesign (T2.4)
 *
 * 4 stacked sections in fixed order (per T2.1.4 + T2.6):
 *   1) Round controls    (icon-only buttons per CLAUDE.md)
 *   2) Current round summary
 *   3) Emerging entities (live-updated via useGraphStream)
 *   4) Next event preview
 *
 * Layout: 320px wide vertical rail. Per CLAUDE.md "UI 规范":
 *   - icon-only buttons, no text+icon
 *   - big color-block badges (emerald/blue/amber/rose/ink)
 *   - single-row list items, <= 40px tall
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.4
 */
import { memo, useMemo, useCallback } from 'react'
import {
  Play, Pause, X, FastForward, Activity,
  Users, Building2,
} from 'lucide-react'
import {
  useRunId, useStatus, useSnapshot, useSimRounds,
  usePipelineStore,
} from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

export interface RightRailProps {
  /** Override the displayed "current" round for the summary section */
  currentRound?: number
  /** Test hook */
  dataTestId?: string
}

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  running:  { label: WORKBENCH.stateRunning,  cls: 'bg-blue-500 text-white' },
  paused:   { label: WORKBENCH.statePaused,   cls: 'bg-amber-500 text-white' },
  completed:{ label: WORKBENCH.stateCompleted,cls: 'bg-emerald-500 text-white' },
  failed:   { label: WORKBENCH.stateFailed,   cls: 'bg-rose-500 text-white' },
  cancelled:{ label: WORKBENCH.stateCancelled,cls: 'bg-ink-500 text-white' },
  idle:     { label: WORKBENCH.stateIdle,     cls: 'bg-ink-300 text-ink-900' },
  configuring: { label: WORKBENCH.stateConfiguring, cls: 'bg-blue-500 text-white' },
}

function RightRailImpl({
  currentRound,
  dataTestId = 'wb-right-rail',
}: RightRailProps) {
  const runId = useRunId()
  const status = useStatus()
  const snapshot = useSnapshot()
  const simRounds = useSimRounds()

  const pause = usePipelineStore((s) => s.pause)
  const resume = usePipelineStore((s) => s.resume)
  const cancel = usePipelineStore((s) => s.cancel)
  const advanceYear = usePipelineStore((s) => s.advanceYear)

  // ---- Current round summary ----
  const lastRound = simRounds.length > 0 ? simRounds[simRounds.length - 1] : null
  const summaryRound = currentRound ?? lastRound?.round ?? 0
  const summary = useMemo(() => {
    if (lastRound && (currentRound == null || currentRound === lastRound.round)) {
      return {
        round: lastRound.round,
        actions: lastRound.actions_count ?? lastRound.actions?.length ?? 0,
        shifts:
          lastRound.belief_shift_count ??
          lastRound.belief_updates_count ??
          lastRound.belief_updates?.length ??
          0,
        activeAgents:
          typeof lastRound.active_agents === 'number'
            ? lastRound.active_agents
            : (lastRound.active_agents as string[] | undefined)?.length ?? 0,
      }
    }
    // Look up an earlier round if user selected a non-latest round
    const earlier = simRounds.find((r) => r.round === currentRound)
    if (earlier) {
      return {
        round: earlier.round,
        actions: earlier.actions_count ?? earlier.actions?.length ?? 0,
        shifts:
          earlier.belief_shift_count ??
          earlier.belief_updates_count ??
          earlier.belief_updates?.length ??
          0,
        activeAgents:
          typeof earlier.active_agents === 'number'
            ? earlier.active_agents
            : (earlier.active_agents as string[] | undefined)?.length ?? 0,
      }
    }
    return null
  }, [lastRound, simRounds, currentRound])

  // ---- 活跃 Agent 聚合 (从 simRounds.actions) ----
  const activeAgents = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; lastAction: string }>()
    for (const r of simRounds) {
      for (const a of r.actions ?? []) {
        const id = a.agent_id ?? a.id ?? 'unknown'
        const name = a.agent_name ?? a.name ?? id
        const cur = counts.get(id) ?? { name, count: 0, lastAction: '' }
        cur.count += 1
        cur.lastAction = a.action_type ?? cur.lastAction
        counts.set(id, cur)
      }
    }
    return Array.from(counts.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [simRounds])

  // ---- 部门动作聚合 ----
  const departmentActions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of simRounds) {
      for (const a of r.actions ?? []) {
        const d = a.department ?? 'OTHER'
        counts.set(d, (counts.get(d) ?? 0) + 1)
      }
    }
    const max = Math.max(1, ...Array.from(counts.values()))
    return Array.from(counts.entries())
      .map(([dept, n]) => ({ dept, n, ratio: n / max }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 9)
  }, [simRounds])

  const onAdvance = useCallback(async () => {
    try {
      await advanceYear(1)
    } catch (e) {
      console.error('advance-year failed', e)
    }
  }, [advanceYear])

  const onPause = useCallback(async () => {
    try { await pause() } catch (e) { console.error(e) }
  }, [pause])
  const onResume = useCallback(async () => {
    try { await resume() } catch (e) { console.error(e) }
  }, [resume])
  const onCancel = useCallback(async () => {
    try { await cancel() } catch (e) { console.error(e) }
  }, [cancel])

  const totalRounds = snapshot?.total_rounds ?? simRounds.length ?? 0
  const badge = STATE_BADGE[status] ?? STATE_BADGE.idle

  return (
    <aside
      data-testid={dataTestId}
      data-status={status}
      className="w-[320px] flex-shrink-0 flex flex-col gap-3
                 bg-white/80 dark:bg-ink-900/60
                 border border-ink-200/60 dark:border-ink-800/60
                 rounded-xl p-3 overflow-y-auto nice-scroll"
    >
      {/* ===== Section 1: Round controls ===== */}
      <section
        data-testid="wb-rail-controls"
        className="card p-3"
        aria-label={WORKBENCH.railSectionControls}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionControls}
          </div>
          <span
            data-testid="wb-rail-status-badge"
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {status === 'running' && (
            <button
              data-testid="wb-rail-btn-pause"
              onClick={onPause}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg
                         bg-amber-500 hover:bg-amber-600 text-white transition-colors"
              title={WORKBENCH.railBtnPauseTitle}
              aria-label={WORKBENCH.railBtnPause}
            >
              <Pause size={14} />
            </button>
          )}
          {status === 'paused' && (
            <button
              data-testid="wb-rail-btn-resume"
              onClick={onResume}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg
                         bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
              title={WORKBENCH.railBtnResumeTitle}
              aria-label={WORKBENCH.railBtnResume}
            >
              <Play size={14} />
            </button>
          )}
          {(status === 'running' || status === 'paused') && (
            <button
              data-testid="wb-rail-btn-cancel"
              onClick={onCancel}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg
                         bg-rose-500 hover:bg-rose-600 text-white transition-colors"
              title={WORKBENCH.railBtnCancelTitle}
              aria-label={WORKBENCH.railBtnCancel}
            >
              <X size={14} />
            </button>
          )}
          {(status === 'completed' || status === 'failed') && (
            <button
              data-testid="wb-rail-btn-advance"
              onClick={onAdvance}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg
                         bg-gradient-to-br from-amber-500 to-orange-500
                         hover:from-amber-600 hover:to-orange-600
                         text-white transition-colors"
              title={WORKBENCH.railBtnAdvanceYearTitle}
              aria-label={WORKBENCH.railBtnAdvanceYear}
            >
              <FastForward size={14} />
            </button>
          )}
          {!runId && (
            <div className="text-[10px] text-ink-400 px-2">
              {WORKBENCH.roundTimelineEmpty}
            </div>
          )}
        </div>
      </section>

      {/* ===== Section 2: Current round summary ===== */}
      <section
        data-testid="wb-rail-summary"
        className="card p-3"
        aria-label={WORKBENCH.railSectionSummary}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionSummary}
          </div>
          <div className="text-[10px] font-mono font-bold text-ink-700 dark:text-ink-200">
            {WORKBENCH.statusStripRound(summaryRound, totalRounds)}
          </div>
        </div>
        {summary ? (
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg bg-ink-50/70 dark:bg-ink-900/50 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-ink-500 font-semibold">
                {WORKBENCH.railSummaryActions}
              </div>
              <div className="text-base font-bold font-mono text-brand-600 dark:text-brand-400 tabular-nums mt-0.5">
                {summary.actions}
              </div>
            </div>
            <div className="rounded-lg bg-ink-50/70 dark:bg-ink-900/50 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-ink-500 font-semibold">
                {WORKBENCH.railSummaryShifts}
              </div>
              <div className="text-base font-bold font-mono text-accent-600 dark:text-accent-400 tabular-nums mt-0.5">
                {summary.shifts}
              </div>
            </div>
            <div className="rounded-lg bg-ink-50/70 dark:bg-ink-900/50 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-ink-500 font-semibold">
                {WORKBENCH.railSummaryActive}
              </div>
              <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {summary.activeAgents}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-ink-400 py-2 text-center">
            {WORKBENCH.railSummaryNoData}
          </div>
        )}
      </section>

      {/* ===== Section 3: 活跃 Agent (P5 增强) ===== */}
      <section
        data-testid="wb-rail-active-agents"
        className="card p-3"
        aria-label={WORKBENCH.railSectionActiveAgents}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionActiveAgents}
          </div>
          <Users size={11} className="text-brand-500" />
        </div>
        {activeAgents.length === 0 ? (
          <div className="text-[11px] text-ink-400 py-2 text-center">
            {WORKBENCH.railActiveAgentsEmpty}
          </div>
        ) : (
          <ul className="space-y-1">
            {activeAgents.map((a) => (
              <li
                key={a.id}
                data-testid="wb-rail-agent-item"
                className="flex items-center gap-2 px-2 h-9 rounded-md
                           bg-ink-50/70 dark:bg-ink-900/50
                           border border-ink-200/40 dark:border-ink-800/40"
                style={{ maxHeight: 40 }}
                title={a.name}
              >
                <Activity size={10} className="text-brand-500 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-[11px] text-ink-700 dark:text-ink-200 truncate">
                  {a.name}
                </div>
                <span className="text-[9px] font-mono font-bold text-ink-500 flex-shrink-0">
                  {WORKBENCH.railActiveAgentActionCount(a.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Section 4: 部门动作分布 (P5 增强) ===== */}
      <section
        data-testid="wb-rail-department"
        className="card p-3"
        aria-label={WORKBENCH.railSectionDepartment}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionDepartment}
          </div>
          <Building2 size={11} className="text-emerald-500" />
        </div>
        {departmentActions.length === 0 ? (
          <div className="text-[11px] text-ink-400 py-2 text-center">
            {WORKBENCH.railDepartmentEmpty}
          </div>
        ) : (
          <ul className="space-y-1">
            {departmentActions.map((d) => (
              <li
                key={d.dept}
                data-testid="wb-rail-dept-bar"
                className="flex items-center gap-2"
              >
                <span className="text-[10px] font-mono text-ink-600 dark:text-ink-300 w-14 flex-shrink-0 truncate" title={d.dept}>
                  {d.dept}
                </span>
                <div className="flex-1 h-3 rounded bg-ink-100 dark:bg-ink-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                    style={{ width: `${Math.max(2, d.ratio * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-ink-500 w-6 text-right flex-shrink-0">
                  {d.n}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

const RightRail = memo(RightRailImpl)
export default RightRail
