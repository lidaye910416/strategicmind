/**
 * PipelineDashboard - real-time pipeline stage tracker (horizontal stepper).
 *
 * Implements: US-061
 */
import { useEffect, useState } from 'react'
import { PipelineStage, type PipelineStatus } from '../types'
import { Check, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { STAGE_LABELS, DASHBOARD, STATUS_LABELS } from '../i18n/zh'

interface Props {
  runId: string
  currentStage?: string
  progress?: number
  status?: PipelineStatus
}

const STAGES: PipelineStage[] = [
  PipelineStage.SEED_PARSING,
  PipelineStage.GRAPH_BUILDING,
  PipelineStage.ENTITY_EXTRACTION,
  PipelineStage.PROFILE_GENERATION,
  PipelineStage.CONFIG_GENERATION,
  PipelineStage.SIMULATION_RUNNING,
  PipelineStage.REPORT_GENERATING,
]

export default function PipelineDashboard({
  runId, currentStage: currentStageProp, progress: progressProp, status: statusProp,
}: Props) {
  const [currentStage, setCurrentStage] = useState<string>(currentStageProp || PipelineStage.SEED_PARSING)
  const [progress, setProgress] = useState<number>(progressProp || 0)

  useEffect(() => { if (currentStageProp) setCurrentStage(currentStageProp) }, [currentStageProp])
  useEffect(() => { if (progressProp !== undefined) setProgress(progressProp) }, [progressProp])

  useEffect(() => {
    if (statusProp || currentStageProp !== undefined) return
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        // Backend sends `current_stage` (not `stage`).
        const stage = data.current_stage ?? data.stage
        if (stage) setCurrentStage(stage)
        if (data.progress !== undefined) setProgress(data.progress)
        if (data.status && ['completed', 'failed', 'cancelled'].includes(data.status)) {
          es.close()
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => {
      // Let the EventSource auto-retry unless the run is already terminal.
      if (statusProp && ['completed', 'failed', 'cancelled'].includes(statusProp)) {
        es.close()
      }
    }
    return () => es.close()
  }, [runId, statusProp, currentStageProp])

  const currentIndex = STAGES.indexOf(currentStage as PipelineStage)
  const pct = Math.round(progress * 100)
  const completed = currentStage === PipelineStage.COMPLETED

  return (
    <div className="space-y-5">
      {/* Horizontal stepper */}
      <div className="relative">
        <div className="grid grid-cols-7 gap-1.5">
          {STAGES.map((stage, i) => {
            const isDone = i < currentIndex || completed
            const isActive = i === currentIndex && !completed
            return (
              <div key={stage} className="relative">
                <div className={`relative h-1.5 rounded-full overflow-hidden
                                 ${isDone ? 'bg-emerald-500' : isActive ? 'bg-brand-100 dark:bg-brand-900/40' : 'bg-ink-200/60 dark:bg-ink-800/60'}`}>
                  {isActive && (
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-500 to-accent-500
                                 progress-stripes"
                      initial={{ width: '20%' }}
                      animate={{ width: ['20%', '90%', '20%'] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </div>
                <div className="mt-2 flex flex-col items-start gap-1">
                  <div className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-semibold
                                  ${isDone
                                    ? 'bg-emerald-500 text-white shadow-soft'
                                    : isActive
                                      ? 'bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-glow'
                                      : 'bg-ink-100 dark:bg-ink-800 text-ink-400 dark:text-ink-500'}`}>
                    {isDone ? <Check size={12} /> : isActive ? <Loader2 size={11} className="animate-spin" /> : i + 1}
                  </div>
                  <div className={`text-[11px] leading-tight
                                  ${isActive ? 'font-semibold text-brand-700 dark:text-brand-300' : isDone ? 'text-ink-700 dark:text-ink-200' : 'text-ink-400 dark:text-ink-500'}`}>
                    {STAGE_LABELS[stage]?.split('').slice(0, 6).join('') || stage}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Current stage detail */}
      <div className="rounded-xl bg-gradient-to-br from-brand-50 to-accent-50/40
                      dark:from-brand-950/40 dark:to-accent-950/20
                      border border-brand-200/50 dark:border-brand-900/40
                      p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl inline-flex items-center justify-center
                        ${completed
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gradient-to-br from-brand-500 to-accent-500 text-white animate-pulse-soft'}`}>
          {completed ? <Check size={16} /> : <Loader2 size={15} className="animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-ink-500 dark:text-ink-400">当前阶段</div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white truncate">
            {STAGE_LABELS[currentStage] || currentStage}
          </div>
        </div>
        {statusProp && (
          <span className={`badge-${statusProp}`}>{STATUS_LABELS[statusProp] || statusProp}</span>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-ink-500 dark:text-ink-400 mb-1.5">
          <span className="font-medium">{DASHBOARD.progress}</span>
          <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">{pct}%</span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden bg-ink-200/60 dark:bg-ink-800/60">
          <motion.div
            className="h-full bg-gradient-to-r from-brand-500 via-brand-600 to-accent-500 progress-stripes"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
    </div>
  )
}
