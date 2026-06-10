/**
 * ExecSummary — Workbench redesign (T2.5)
 *
 * Two-line "executive summary" mounted at the top of the WorkbenchLayout:
 *   Line 1: "Round N 刚发生了什么" (what just happened in Round N)
 *   Line 2: "下一轮预告" (what's next)
 *
 *  - 16-20px type
 *  - Fixed height (no layout shift on round_completed)
 *  - Updates on round_completed (SSE sim_rounds stream)
 *  - Falls back to placeholder text when no data
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.5
 */
import { memo, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useSimRounds, useMarketEvents, useActiveShock } from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

export interface ExecSummaryProps {
  /** Override the highlighted round */
  currentRound?: number
  dataTestId?: string
}

function summarizeRound(round: {
  round: number
  actions_count?: number
  belief_shift_count?: number
  belief_updates_count?: number
  actions?: any[]
  belief_updates?: any[]
  new_entities?: any[]
}): string {
  const actions = round.actions_count ?? round.actions?.length ?? 0
  const shifts =
    round.belief_shift_count ??
    round.belief_updates_count ??
    round.belief_updates?.length ??
    0
  const emerged = round.new_entities?.length ?? 0
  if (actions === 0 && shifts === 0 && emerged === 0) {
    return `${WORKBENCH.roundTimelineCardText(round.round, 0, 0)} · 等待更多数据`
  }
  return `${WORKBENCH.roundTimelineCardText(round.round, actions, shifts)}${emerged > 0 ? ` · 涌现 ${emerged} 个实体` : ''}`
}

function nextEventHint(
  marketEventCount: number,
  latestShock: { factor_name: string; severity: number } | null,
): string {
  if (latestShock) {
    return `外部冲击: ${latestShock.factor_name}（严重度 ${(latestShock.severity * 100).toFixed(0)}%）`
  }
  if (marketEventCount > 0) {
    return `已有 ${marketEventCount} 条市场事件流入，下一轮将继续推演`
  }
  return WORKBENCH.execSummaryPlaceholderNext
}

function ExecSummaryImpl({
  currentRound,
  dataTestId = 'wb-exec-summary',
}: ExecSummaryProps) {
  const simRounds = useSimRounds()
  const marketEvents = useMarketEvents()
  const activeShock = useActiveShock()

  // Last completed round (highlight target)
  const lastRound = simRounds.length > 0 ? simRounds[simRounds.length - 1] : null
  const focusRound = currentRound != null
    ? simRounds.find((r) => r.round === currentRound) ?? lastRound
    : lastRound

  const happened = useMemo(() => {
    if (!focusRound) return WORKBENCH.execSummaryPlaceholderHappened
    return summarizeRound(focusRound)
  }, [focusRound])

  const next = useMemo(
    () => nextEventHint(marketEvents.length, activeShock),
    [marketEvents.length, activeShock],
  )

  return (
    <div
      data-testid={dataTestId}
      data-current-round={focusRound?.round ?? 0}
      className="card p-4 min-h-[88px] flex flex-col justify-center"
    >
      {/* Line 1: what just happened (16-20px) */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          <span className="inline-flex items-center justify-center
                            w-7 h-7 rounded-md
                            bg-gradient-to-br from-brand-500 to-accent-500
                            text-white text-[10px] font-bold">
            {focusRound ? focusRound.round : '–'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500 dark:text-ink-400">
            {focusRound
              ? WORKBENCH.execSummaryWhatHappened(focusRound.round)
              : WORKBENCH.execSummaryPlaceholderHappened}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`happened-${focusRound?.round ?? 0}-${happened}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              data-testid="wb-exec-summary-happened"
              className="text-[17px] sm:text-[18px] leading-snug
                         font-semibold text-ink-900 dark:text-white mt-0.5"
            >
              {happened}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Line 2: what's next */}
      <div className="mt-2 flex items-start gap-2 pl-9">
        <ChevronRight size={12} className="text-ink-400 mt-1.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-ink-500 dark:text-ink-400">
            {WORKBENCH.execSummaryWhatNext}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`next-${next}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              data-testid="wb-exec-summary-next"
              className="text-[15px] sm:text-[16px] leading-snug
                         text-ink-700 dark:text-ink-200 mt-0.5"
            >
              {next}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

const ExecSummary = memo(ExecSummaryImpl)
export default ExecSummary
