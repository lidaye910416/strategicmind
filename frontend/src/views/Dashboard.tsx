import { useState } from 'react'
import { Upload, Settings, Play } from 'lucide-react'
import PipelineDashboard from '../components/PipelineDashboard'
import ConfigPanel from '../components/ConfigPanel'

export default function Dashboard() {
  const [showConfig, setShowConfig] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)

  const handleStartPipeline = () => {
    // Start pipeline logic
    setRunId('run_' + Date.now())
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>StrategicMind</h1>
        <button onClick={() => setShowConfig(!showConfig)}>
          <Settings size={20} />
        </button>
      </header>

      <main className="dashboard-main">
        <div className="upload-section">
          <div className="drop-zone">
            <Upload size={48} />
            <p>Drag & drop documents here</p>
            <p className="hint">.txt .md .pdf</p>
          </div>
        </div>

        {showConfig && <ConfigPanel />}

        {runId ? (
          <PipelineDashboard runId={runId} />
        ) : (
          <button className="start-btn" onClick={handleStartPipeline}>
            <Play size={20} />
            Start Pipeline
          </button>
        )}
      </main>
    </div>
  )
}
