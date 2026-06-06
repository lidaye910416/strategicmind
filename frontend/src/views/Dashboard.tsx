/**
 * 工作台（Dashboard）- 上传种子文档、配置推演参数、启动 7 步流水线。
 *
 * Implements: US-059, US-060, US-062
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Settings, CheckCircle2, AlertCircle, FileText, Sparkles, ArrowUpRight,
  Cpu, Server, Cloud, FlaskConical, ChevronDown, X, Network,
} from 'lucide-react'
import DocumentUploader from '../components/DocumentUploader'
import SeedLoader from '../components/SeedLoader'
import PipelineDashboard from '../components/PipelineDashboard'
import SimulationExplainer from '../components/SimulationExplainer'
import ProviderPicker from '../components/ProviderPicker'
import Hero from '../components/layout/Hero'
import { usePipelineStore, type PipelineStatus } from '../store/pipeline'
import api from '../services/api'
import {
  COMMON, DASHBOARD, REPORT_STYLE_LABELS, APP_ROUTES, PROVIDER,
  STAGE_LABELS,
} from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'

interface CurrentProvider {
  provider: string
  model: string
  base_url: string
  is_local: boolean
  requires_api_key: boolean
}

const ICON_FOR_PROVIDER: Record<string, any> = {
  ollama: Server,
  minimax: Sparkles,
  bailian: Cloud,
  mock: FlaskConical,
}

export default function Dashboard() {
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<'executive' | 'technical' | 'narrative'>('executive')
  const [uploads, setUploads] = useState<{ id: string; docId: string; filename: string }[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null)

  const loadCurrent = async () => {
    try {
      const r = await api.get('/provider/current')
      setCurrentProvider(r.data)
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    loadCurrent()
  }, [])

  const {
    runId, status, currentStage, progress, error,
    startPipeline, pause, resume, cancel, reset,
    setProgress, setStatus,
  } = usePipelineStore()

  // Poll pipeline status for error/stuck detection (and as a fallback
  // to push progress into the store if the SSE stream ever drops).
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  useEffect(() => {
    if (!runId) {
      setPipelineError(null)
      return
    }
    let lastProgress = -1
    let stuckSince = 0
    const tick = () => {
      fetch(`/api/pipeline/${runId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!d) return
          if (d.error) setPipelineError(d.error)
          // Fallback: hydrate the store from the REST snapshot in case
          // the SSE connection has gone stale.
          if (d.current_stage) setProgress(d.current_stage, d.progress ?? 0)
          if (d.status) setStatus(d.status as PipelineStatus)
          if (d.progress !== lastProgress) {
            lastProgress = d.progress
            stuckSince = Date.now()
          } else if (Date.now() - stuckSince > 180_000 && d.status === 'running') {
            setPipelineError(
              `推演在「${STAGE_LABELS[d.current_stage] || d.current_stage}」阶段超过 3 分钟无进展，可能已卡死。请点击「新建推演」重试。`
            )
          }
        })
        .catch(() => {})
    }
    tick()
    const t = setInterval(tick, 5000)
    return () => clearInterval(t)
  }, [runId])

  const handleStart = async () => {
    setPipelineError(null)
    await startPipeline({
      simulation_hours: hours,
      report_style: style,
      doc_ids: uploads.map((u) => u.docId).filter(Boolean),
    })
  }

  const statusLabel = (() => {
    switch (status) {
      case 'idle': return DASHBOARD.pipelineIdle
      case 'running': return DASHBOARD.pipelineRunning
      case 'paused': return DASHBOARD.pipelinePaused
      case 'completed': return DASHBOARD.pipelineCompleted
      case 'failed': return DASHBOARD.pipelineFailed
      case 'cancelled': return DASHBOARD.pipelineCancelled
      default: return status
    }
  })()

  return (
    <div className="min-h-screen">
      <Hero
        eyebrow="StrategicMind · 多 Agent 博弈推演"
        title={COMMON.appName}
        subtitle={DASHBOARD.headerSubtitle}
        rightSlot={
          <div className="flex items-center gap-2 flex-wrap">
            {/* 当前模型 badge — 点击打开切换弹窗 */}
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowPicker(true)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-xl
                         bg-white/80 dark:bg-ink-900/60
                         border border-ink-200/60 dark:border-ink-800/60
                         hover:border-brand-300 dark:hover:border-brand-600
                         shadow-soft transition-colors"
              title={PROVIDER.badge}
            >
              {currentProvider && ICON_FOR_PROVIDER[currentProvider.provider]
                ? (() => {
                    const Icon = ICON_FOR_PROVIDER[currentProvider.provider]
                    return (
                      <span className="w-5 h-5 rounded-md bg-gradient-to-br from-brand-500/20 to-accent-500/20
                                       inline-flex items-center justify-center text-brand-600 dark:text-brand-400">
                        <Icon size={11} />
                      </span>
                    )
                  })()
                : <Cpu size={14} className="text-ink-400" />}
              <div className="text-left leading-tight">
                <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-semibold">
                  {PROVIDER.current}
                </div>
                <div className="text-xs font-semibold text-ink-900 dark:text-white font-mono">
                  {currentProvider?.model || '...'}
                </div>
              </div>
              <ChevronDown size={12} className="text-ink-400" />
            </motion.button>
            <Link to="/workbench" className="btn-ghost h-9">
              <Network size={14} /> 推演工作台
            </Link>
            <Link
              to={runId && status === 'completed' ? APP_ROUTES.report(runId) : '#'}
              className={`btn-primary h-9 ${!(runId && status === 'completed') ? 'pointer-events-none opacity-50' : ''}`}
            >
              <FileText size={14} /> {DASHBOARD.viewReport} <ArrowUpRight size={12} />
            </Link>
          </div>
        }
      />

      <motion.div
        variants={stagger(0.07)}
        initial="initial"
        animate="animate"
        className="px-6 md:px-10 pb-16 space-y-6 max-w-6xl"
      >
        {error && (
          <motion.div
            variants={fadeUp}
            className="card border-red-300/60 bg-red-50 dark:bg-red-950/30 dark:border-red-900/60
                       flex items-start gap-3 text-red-700 dark:text-red-300"
          >
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm">{DASHBOARD.errorBox(error)}</div>
          </motion.div>
        )}

        {/* 推演运行状态（实时显示） */}
        <motion.section variants={fadeUp}>
          <SimulationExplainer
            currentStage={currentStage}
            progress={progress}
            status={status}
          />
        </motion.section>

        {/* 第 1 步：上传 */}
        <motion.section variants={fadeUp} className="card p-6">
          <div className="flex items-center gap-3">
            <span className="step-num">1</span>
            <div className="flex-1">
              <h2 className="font-semibold text-ink-900 dark:text-white">{DASHBOARD.step1}</h2>
              <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{DASHBOARD.step1Hint}</p>
            </div>
            <Link
              to="/demo"
              className="text-[11px] text-ink-400 hover:text-brand-600 dark:hover:text-brand-300
                         transition-colors flex items-center gap-1 px-2 py-1
                         rounded hover:bg-ink-50 dark:hover:bg-ink-900/40"
            >
              没文档？
              <span className="text-brand-600 dark:text-brand-300 font-medium">看个示例</span>
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-bold mb-2">
                快速开始 · 内置示例
              </div>
              <SeedLoader onLoaded={(doc) =>
                setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))
              } />
              <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-2 leading-relaxed">
                一键加载湖北数产十五五战略规划作为种子，无需准备文件。
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-bold mb-2">
                或 · 上传自己的文档
              </div>
              <DocumentUploader onUploaded={(doc) =>
                setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))
              } />
            </div>
          </div>
          <AnimatePresence>
            {uploads.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 space-y-1.5"
              >
                {uploads.map((u) => (
                  <motion.li
                    key={u.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300
                               px-3 py-2 rounded-lg bg-ink-50 dark:bg-ink-900/50"
                  >
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="truncate">{u.filename}</span>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </motion.section>

        {/* 第 2 步：配置（可选） */}
        <AnimatePresence>
          {showConfig && (
            <motion.section
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="card p-6 overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <span className="step-num">2</span>
                <div>
                  <h2 className="font-semibold text-ink-900 dark:text-white">{DASHBOARD.step2}</h2>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{DASHBOARD.step2Hint}</p>
                </div>
                <button
                  onClick={() => setShowConfig(false)}
                  className="ml-auto text-xs text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                >
                  收起
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="label">
                    {DASHBOARD.hours}: <span className="font-bold text-brand-600">{hours} {DASHBOARD.hoursSuffix}</span>
                  </label>
                  <input
                    type="range" min={24} max={168} value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.hoursHint}</p>
                </div>
                <div>
                  <label className="label">{DASHBOARD.reportStyle}</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value as any)}
                    className="input"
                  >
                    {Object.entries(REPORT_STYLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 配置快捷按钮（默认隐藏配置时显示） */}
        {!showConfig && (
          <motion.div variants={fadeUp} className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig(true)}
              className="btn-ghost h-9 text-sm"
            >
              <Settings size={14} /> {DASHBOARD.openConfig}
            </button>
            <span className="text-xs text-ink-400 dark:text-ink-500">
              默认参数已可适用于多数场景
            </span>
          </motion.div>
        )}

        {/* 第 3 步：启动推演 */}
        <motion.section variants={fadeUp} className="card p-6 overflow-hidden relative">
          <div className="flex items-center gap-3">
            <span className="step-num">3</span>
            <div>
              <h2 className="font-semibold text-ink-900 dark:text-white">{DASHBOARD.step3}</h2>
              <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{DASHBOARD.step3Hint}</p>
            </div>
            {status !== 'idle' && (
              <span className={`badge-${status} ml-auto`}>{statusLabel}</span>
            )}
          </div>

          <div className="mt-5">
            {(error || pipelineError) && (
              <div className="mb-4 card border-rose-300/60 bg-rose-50 dark:bg-rose-950/30
                              dark:border-rose-900/60 p-4 flex items-start gap-3
                              text-rose-700 dark:text-rose-300">
                <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold mb-1">推演出错</div>
                  <div className="text-xs break-words font-mono">
                    {error || pipelineError}
                  </div>
                </div>
                <button
                  onClick={() => { setPipelineError(null); reset() }}
                  className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-200 shrink-0"
                  title="关闭"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {!runId && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary"
                onClick={handleStart}
                disabled={uploads.length === 0}
              >
                <Play size={16} /> {DASHBOARD.start}
              </motion.button>
            )}
            {uploads.length === 0 && !runId && (
              <p className="text-sm text-ink-500 dark:text-ink-400 mt-3">{DASHBOARD.needDoc}</p>
            )}

            {runId && (
              <div className="space-y-5">
                <PipelineDashboard
                  runId={runId}
                  currentStage={currentStage}
                  progress={progress}
                  status={status}
                />
                <div className="flex flex-wrap gap-2">
                  {status === 'running' && (
                    <button className="btn-ghost" onClick={pause}>
                      {DASHBOARD.pause}
                    </button>
                  )}
                  {status === 'paused' && (
                    <button className="btn-primary" onClick={resume}>{DASHBOARD.resume}</button>
                  )}
                  {(status === 'running' || status === 'paused') && (
                    <button className="btn-danger" onClick={cancel}>{DASHBOARD.cancel}</button>
                  )}
                  {status === 'completed' && (
                    <Link to={APP_ROUTES.report(runId)} className="btn-primary">
                      <FileText size={16} /> {DASHBOARD.viewReport}
                    </Link>
                  )}
                  <button className="btn-ghost" onClick={() => { reset(); setUploads([]) }}>
                    {DASHBOARD.newRun}
                  </button>
                  {status === 'running' && (
                    <Link to={APP_ROUTES.simulation(runId)} className="btn-ghost">
                      <Sparkles size={14} /> {DASHBOARD.liveView}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.section>

        {/* Footer brand strip */}
        <div className="pt-6 pb-2 flex items-center justify-center gap-2 text-xs text-ink-400 dark:text-ink-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
          战略智脑 · StrategicMind · v0.1
        </div>
      </motion.div>

      {/* Provider picker modal */}
      <ProviderPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onChanged={() => loadCurrent()}
      />
    </div>
  )
}
