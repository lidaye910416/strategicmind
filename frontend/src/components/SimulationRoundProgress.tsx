/**
 * SimulationRoundProgress - Real-time round counter
 * Implements: US-063
 */
import { motion } from 'framer-motion'
import { SIMULATION } from '../i18n/zh'

interface Props { currentRound: number; totalRounds: number; activeAgents: number }

export default function SimulationRoundProgress({ currentRound, totalRounds, activeAgents }: Props) {
  const pct = totalRounds > 0 ? (currentRound / totalRounds) * 100 : 0
  return (
    <div className="card p-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        <div>
          <div className="text-xs text-ink-500 dark:text-ink-400 uppercase tracking-wider font-medium">
            {SIMULATION.round}
          </div>
          <div className="text-3xl font-bold text-ink-900 dark:text-white tabular-nums mt-1">
            {currentRound}
            <span className="text-base text-ink-400 dark:text-ink-500 font-normal"> / {totalRounds}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-500 dark:text-ink-400 uppercase tracking-wider font-medium">
            {SIMULATION.activeAgents}
          </div>
          <div className="text-3xl font-bold text-brand-600 dark:text-brand-400 tabular-nums mt-1">
            {activeAgents}
          </div>
        </div>
        <div className="col-span-2 md:col-span-1 flex items-center">
          <div className="w-full">
            <div className="text-xs text-ink-500 dark:text-ink-400 mb-1.5 uppercase tracking-wider font-medium">
              {SIMULATION.progress}
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden bg-ink-200/60 dark:bg-ink-800/60">
              <motion.div
                className="h-full bg-gradient-to-r from-brand-500 to-accent-500 progress-stripes"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-1 font-mono">
              {pct.toFixed(0)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
