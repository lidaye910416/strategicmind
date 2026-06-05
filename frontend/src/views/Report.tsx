/**
 * 报告视图 - 展示生成好的战略推演报告，并支持与报告助手对话。
 *
 * Implements: US-065
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, AlertCircle, Loader2, ArrowUpRight, FileBarChart, Sparkles,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import ReportViewer from '../components/ReportViewer'
import api from '../services/api'
import Hero from '../components/layout/Hero'
import { REPORT, COMMON, APP_ROUTES } from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'

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
          ? COMMON.notFoundHint
          : COMMON.loadFailed
      ))
  }, [reportId])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card max-w-md border-red-300/60 bg-red-50/80 dark:bg-red-950/30
                     dark:border-red-900/60 p-6"
        >
          <div className="flex items-start gap-3 text-red-700 dark:text-red-300">
            <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold mb-1">{COMMON.cannotLoadReport}</h2>
              <p className="text-sm">{error}</p>
              <Link to={APP_ROUTES.home} className="btn-ghost mt-4 inline-flex h-9">
                <ArrowLeft size={14} /> {COMMON.backToDashboard}
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-500">
        <Loader2 className="animate-spin mr-2" size={20} />
        {COMMON.loadingReport(reportId)}
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Hero
        eyebrow={`报告 · ${report.run_id}`}
        title={REPORT.title}
        subtitle={report.generated_at
          ? REPORT.generatedAt(new Date(report.generated_at).toLocaleString())
          : '战略推演结果 · 可在下方与报告助手对话追问细节'}
        rightSlot={
          <div className="flex items-center gap-2">
            <Link to={APP_ROUTES.home} className="btn-ghost h-9">
              <ArrowLeft size={14} /> {COMMON.backToDashboard}
            </Link>
            <Link to={APP_ROUTES.simulation(report.run_id)} className="btn-ghost h-9">
              <FileBarChart size={14} /> 推演过程
            </Link>
            <a
              href={`/api/report/${reportId}/save`}
              className="btn-primary h-9"
              target="_blank" rel="noreferrer"
            >
              <Sparkles size={14} /> 导出 <ArrowUpRight size={12} />
            </a>
          </div>
        }
      />

      <motion.div
        variants={stagger(0.07)}
        initial="initial"
        animate="animate"
        className="px-6 md:px-10 pb-16 space-y-5 max-w-4xl"
      >
        <motion.article
          variants={fadeUp}
          className="card p-7 prose prose-sm max-w-none
                     bg-white/90 dark:bg-ink-900/60
                     shadow-card"
        >
          <ReactMarkdown>{report.content}</ReactMarkdown>
        </motion.article>
        <motion.div variants={fadeUp}>
          <ReportViewer
            reportId={reportId}
            reportContent={report.content}
            context={{ runId: report.run_id }}
          />
        </motion.div>
      </motion.div>
    </div>
  )
}
