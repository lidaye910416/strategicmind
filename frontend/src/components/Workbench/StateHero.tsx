/**
 * StateHero — Workbench redesign (T2.6)
 *
 * Per-state hero treatments used at the top of the WorkbenchLayout. Renders
 * nothing (returns null) for normal states (running/round-complete/year-complete)
 * because the layout already shows RoundTimeline + ExecSummary.
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.6
 */
import { memo } from 'react'
import { motion } from 'framer-motion'
import { Rocket, Loader2, AlertTriangle, XCircle, RefreshCcw, CheckCircle2, Pause, Home } from 'lucide-react'
import { useWorkbenchState, type WorkbenchState } from './WorkbenchStateProvider'
import { WORKBENCH, APP_ROUTES } from '../../i18n/zh'

export interface StateHeroProps {
  dataTestId?: string
}

function StateHeroImpl({ dataTestId = 'wb-state-hero' }: StateHeroProps) {
  const { state, transitionTo } = useWorkbenchState()

  if (state === 'running' || state === 'round-complete' || state === 'year-complete') {
    // No hero overlay; RoundTimeline + ExecSummary carry the visual weight
    return null
  }

  return (
    <div data-testid={dataTestId} data-state={state}>
      {state === 'idle' && (
        <IdleHero />
      )}
      {state === 'configuring' && (
        <ConfiguringHero />
      )}
      {state === 'paused' && (
        <PausedHero />
      )}
      {state === 'failed' && (
        <FailedHero onRetry={() => transitionTo('idle')} />
      )}
      {state === 'cancelled' && (
        <CancelledHero />
      )}
      {state === 'completed' && (
        <CompletedHero />
      )}
    </div>
  )
}

function IdleHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-8 text-center bg-gradient-to-br from-brand-50/60 via-white to-accent-50/30
                 dark:from-brand-950/30 dark:via-ink-900 dark:to-accent-950/20"
    >
      <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500
                      items-center justify-center text-white mb-4 shadow-soft">
        <Rocket size={28} />
      </div>
      <h2 className="text-2xl font-bold text-ink-900 dark:text-white mb-2">
        {WORKBENCH.idleHero}
      </h2>
      <p className="text-sm text-ink-600 dark:text-ink-300 max-w-xl mx-auto mb-6">
        {WORKBENCH.idleHeroSub}
      </p>
      <a
        href={APP_ROUTES.home}
        data-testid="wb-idle-cta-home"
        className="btn-primary h-10 px-6 inline-flex"
      >
        <Home size={14} /> {WORKBENCH.idleHeroCta}
      </a>
    </motion.div>
  )
}

function ConfiguringHero() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="card p-6 flex items-center gap-3"
    >
      <Loader2 size={20} className="text-brand-500 animate-spin" />
      <div>
        <div className="text-sm font-semibold text-ink-900 dark:text-white">
          {WORKBENCH.stateConfiguring}
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {WORKBENCH.execSummaryPlaceholderNext}
        </div>
      </div>
    </motion.div>
  )
}

function PausedHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="wb-state-paused-banner"
      className="card p-4 flex items-center gap-3 bg-amber-50/60 dark:bg-amber-950/20
                 border-amber-200/60 dark:border-amber-800/40"
    >
      <Pause size={18} className="text-amber-600 dark:text-amber-300" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {WORKBENCH.pausedBanner}
        </div>
        <div className="text-[10px] text-amber-700/80 dark:text-amber-300/70 mt-0.5">
          {WORKBENCH.pausedBannerHint}
        </div>
      </div>
    </motion.div>
  )
}

function FailedHero({ onRetry }: { onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="wb-state-failed-banner"
      className="card p-4 flex items-center gap-3 bg-rose-50/60 dark:bg-rose-950/20
                 border-rose-200/60 dark:border-rose-800/40"
    >
      <AlertTriangle size={18} className="text-rose-600 dark:text-rose-300" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">
          {WORKBENCH.failedBanner}
        </div>
        <div className="text-[10px] text-rose-700/80 dark:text-rose-300/70 mt-0.5">
          {WORKBENCH.failedBannerHint()}
        </div>
      </div>
      <button
        onClick={onRetry}
        data-testid="wb-state-failed-retry"
        className="btn-primary h-9 px-3"
      >
        <RefreshCcw size={14} /> {WORKBENCH.failedRetry}
      </button>
    </motion.div>
  )
}

function CancelledHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="wb-state-cancelled-banner"
      className="card p-4 flex items-center gap-3 bg-ink-100/60 dark:bg-ink-800/30
                 border-ink-300/60 dark:border-ink-700/40"
    >
      <XCircle size={18} className="text-ink-500" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-700 dark:text-ink-200">
          {WORKBENCH.cancelledBanner}
        </div>
      </div>
    </motion.div>
  )
}

function CompletedHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="wb-state-completed-banner"
      className="card p-4 flex items-center gap-3 bg-emerald-50/60 dark:bg-emerald-950/20
                 border-emerald-200/60 dark:border-emerald-800/40"
    >
      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-300" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
          {WORKBENCH.stateCompleted}
        </div>
      </div>
    </motion.div>
  )
}

// re-export for tests that import state
export type { WorkbenchState }
const StateHero = memo(StateHeroImpl)
export default StateHero
