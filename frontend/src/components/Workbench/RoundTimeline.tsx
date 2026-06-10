/**
 * RoundTimeline — Workbench redesign (T2.3)
 *
 * Horizontal rail of round cards, mounted at the top of the WorkbenchLayout.
 *   - 1 card per round, single row, 64-88px tall
 *   - Current round is enlarged and has a glowing magenta 2px ring (#E879F9)
 *   - Click a card -> emits onRoundSelect(runId, roundNum)
 *   - Card text: "Round N · X actions · Y shifts"
 *
 * Data source: store.simRounds (real SSE stream). Falls back to a
 * derived total count from snapshot.total_rounds if no sim rounds yet.
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.3
 */
import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Circle } from 'lucide-react'
import {
  useRunId,
  useSimRounds,
  useStatus,
} from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

export interface RoundTimelineProps {
  /** Currently selected round (controlled mode) */
  selectedRound?: number
  /** Currently active round (highlighted with glow) — defaults to last completed round */
  currentRound?: number
  /** Total rounds to render (overrides simRounds.length for skeleton mode) */
  totalRounds?: number
  /** Click handler */
  onRoundSelect?: (runId: string, roundNum: number) => void
  /** Test hook */
  dataTestId?: string
}

function RoundTimelineImpl({
  selectedRound,
  currentRound,
  totalRounds,
  onRoundSelect,
  dataTestId = 'wb-round-timeline',
}: RoundTimelineProps) {
  const runId = useRunId()
  const simRounds = useSimRounds()
  const status = useStatus()

  // Build a (round -> summary) lookup from the live simRounds stream
  const roundSummary = useMemo(() => {
    const m = new Map<number, { actions: number; shifts: number }>()
    for (const r of simRounds) {
      m.set(r.round, {
        actions: r.actions_count ?? r.actions?.length ?? 0,
        shifts:
          r.belief_shift_count ??
          r.belief_updates_count ??
          r.belief_updates?.length ??
          0,
      })
    }
    return m
  }, [simRounds])

  // Determine total: prefer explicit prop, else max(simRounds length + lookahead, 12)
  const total = Math.max(
    totalRounds ?? 0,
    simRounds.length > 0 ? simRounds.length : 0,
    12,
  )

  // Current (glowing) round: explicit prop > last completed sim round
  const inferredCurrent =
    simRounds.length > 0 ? simRounds[simRounds.length - 1].round : 0
  const activeRound = currentRound ?? inferredCurrent

  // Selected round for non-glowing visual emphasis
  const inferredSelected = selectedRound ?? activeRound
  const handleClick = (roundNum: number) => {
    if (!onRoundSelect) return
    // Pass empty runId if unknown (e.g. before pipeline started)
    onRoundSelect(runId ?? '', roundNum)
  }

  // Are we actively running? (used to apply pulsing on current round)
  const isLive = status === 'running' || status === 'paused'

  if (!runId) {
    return (
      <div
        data-testid={dataTestId}
        data-state="empty"
        className="h-20 flex items-center justify-center
                   text-xs text-ink-500 dark:text-ink-400
                   bg-ink-50/40 dark:bg-ink-900/40
                   border border-ink-200/60 dark:border-ink-800/60 rounded-lg"
      >
        <Loader2 size={12} className="animate-spin mr-1.5" />
        {WORKBENCH.roundTimelineEmpty}
      </div>
    )
  }

  return (
    <div
      data-testid={dataTestId}
      data-active-round={activeRound}
      data-selected-round={inferredSelected}
      data-total-rounds={total}
      className="h-20 flex items-stretch gap-1.5 px-2 overflow-x-auto nice-scroll"
      role="listbox"
      aria-label="Round timeline"
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((roundNum) => {
        const summary = roundSummary.get(roundNum)
        const isCurrent = roundNum === activeRound
        const isSelected = roundNum === inferredSelected
        const hasData = Boolean(summary)
        const actions = summary?.actions ?? 0
        const shifts = summary?.shifts ?? 0
        return (
          <motion.button
            key={roundNum}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-current={isCurrent ? 'true' : undefined}
            data-testid={`wb-round-card-${roundNum}`}
            data-current={isCurrent ? 'true' : 'false'}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleClick(roundNum)}
            className={[
              'flex-shrink-0 inline-flex flex-col items-center justify-center',
              'min-w-[88px] h-16 px-3 rounded-lg text-[11px] font-semibold',
              'border transition-all duration-150',
              isCurrent
                ? // current round: enlarged + glowing magenta 2px ring
                  'h-[68px] min-w-[104px] text-white border-transparent'
                : isSelected
                  ? 'bg-white dark:bg-ink-800 text-ink-900 dark:text-white border-brand-400 dark:border-brand-500'
                  : 'bg-ink-50/70 dark:bg-ink-900/50 text-ink-700 dark:text-ink-200 border-ink-200/60 dark:border-ink-800/60 hover:border-brand-300',
              isCurrent && isLive ? 'animate-pulse-soft' : '',
            ].join(' ')}
            style={
              isCurrent
                ? {
                    background: 'linear-gradient(135deg,#E879F9 0%,#a855f7 100%)',
                    boxShadow: '0 0 0 2px #E879F9, 0 0 14px 2px rgba(232,121,249,0.45)',
                  }
                : undefined
            }
            title={WORKBENCH.roundTimelineCardText(roundNum, actions, shifts)}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono">
              {isCurrent ? (
                <Circle size={8} className="fill-white text-white" />
              ) : hasData ? (
                <Circle size={8} className="fill-emerald-500 text-emerald-500" />
              ) : (
                <Circle size={8} className="fill-ink-300 text-ink-300" />
              )}
              R{roundNum}
            </div>
            <div className="text-[10px] font-mono opacity-90 mt-0.5 truncate max-w-[88px]">
              {hasData ? `${actions} 行动 · ${shifts} 漂移` : '— · —'}
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}

const RoundTimeline = memo(RoundTimelineImpl)
export default RoundTimeline
