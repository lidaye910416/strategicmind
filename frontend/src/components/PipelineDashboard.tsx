import { useEffect, useState } from 'react'
import { PipelineStage } from '../types'

interface Props {
  runId: string
}

const STAGES = [
  PipelineStage.SEED_PARSING,
  PipelineStage.GRAPH_BUILDING,
  PipelineStage.ENTITY_EXTRACTION,
  PipelineStage.PROFILE_GENERATION,
  PipelineStage.CONFIG_GENERATION,
  PipelineStage.SIMULATION_RUNNING,
  PipelineStage.REPORT_GENERATING,
]

export default function PipelineDashboard({ runId }: Props) {
  const [currentStage, setCurrentStage] = useState(PipelineStage.SEED_PARSING)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // SSE connection for real-time updates
    const eventSource = new EventSource(`/api/pipeline/${runId}/events`)
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.stage) setCurrentStage(data.stage)
      if (data.progress) setProgress(data.progress)
    }

    return () => eventSource.close()
  }, [runId])

  const currentIndex = STAGES.indexOf(currentStage)

  return (
    <div className="pipeline-dashboard">
      <h2>Pipeline Progress</h2>
      
      <div className="stage-stepper">
        {STAGES.map((stage, index) => (
          <div
            key={stage}
            className={`stage-item ${
              index < currentIndex ? 'completed' :
              index === currentIndex ? 'active' : 'pending'
            }`}
          >
            <div className="stage-marker">{index < currentIndex ? '✓' : index + 1}</div>
            <div className="stage-label">{stage.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <p className="progress-text">{Math.round(progress * 100)}% complete</p>
    </div>
  )
}
