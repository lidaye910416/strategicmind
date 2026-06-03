/**
 * Report view - display generated strategic report and chat with report agent.
 *
 * Implements: US-065
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, AlertCircle } from 'lucide-react'
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
      .catch((e) => setError(
        e?.response?.status === 404
          ? 'Report not found. Run a pipeline to generate one.'
          : 'Failed to load report.'
      ))
  }, [reportId])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card max-w-md border-red-200 bg-red-50">
          <div className="flex items-start gap-2 text-red-700">
            <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold mb-1">Cannot load report</h2>
              <p className="text-sm">{error}</p>
              <Link to="/" className="btn-ghost mt-3 inline-flex">
                <ArrowLeft size={16} /> Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading report {reportId}…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center gap-3 sticky top-0 z-10">
        <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <ArrowLeft size={16} /> Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Strategic Report</h1>
        <span className="badge bg-gray-100 text-gray-600">Run: {report.run_id}</span>
        {report.generated_at && (
          <span className="text-xs text-gray-500">
            Generated {new Date(report.generated_at).toLocaleString()}
          </span>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <article className="card prose prose-sm max-w-none">
          <ReactMarkdown>{report.content}</ReactMarkdown>
        </article>
        <ReportViewer
          reportId={reportId}
          reportContent={report.content}
          context={{ runId: report.run_id }}
        />
      </main>
    </div>
  )
}
