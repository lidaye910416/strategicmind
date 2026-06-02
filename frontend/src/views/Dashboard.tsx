/**
 * Dashboard - upload documents, configure pipeline, start a run.
 *
 * Implements: US-059, US-060, US-062
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Settings, FileText, CheckCircle2, Loader2 } from 'lucide-react'
import DocumentUploader from '../components/DocumentUploader'
import PipelineDashboard from '../components/PipelineDashboard'
import { usePipelineStore } from '../store/pipeline'

export default function Dashboard() {
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<'executive' | 'technical' | 'narrative'>('executive')
  const [uploads, setUploads] = useState<{ id: string; filename: string }[]>([])

  const {
    runId,
    status,
    currentStage,
    progress,
    error,
    startPipeline,
    pause,
    resume,
    cancel,
    reset,
  } = usePipelineStore()

  const handleStart = async () => {
    const id = await startPipeline({
      simulation_hours: hours,
      report_style: style,
      doc_ids: uploads.map((u) => u.id),
    })
    if (id) {
      // Navigate to simulation view for richer monitoring
      // (caller can also stay here and watch PipelineDashboard)
      // navigate(`/simulation/${id}`)
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>StrategicMind</h1>
        <button onClick={() => setShowConfig((v) => !v)} title="Toggle config">
          <Settings size={20} />
        </button>
      </header>

      <main className="dashboard-main">
        <section className="upload-section">
          <h2><FileText size={20} /> 1. Upload Seed Documents</h2>
          <DocumentUploader onUploaded={(doc) =>
            setUploads((prev) => [...prev, doc])
          } />
          {uploads.length > 0 && (
            <ul className="uploaded-list">
              {uploads.map((u) => (
                <li key={u.id}>
                  <CheckCircle2 size={14} color="#4caf50" /> {u.filename}
                </li>
              ))}
            </ul>
          )}
        </section>

        {showConfig && (
          <section className="config-section">
            <h2>2. Configuration</h2>
            <div className="config-grid">
              <label>
                Simulation Hours: {hours}h
                <input
                  type="range" min={24} max={168} value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </label>
              <label>
                Report Style:
                <select value={style} onChange={(e) => setStyle(e.target.value as any)}>
                  <option value="executive">Executive Summary</option>
                  <option value="technical">Technical Analysis</option>
                  <option value="narrative">Narrative Report</option>
                </select>
              </label>
            </div>
          </section>
        )}

        <section className="start-section">
          <h2>3. Run Pipeline</h2>
          {error && <p className="error">⚠ {error}</p>}
          {!runId && (
            <button
              className="start-btn"
              onClick={handleStart}
              disabled={uploads.length === 0}
            >
              <Play size={20} /> Start Pipeline
            </button>
          )}
          {runId && (
            <div className="run-controls">
              <PipelineDashboard
                runId={runId}
                currentStage={currentStage}
                progress={progress}
                status={status}
              />
              <div className="control-buttons">
                {status === 'running' && <button onClick={pause}>⏸ Pause</button>}
                {status === 'paused' && <button onClick={resume}>▶ Resume</button>}
                {(status === 'running' || status === 'paused') && (
                  <button onClick={cancel}>✕ Cancel</button>
                )}
                {status === 'completed' && (
                  <Link to={`/report/${runId}`} className="btn primary">
                    View Report →
                  </Link>
                )}
                <button onClick={() => { reset(); setUploads([]) }}>New Run</button>
                {status === 'running' && (
                  <Link to={`/simulation/${runId}`} className="btn">
                    Open Live View
                  </Link>
                )}
                {status === 'running' && <Loader2 className="spin" size={16} />}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
