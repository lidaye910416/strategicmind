/**
 * 报告视图 - 展示生成好的战略推演报告，并支持与报告助手对话。
 *
 * Implements: US-065
 * PR-2 P1-7：加 ReportTOC 侧栏 + 战略建议章节高亮 + markdown h2 注入 slug id。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, AlertCircle, Loader2, ArrowUpRight, FileBarChart, Download,
  Lightbulb, ArrowRight, CheckCircle2, Circle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import ReportViewer from '../components/ReportViewer'
import ReportTOC, { slugify } from '../components/ReportTOC'
import api from '../services/api'
import Hero from '../components/layout/Hero'
import { REPORT, REPORT_ACTIONS, COMMON, APP_ROUTES } from '../i18n/zh'
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
  const navigate = useNavigate()
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  // P1-18: 行动清单勾选状态（按文本 hash 存）
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // P1-18: 解析 markdown 中的 "- [ ]" / "- [x]" 行动项
  // 返回 { text, checked }[]；不修改原 markdown
  const actionItems = useMemo(() => {
    if (!report?.content) return []
    const re = /^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/gm
    const out: { text: string; checked: boolean; key: string }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(report.content)) !== null) {
      const text = m[2].trim()
      const isChecked = m[1] !== ' '
      out.push({ text, checked: isChecked, key: `a-${out.length}-${text.slice(0, 12)}` })
    }
    return out
  }, [report?.content])

  // P1-13: 从报告 markdown 抽取一行作为派生议题的种子
  // 策略：找第一个编号列表项 / 战略建议 / 关键发现 行
  const deriveTopic = useMemo(() => {
    if (!report?.content) return ''
    const lines = report.content.split('\n')
    // 优先级 1: "## 战略建议" 之后的第一条要点
    const suggestIdx = lines.findIndex((l) => /战略建议|行动建议|下一步建议|关键建议/.test(l))
    const searchFrom = suggestIdx >= 0 ? suggestIdx + 1 : 0
    for (let i = searchFrom; i < lines.length; i++) {
      const l = lines[i].trim()
      // 跳过空行 / 标题 / 列表符
      if (!l) continue
      if (l.startsWith('#')) continue
      const m = l.match(/^(?:\d+[.、]|[-*])\s*(.+)/)
      if (m) return m[1].replace(/[*_`]/g, '').slice(0, 80)
      if (l.length >= 8) return l.replace(/[*_`]/g, '').slice(0, 80)
    }
    return ''
  }, [report?.content])

  const goDeriveTopic = () => {
    if (!report) return
    const topic = deriveTopic || `${report.run_id} 后续行动`
    navigate(`${APP_ROUTES.workbenchWithRun(report.run_id)}?prefill=${encodeURIComponent(topic)}`)
  }

  const goToWorkbenchWithTopic = (text: string) => {
    if (!report) return
    navigate(`${APP_ROUTES.workbenchWithRun(report.run_id)}?prefill=${encodeURIComponent(text)}`)
  }

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
        // 报告日期 = 今日 (用户要求"日期什么的也必须是今天的", 不依赖后端 generated_at 秒/毫秒混淆)
        subtitle={REPORT.generatedAt(new Date().toLocaleString('zh-CN', { hour12: false }))}
        rightSlot={
          <div className="flex items-center gap-2">
            <Link to={APP_ROUTES.home} className="btn-ghost h-9">
              <ArrowLeft size={14} /> {COMMON.backToDashboard}
            </Link>
            <Link to={APP_ROUTES.simulation(report.run_id)} className="btn-ghost h-9">
              <FileBarChart size={14} /> 推演过程
            </Link>
            {/* P1-13: 派生新议题 — 跳 Workbench 预填议题 */}
            <button
              onClick={goDeriveTopic}
              className="btn-ghost h-9"
              title={deriveTopic
                ? `基于本报告建议: ${deriveTopic}`
                : '基于本报告生成新议题'}
            >
              <Lightbulb size={14} /> {REPORT_ACTIONS.deriveNewTopic}
            </button>
            <a
              href={`/api/report/${reportId}/save`}
              className="btn-primary h-9"
              target="_blank" rel="noreferrer"
              aria-label="导出 Markdown"
            >
              <Download size={14} /> 导出 Markdown <ArrowUpRight size={12} />
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

          {/* 正文 + 行动清单 + 助手对话 */}
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

            {/* P1-18: 行动清单 — 解析 markdown 中的 - [ ] 渲染为可勾选 + 跳 Workbench 预填 */}
            {actionItems.length > 0 && (
              <motion.section
                variants={fadeUp}
                className="card p-6 bg-gradient-to-br from-brand-50/40 to-accent-50/20
                           dark:from-brand-950/20 dark:to-accent-950/10
                           border border-brand-200/40 dark:border-brand-800/40"
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-brand-600" />
                    <h3 className="text-base font-semibold text-ink-900 dark:text-white">
                      {REPORT_ACTIONS.actionListTitle}
                    </h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-semibold">
                      {REPORT_ACTIONS.actionListProgress(
                        actionItems.filter((i) => checked[i.key]).length,
                        actionItems.length,
                      )}
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-400">
                    勾选 = 本地记录 · 点击箭头 = 跳工作台{REPORT_ACTIONS.reuseAsTopic}
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {actionItems.map((item) => {
                    const isChecked = !!checked[item.key]
                    return (
                      <li
                        key={item.key}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-lg
                                   hover:bg-white/60 dark:hover:bg-ink-900/40 transition-colors"
                      >
                        <button
                          onClick={() => setChecked((s) => ({ ...s, [item.key]: !s[item.key] }))}
                          className="shrink-0 text-ink-400 hover:text-brand-600 transition-colors"
                          title={isChecked ? '取消勾选' : '标记为已完成'}
                        >
                          {isChecked
                            ? <CheckCircle2 size={16} className="text-emerald-600" />
                            : <Circle size={16} />}
                        </button>
                        <span
                          className={`flex-1 text-sm ${
                            isChecked
                              ? 'line-through text-ink-400'
                              : 'text-ink-700 dark:text-ink-200'
                          }`}
                        >
                          {item.text}
                        </span>
                        <button
                          onClick={() => goToWorkbenchWithTopic(item.text)}
                          className="shrink-0 opacity-0 group-hover:opacity-100
                                     inline-flex items-center gap-1 text-[11px]
                                     text-brand-600 dark:text-brand-300
                                     hover:text-brand-700 px-1.5 py-0.5
                                     rounded hover:bg-brand-50 dark:hover:bg-brand-950/30
                                     transition-all"
                          title="跳工作台预填为议题"
                        >
                          <ArrowRight size={11} /> {REPORT_ACTIONS.reuseAsTopic}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </motion.section>
            )}

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
