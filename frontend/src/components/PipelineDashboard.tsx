/**
 * PipelineDashboard - real-time pipeline stage tracker.
 *
 * Implements: US-061
 */
import { useEffect, useState } from 'react'
import { PipelineStage, type PipelineStatus } from '../types'
import { Check, Loader2 } from 'lucide-react'

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

const STAGE_LABELS: Record<string, string> = {
  SEED_PARSING: 'Parse documents',
  GRAPH_BUILDING: 'Build knowledge graph',
  ENTITY_EXTRACTION: 'Extract entities',
  PROFILE_GENERATION: 'Generate agent profiles',
  CONFIG_GENERATION: 'Build simulation config',
  SIMULATION_RUNNING: 'Run simulation',
  REPORT_GENERATING: 'Generate report',
}

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
        if (data.stage) setCurrentStage(data.stage)
        if (data.progress !== undefined) setProgress(data.progress)
      } catch { /* ignore */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [runId, statusProp, currentStageProp])

  const currentIndex = STAGES.indexOf(currentStage as PipelineStage)
  const pct = Math.round(progress * 100)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {STAGES.map((stage, i) => {
          const isDone = i < currentIndex || currentStage === PipelineStage.COMPLETED
          const isActive = i === currentIndex && currentStage !== PipelineStage.COMPLETED
          return (
            <div key={stage} className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0
                ${isDone ? 'bg-green-500 text-white' :
                  isActive ? 'bg-brand-600 text-white animate-pulse' :
                  'bg-gray-200 text-gray-500'}`}>
                {isDone ? <Check size={14} /> : isActive ? <Loader2 size={14} className="animate-spin" /> : i + 1}
              </div>
              <div className={`text-sm ${isActive ? 'font-semibold text-gray-900' : isDone ? 'text-gray-700' : 'text-gray-400'}`}>
                {STAGE_LABELS[stage] || stage}
              </div>
            </div>
          )
        })}
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-brand-600 h-2 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
