/**
 * BeliefShiftFeed - 信念漂移事件流 (should-tier v3)
 *
 * 数据源: store.beliefShifts (后端 SSE belief_shift emit 时 append, 节流 500ms)
 * 显示: 最近 10 次立场漂移, 每条显示 agent_id / 漂移量 / topic
 *
 * 与 must-tier v1 BeliefEvolutionChart 区别: Chart 是趋势曲线 (按 agent 维度),
 * Feed 是事件流 (按时间倒序, 类似 Twitter feed).
 */
import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, Activity, User } from 'lucide-react'
import { useBeliefShifts } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'

export default function BeliefShiftFeed() {
  const shifts = useBeliefShifts()
  const recent = useMemo(() => (shifts ?? []).slice(0, 10), [shifts])

  if (recent.length === 0) {
    return (
      <div
        data-testid="belief-shift-feed-empty"
        className="card p-4 flex items-center gap-2 text-[11px] text-ink-500 dark:text-ink-400"
      >
        <div className="w-9 h-9 rounded-lg bg-ink-100 dark:bg-ink-800/60 inline-flex items-center justify-center text-ink-400">
          <Activity size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.beliefShiftFeedTitle}
          </div>
          <div className="text-[11px] mt-0.5">{WORKBENCH.beliefShiftFeedEmpty}</div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="belief-shift-feed" className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
          <Activity size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.beliefShiftFeedTitle}
          </div>
          <div className="text-[11px] text-ink-600 dark:text-ink-300 font-semibold">
            {WORKBENCH.beliefShiftFeedSubtitle(recent.length)}
          </div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto nice-scroll">
        <AnimatePresence initial={false}>
          {recent.map((s, i) => {
            const isPositive = (s.new_value ?? 0) > (s.old_value ?? 0)
            const arrow = isPositive ? ArrowRight : ArrowLeft
            const color = Math.abs(s.delta) > 0.5
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-amber-600 dark:text-amber-400'
            const Icon = arrow
            return (
              <motion.div
                key={`${s.ts}-${s.agent_id}-${i}`}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-ink-50/40 dark:bg-ink-900/30 border border-ink-200/40 dark:border-ink-800/40"
              >
                <div className="w-6 h-6 rounded bg-white dark:bg-ink-800 inline-flex items-center justify-center text-ink-500 shrink-0">
                  <User size={10} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-ink-800 dark:text-ink-100 truncate">
                    {s.agent_id}
                  </div>
                  {s.topic && (
                    <div className="text-[10px] text-ink-500 dark:text-ink-400 truncate">
                      {s.topic}
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-0.5 text-[11px] font-mono font-bold tabular-nums ${color}`}>
                  <Icon size={10} />
                  {Math.abs(s.delta).toFixed(2)}
                </div>
                {s.round != null && (
                  <span className="text-[9px] font-mono text-ink-400 px-1 rounded bg-ink-100 dark:bg-ink-800">
                    R{s.round}
                  </span>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
