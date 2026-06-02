/**
 * PipelineDashboard - real-time pipeline stage tracker.
 *
 * Implements: US-061
 */
import { useEffect, useState } from 'react'
import { PipelineStage, type PipelineStatus } from '../types'

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
  runId,
  currentStage: currentStageProp,
  progress: progressProp,
  status: statusProp,
}: Props) {
  const [currentStage, setCurrentStage] = useState<string>(currentStageProp || PipelineStage.SEED_PARSING)
  const [progress, setProgress] = useState<number>(progressProp || 0)

  useEffect(() => {
    if (currentStageProp) setCurrentStage(currentStageProp)
  }, [currentStageProp])

  useEffect(() => {
    if (progressProp !== undefined) setProgress(progressProp)
  }, [progressProp])

  useEffect(() => {
    // SSE fallback for when component is used without store (e.g. live view)
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

  return (
    <div className="pipeline-dashboard">
      <h3>Pipeline Progress</h3>

      <div className="stage-stepper">
        {STAGES.map((stage, index) => (
          <div
            key={stage}
            className={`stage-item ${
              index < currentIndex ? 'completed' :
              index === currentIndex ? 'active' : 'pending'
            }`}
          >
            <div className="stage-marker">
              {index < currentIndex ? '✓' : index === currentIndex ? '●' : index + 1}
            </div>
            <div className="stage-label">{stage.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="progress-text">{Math.round(progress * 100)}% complete</p>

      {statusProp && (
        <p className="status-text">Status: <strong>{statusProp}</strong></p>
      )}
    </div>
  )
}
