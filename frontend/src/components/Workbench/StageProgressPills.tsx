/**
 * StageProgressPills — compact 7-pill 状态条 (P5 增强)
 *
 * 给 SystemLogs 头部用, 24px 高, 与 StageProgressStrip 共用 store selector。
 */
import { memo } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { StageInfo, SimulationSub } from './stageProgress'

export interface StageProgressPillsProps {
  stages: StageInfo[]
  sub?: SimulationSub | null
  currentStage?: string
}

const STATUS_CLS: Record<StageInfo['status'], string> = {
  'done': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300/60',
  'active': 'bg-gradient-to-r from-brand-500 to-accent-500 text-white border-transparent',
  'pending': 'bg-ink-50/70 dark:bg-ink-900/50 text-ink-400 dark:text-ink-500 border-ink-200/60 dark:border-ink-800/60',
  'looping-active': 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-transparent',
  'failed': 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300/60',
  'cancelled': 'bg-ink-300/40 text-ink-500 dark:text-ink-500 border-ink-400/40',
}

function StageProgressPillsImpl({
  stages,
  sub,
  currentStage,
}: StageProgressPillsProps) {
  return (
    <div className="flex items-center gap-0.5" data-testid="wb-stage-pills" data-current={currentStage ?? ''}>
      {stages.map((s) => {
        const isCurrent = s.status === 'active' || s.status === 'looping-active' || s.status === 'failed' || s.status === 'cancelled'
        const showSub = s.id === 'SIMULATION_RUNNING' && sub && isCurrent
        return (
          <div
            key={s.id}
            data-testid={`wb-pill-${s.id}`}
            data-status={s.status}
            className={[
              'inline-flex items-center justify-center h-5 px-1 rounded',
              'text-[9px] font-mono font-bold border',
              showSub ? 'min-w-[40px]' : 'min-w-[18px]',
              STATUS_CLS[s.status],
            ].join(' ')}
            title={`${s.index + 1}. ${s.id}`}
          >
            {s.status === 'done' ? <Check size={8} /> :
             isCurrent ? <Loader2 size={8} className="animate-spin" /> :
             s.index + 1}
            {showSub && sub && (
              <span className="ml-0.5 text-[8px]">R{sub.round}/{sub.totalRounds}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const StageProgressPills = memo(StageProgressPillsImpl)
export default StageProgressPills
