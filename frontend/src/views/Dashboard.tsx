/**
 * Dashboard - upload documents, configure pipeline, start a run.
 *
 * Implements: US-059, US-060, US-062
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Settings, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import DocumentUploader from '../components/DocumentUploader'
import PipelineDashboard from '../components/PipelineDashboard'
import { usePipelineStore } from '../store/pipeline'

export default function Dashboard() {
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<'executive' | 'technical' | 'narrative'>('executive')
  const [uploads, setUploads] = useState<{ id: string; docId: string; filename: string }[]>([])

  const {
    runId, status, currentStage, progress, error,
    startPipeline, pause, resume, cancel, reset,
  } = usePipelineStore()

  const handleStart = async () => {
    await startPipeline({
      simulation_hours: hours,
      report_style: style,
      doc_ids: uploads.map((u) => u.docId).filter(Boolean),
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-brand-500 to-brand-700" />
          <h1 className="text-xl font-semibold text-gray-900">StrategicMind</h1>
          <span className="badge bg-gray-100 text-gray-600">v0.1</span>
        </div>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="btn-ghost"
          title="Toggle configuration"
        >
          <Settings size={16} /> Config
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="card border-red-200 bg-red-50 flex items-start gap-2 text-red-700">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {/* Step 1: Upload */}
        <section className="card space-y-3">
          <div className="flex items-center gap-2 text-gray-900">
            <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-semibold">1</span>
            <h2 className="font-semibold">Upload seed documents</h2>
          </div>
          <DocumentUploader onUploaded={(doc) =>
            setUploads((prev) => [...prev, doc])
          } />
          {uploads.length > 0 && (
            <ul className="space-y-1 mt-2">
              {uploads.map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-sm text-gray-600">
                  <CheckCircle2 size={14} className="text-green-500" /> {u.filename}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Step 2: Config (optional) */}
        {showConfig && (
          <section className="card space-y-3">
            <div className="flex items-center gap-2 text-gray-900">
              <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-semibold">2</span>
              <h2 className="font-semibold">Configuration</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Simulation hours: <span className="font-bold text-brand-700">{hours}h</span></label>
                <input
                  type="range" min={24} max={168} value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="label">Report style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as any)}
                  className="input"
                >
                  <option value="executive">Executive Summary</option>
                  <option value="technical">Technical Analysis</option>
                  <option value="narrative">Narrative Report</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Step 3: Run */}
        <section className="card space-y-3">
          <div className="flex items-center gap-2 text-gray-900">
            <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-semibold">3</span>
            <h2 className="font-semibold">Run pipeline</h2>
            {status !== 'idle' && (
              <span className={`badge-${status}`}>{status}</span>
            )}
          </div>

          {!runId && (
            <button
              className="btn-primary"
              onClick={handleStart}
              disabled={uploads.length === 0}
            >
              <Play size={16} /> Start Pipeline
            </button>
          )}
          {uploads.length === 0 && !runId && (
            <p className="text-sm text-gray-500">
              Upload at least one document to enable the pipeline.
            </p>
          )}

          {runId && (
            <div className="space-y-3">
              <PipelineDashboard
                runId={runId}
                currentStage={currentStage}
                progress={progress}
                status={status}
              />
              <div className="flex flex-wrap gap-2">
                {status === 'running' && (
                  <button className="btn-ghost" onClick={pause}>⏸ Pause</button>
                )}
                {status === 'paused' && (
                  <button className="btn-primary" onClick={resume}>▶ Resume</button>
                )}
                {(status === 'running' || status === 'paused') && (
                  <button className="btn-danger" onClick={cancel}>✕ Cancel</button>
                )}
                {status === 'completed' && (
                  <Link to={`/report/${runId}`} className="btn-primary">
                    View Report →
                  </Link>
                )}
                <button className="btn-ghost" onClick={() => { reset(); setUploads([]) }}>
                  New Run
                </button>
                {status === 'running' && (
                  <Link to={`/simulation/${runId}`} className="btn-ghost">
                    Live View
                  </Link>
                )}
                {status === 'running' && <Loader2 className="animate-spin text-brand-600 self-center" size={16} />}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
