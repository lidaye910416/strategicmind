/**
 * Report view - display generated strategic report and chat with report agent.
 *
 * Implements: US-065
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import ReportViewer from '../components/ReportViewer'
import api from '../services/api'

interface ReportData {
  report_id: string
  run_id: string
  content: string
  generated_at?: string
}

export default function Report() {
  const { reportId = '' } = useParams<{ reportId: string }>()
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!reportId) return
    api.get(`/report/${reportId}`)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e?.response?.status === 404
        ? 'Report not found. Run a pipeline to generate one.'
        : 'Failed to load report.'))
  }, [reportId])

  if (error) {
    return (
      <div className="report-view">
        <Link to="/">← Dashboard</Link>
        <p className="error">{error}</p>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="report-view">
        <Link to="/">← Dashboard</Link>
        <p>Loading report {reportId}…</p>
      </div>
    )
  }

  return (
    <div className="report-view">
      <header className="view-header">
        <Link to="/"><ArrowLeft size={16} /> Dashboard</Link>
        <h1>Strategic Report: {report.run_id}</h1>
        {report.generated_at && (
          <span className="meta">Generated {new Date(report.generated_at).toLocaleString()}</span>
        )}
      </header>

      <article className="report-article">
        <ReactMarkdown>{report.content}</ReactMarkdown>
      </article>

      <ReportViewer
        reportId={reportId}
        reportContent={report.content}
        context={{ runId: report.run_id }}
      />
    </div>
  )
}
