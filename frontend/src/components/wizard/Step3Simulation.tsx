/**
 * Step3 — Simulation: SIMULATION_RUNNING.
 *
 * Renders a round counter + last-round payload snapshot. Uses atomic
 * selectors so unrelated store mutations do not re-render the step.
 */
import { useMemo } from 'react'
import StepHeader, { type StepStatus } from './StepHeader'
import {
  useSimRounds,
  useStatus,
  useGraphNodes,
  useMarketEvents,
} from '../../store/pipeline'

export interface Step3SimulationProps {
  testId?: string
}

export default function Step3Simulation({ testId }: Step3SimulationProps) {
  const rounds = useSimRounds() as any[]
  const status = useStatus()
  const nodes = useGraphNodes()
  const marketEvents = useMarketEvents() as any[]

  const derived = useMemo<StepStatus>(() => {
    if (status === 'failed') return 'failed'
    if (status === 'completed') return 'done'
    if (status === 'running' || (rounds && rounds.length > 0)) return 'running'
    return 'idle'
  }, [status, rounds])

  const lastRound = rounds && rounds.length > 0 ? rounds[rounds.length - 1] : null
  const roundCount = rounds?.length ?? 0
  const lastRoundNum = lastRound?.round ?? lastRound?.round_num ?? '—'

  return (
    <div data-testid={testId ?? 'step-3'}>
      <StepHeader
        step={3}
        title="模拟推演"
        subtitle="多轮博弈、信念漂移、市场扰动"
        status={derived}
        testId="step-3-header"
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Rounds</div>
          <div
            data-testid="step-3-rounds"
            className="text-2xl font-bold text-ink-900 dark:text-ink-100"
          >
            {roundCount}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Last Round</div>
          <div className="text-2xl font-bold text-ink-900 dark:text-ink-100">
            {lastRoundNum}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Entities</div>
          <div className="text-2xl font-bold text-ink-900 dark:text-ink-100">
            {nodes.length}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Market Events</div>
          <div className="text-2xl font-bold text-ink-900 dark:text-ink-100">
            {marketEvents?.length ?? 0}
          </div>
        </div>
      </div>
    </div>
  )
}
