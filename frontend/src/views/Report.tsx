/**
 * 报告视图 - 展示生成好的战略推演报告，并支持与报告助手对话。
 *
 * Implements: US-065
 * PR-2 P1-7：加 ReportTOC 侧栏 + 战略建议章节高亮 + markdown h2 注入 slug id。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, AlertCircle, Loader2, ArrowUpRight, FileBarChart, Sparkles,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import ReportViewer from '../components/ReportViewer'
import ReportTOC, { slugify } from '../components/ReportTOC'
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

/** "战略建议"等关键词：在 TOC 高亮 + 正文背景着色 */
const HIGHLIGHT_KEYWORDS = ['战略建议', '建议', '行动清单']

/** 把 markdown heading children 转成纯文本（react-markdown 给出的 children 是 ReactNode） */
function nodeToText(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (node.props && node.props.children) return nodeToText(node.props.children)
  return ''
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

  // 跨渲染共享 slug 计数（避免同名 heading 撞 id）。重新加载 report 时重置。
  const slugSeenRef = useMemo(
    () => ({ map: new Map<string, number>() }),
    [report?.report_id],
  )

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
        className="px-6 md:px-10 pb-16 max-w-6xl mx-auto"
      >
        {/* PR-2 P1-7：左侧 sticky TOC + 右侧正文 */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
          {/* 目录侧栏（窄屏自动降级为 dropdown） */}
          <div>
            <ReportTOC content={report.content} highlightKeywords={HIGHLIGHT_KEYWORDS} />
          </div>

          {/* 正文 + 助手对话 */}
          <div className="space-y-5 min-w-0">
            <motion.article
              variants={fadeUp}
              className="card p-7 prose prose-sm max-w-none
                         bg-white/90 dark:bg-ink-900/60
                         shadow-card"
            >
              <ReactMarkdown
                components={{
                  // 注入和 ReportTOC.slugify 一致的 id；高亮关键章节
                  h2: ({ children, ...rest }) => {
                    const text = nodeToText(children).trim() || '章节'
                    let id = slugify(text)
                    const n = (slugSeenRef.map.get(id) || 0) + 1
                    slugSeenRef.map.set(id, n)
                    if (n > 1) id = `${id}-${n}`
                    const hi = HIGHLIGHT_KEYWORDS.some((kw) => text.includes(kw))
                    return (
                      <h2
                        id={id}
                        className={`scroll-mt-28 ${
                          hi
                            ? 'relative -mx-3 px-3 py-1 rounded-lg bg-gradient-to-r from-amber-100/80 to-amber-50/40 dark:from-amber-900/40 dark:to-amber-950/20 border-l-4 border-amber-500'
                            : ''
                        }`}
                        {...rest}
                      >
                        {hi && <span className="mr-2" aria-hidden="true">★</span>}
                        {children}
                      </h2>
                    )
                  },
                  // h3 同样支持锚点（与 ReportTOC 一致）
                  h3: ({ children, ...rest }) => {
                    const text = nodeToText(children).trim() || '节'
                    let id = slugify(text)
                    const n = (slugSeenRef.map.get(id) || 0) + 1
                    slugSeenRef.map.set(id, n)
                    if (n > 1) id = `${id}-${n}`
                    return <h3 id={id} className="scroll-mt-28" {...rest}>{children}</h3>
                  },
                }}
              >
                {report.content}
              </ReactMarkdown>
            </motion.article>
            <motion.div variants={fadeUp}>
              <ReportViewer
                reportId={reportId}
                reportContent={report.content}
                context={{ runId: report.run_id }}
              />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
