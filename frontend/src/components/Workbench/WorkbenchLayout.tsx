/**
 * WorkbenchLayout — Workbench redesign (T2.2)
 *
 * Three-region layout for the redesigned Workbench (full-bleed center canvas
 * with 320px right rail), per the Loop Engine v2 plan §2.4.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Top:    ExecSummary  (large, persistent, 1-2 lines) │  64-88px
 *   ├──────────────────────────────────────────────────────┤
 *   │  Mid-top: RoundTimeline  (12 cards, current = glow)   │  64-88px
 *   ├──────────────────────────────────┬───────────────────┤
 *   │                                  │                   │
 *   │  Center: Graph canvas (full)     │  RightRail (320px)│
 *   │                                  │                   │
 *   ├──────────────────────────────────┴───────────────────┤
 *   │  Status strip (run state, round N/M, progress %)     │  32px
 *   └──────────────────────────────────────────────────────┘
 *
 * Acceptance: at 1440x900 the graph region >= 60% of total width.
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.2
 */
import { memo, useCallback, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import ExecSummary from './ExecSummary'
import RoundTimeline from './RoundTimeline'
import RightRail from './RightRail'
import StateHero from './StateHero'
import StageProgressStrip from './StageProgressStrip'
import {
  WorkbenchStateProvider,
  useWorkbenchState,
} from './WorkbenchStateProvider'
import {
  useStatus,
  useSnapshot,
  useSimRounds,
  useStageProgress,
} from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

export interface WorkbenchLayoutProps {
  /** Center content (graph canvas). Required. */
  children: ReactNode
  /** Optional override for total rounds (skeleton / preview) */
  totalRounds?: number
  /** Test hook */
  dataTestId?: string
}

function WorkbenchLayoutShell({
  children,
  totalRounds,
  dataTestId = 'wb-layout',
}: WorkbenchLayoutProps) {
  const status = useStatus()
  const snapshot = useSnapshot()
  const simRounds = useSimRounds()
  const { state } = useWorkbenchState()
  const stageProgress = useStageProgress()

  const onRoundSelect = useCallback((_runId: string, _roundNum: number) => {
    // Hook for future jump-to-round; in Phase 2 we just update the visible
    // ExecSummary / RightRail by passing the selected round down via a
    // controlled prop. For now the events propagate via simRounds already.
  }, [])

  const total = totalRounds ?? snapshot?.total_rounds ?? Math.max(simRounds.length, 12)
  const current = simRounds.length > 0 ? simRounds[simRounds.length - 1].round : 0
  const progress = typeof snapshot?.progress === 'number' ? snapshot.progress : 0

  return (
    <div
      data-testid={dataTestId}
      data-state={state}
      data-status={status}
      className="w-full flex flex-col gap-3 min-h-[600px]"
    >
      {/* ===== Region: state hero (only shown for terminal/non-running states) ===== */}
      <StateHero dataTestId={`${dataTestId}-hero`} />

      {/* ===== NEW (P5): Region 0.5 — 7 步流水线状态条 ===== */}
      <section
        data-testid={`${dataTestId}-stage-progress`}
        className="w-full"
        aria-label="Stage progress"
      >
        <StageProgressStrip
          stages={stageProgress.stages}
          sub={stageProgress.sub}
          currentStage={stageProgress.currentStage}
          isLooping={stageProgress.isLooping}
          yearOffset={stageProgress.yearOffset}
        />
      </section>

      {/* ===== Region 1: Top — ExecSummary ===== */}
      <section
        data-testid={`${dataTestId}-exec`}
        className="w-full"
        aria-label="Executive summary"
      >
        <ExecSummary currentRound={current} />
      </section>

      {/* ===== Region 2: Mid-top — RoundTimeline (64-88px) ===== */}
      <section
        data-testid={`${dataTestId}-timeline`}
        className="w-full"
        aria-label="Round timeline"
      >
        <RoundTimeline
          currentRound={current}
          totalRounds={total}
          onRoundSelect={onRoundSelect}
        />
      </section>

      {/* ===== Region 3: Center + Right rail ===== */}
      <section
        data-testid={`${dataTestId}-center`}
        className="flex flex-row gap-3 flex-1 min-h-0"
      >
        {/* Center: full-bleed graph canvas (>= 60% of width) */}
        <motion.div
          data-testid={`${dataTestId}-canvas`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 min-w-0 min-h-[480px] rounded-xl overflow-hidden
                     bg-white/40 dark:bg-ink-900/30
                     border border-ink-200/60 dark:border-ink-800/60"
          style={{ flex: '1 1 60%' }}
        >
          {children}
        </motion.div>

        {/* Right: 320px rail */}
        <RightRail currentRound={current} dataTestId={`${dataTestId}-rail`} />
      </section>

      {/* ===== Region 4: Status strip (32px) ===== */}
      <footer
        data-testid={`${dataTestId}-status`}
        className="h-8 px-3 flex items-center justify-between
                   text-[10px] font-mono
                   bg-ink-50/70 dark:bg-ink-900/50
                   border border-ink-200/60 dark:border-ink-800/60
                   rounded-md"
      >
        <div className="flex items-center gap-3">
          <span
            data-testid="wb-status-state"
            className={`px-1.5 py-0.5 rounded font-bold ${
              status === 'running' ? 'bg-blue-500 text-white' :
              status === 'paused' ? 'bg-amber-500 text-white' :
              status === 'completed' ? 'bg-emerald-500 text-white' :
              status === 'failed' ? 'bg-rose-500 text-white' :
              'bg-ink-300 text-ink-900'
            }`}
          >
            {status.toUpperCase()}
          </span>
          <span data-testid="wb-status-round" className="text-ink-700 dark:text-ink-200">
            {WORKBENCH.statusStripRound(current, total)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-32 h-1.5 rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
            <div
              data-testid="wb-status-progress-bar"
              className="h-full bg-gradient-to-r from-brand-500 to-accent-500"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <span data-testid="wb-status-progress-text" className="tabular-nums text-ink-700 dark:text-ink-200">
            {WORKBENCH.statusStripProgress(progress)}
          </span>
        </div>
      </footer>
    </div>
  )
}

function WorkbenchLayoutImpl(props: WorkbenchLayoutProps) {
  return (
    <WorkbenchStateProvider>
      <WorkbenchLayoutShell {...props} />
    </WorkbenchStateProvider>
  )
}

const WorkbenchLayout = memo(WorkbenchLayoutImpl)
export default WorkbenchLayout
