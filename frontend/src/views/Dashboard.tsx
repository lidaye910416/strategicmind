/**
 * 工作台（Dashboard）- 上传种子文档、配置推演参数、启动 7 步流水线。
 *
 * Implements: US-059, US-060, US-062
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Settings, CheckCircle2, AlertCircle, FileText, Sparkles, ArrowUpRight, Upload,
  Cpu, Server, Cloud, FlaskConical, ChevronDown, Network, Loader2, Copy, Info,
} from 'lucide-react'
import DocumentUploader from '../components/DocumentUploader'
import SeedLoader from '../components/SeedLoader'
import PipelineDashboard from '../components/PipelineDashboard'
import LiveRunPanel from '../components/LiveRunPanel'
import ProviderPicker from '../components/ProviderPicker'
import Hero from '../components/layout/Hero'
import { usePipelineStore, type PipelineStatus } from '../store/pipeline'
import api from '../services/api'
import {
  COMMON, DASHBOARD, REPORT_STYLE_LABELS, APP_ROUTES, PROVIDER,
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<'executive' | 'technical' | 'narrative'>('executive')
  const [uploads, setUploads] = useState<{ id: string; docId: string; filename: string }[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null)
  // P1-16: 复制配置来源提示
  const [clonedFrom, setClonedFrom] = useState<string | null>(null)

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

  // P1-16: URL ?cloneConfig=<runId> → fetch 该 run config 填 hours/style
  //        doc_ids 留空（因旧文档可能已过期，强制用户重传）+ 顶部提示
  useEffect(() => {
    const cloneId = searchParams.get('cloneConfig')
    if (!cloneId) {
      setClonedFrom(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/pipeline/${cloneId}`)
        if (cancelled) return
        const cfg = r.data?.config || r.data || {}
        // hours / report_style 容错
        const newHours = Number(cfg.simulation_hours)
        if (Number.isFinite(newHours) && newHours >= 24 && newHours <= 168) {
          setHours(newHours)
        }
        const newStyle = cfg.report_style
        if (newStyle === 'executive' || newStyle === 'technical' || newStyle === 'narrative') {
          setStyle(newStyle)
        }
        setClonedFrom(cloneId)
        setShowConfig(true)  // 自动展开配置面板，让用户看到已填字段
        // 清掉 URL 参数（避免刷新再次触发）
        const next = new URLSearchParams(searchParams)
        next.delete('cloneConfig')
        setSearchParams(next, { replace: true })
      } catch (e) {
        if (cancelled) return
        // fetch 失败 — 给用户提示，仍清掉 URL 参数
        console.warn('复制配置失败', e)
        setClonedFrom(`__error__:${cloneId}`)
        const next = new URLSearchParams(searchParams)
        next.delete('cloneConfig')
        setSearchParams(next, { replace: true })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // 仅在 mount 时执行一次

  const {
    runId, status, currentStage, progress, error,
    isStarting,
    startPipeline, pause, resume, cancel, reset,
    setProgress, setStatus,
  } = usePipelineStore()

  // Poll pipeline status (SSE 在 store 内已接管；这里是 5s 兜底拉快照，确保数据最新)
  useEffect(() => {
    if (!runId) return
    const tick = () => {
      fetch(`/api/pipeline/${runId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!d) return
          if (d.current_stage) setProgress(d.current_stage, d.progress ?? 0)
          if (d.status) setStatus(d.status as PipelineStatus)
        })
        .catch(() => {})
    }
    tick()
    const t = setInterval(tick, 5000)
    return () => clearInterval(t)
  }, [runId])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    const runId = await startPipeline({
      simulation_hours: hours,
      report_style: style,
      doc_ids: uploads.map((u) => u.docId).filter(Boolean),
    })
    // 启动成功后：跳到完整工作台（同时 Dashboard 上也会自动出现 LiveRunPanel 紧凑版）
    if (runId) navigate(`/workbench/${runId}`)
  }

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
        className="px-6 md:px-10 pb-16 space-y-5 max-w-6xl"
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

        {/* ========== 上传种子文档（最显眼，置顶） ========== */}
        <motion.section
          variants={fadeUp}
          className="card p-6 md:p-8 bg-gradient-to-br from-brand-50/40 to-accent-50/20
                     dark:from-brand-950/20 dark:to-accent-950/10
                     border-2 border-brand-200/40 dark:border-brand-800/40"
        >
          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500
                            inline-flex items-center justify-center text-white shadow-glow shrink-0">
              <FileText size={22} />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-ink-900 dark:text-white">
                上传种子文档 · 开启战略推演
              </h2>
              <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 leading-relaxed">
                上传你的战略规划 / 行业报告 / 内部资料，系统将自动抽取实体、构建知识图谱、生成多部门 Agent 画像
              </p>
            </div>
            <Link
              to="/demo"
              className="text-[11px] text-ink-400 hover:text-brand-600 dark:hover:text-brand-300
                         transition-colors flex items-center gap-1 px-2 py-1
                         rounded hover:bg-white/60 dark:hover:bg-ink-900/40 shrink-0"
            >
              没文档？
              <span className="text-brand-600 dark:text-brand-300 font-medium">看个示例 →</span>
            </Link>
          </div>

          {/* 上传区 - 两个并列的大选项 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 快速开始（场景） */}
            <div className="p-4 rounded-xl bg-white/70 dark:bg-ink-900/40
                            border-2 border-dashed border-brand-300/60 dark:border-brand-700/60
                            hover:border-brand-400 dark:hover:border-brand-500
                            transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-brand-600" />
                <span className="text-[11px] uppercase tracking-wider text-brand-700 dark:text-brand-300 font-bold">
                  快速开始
                </span>
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
                一键加载内置场景
              </div>
              <p className="text-[11px] text-ink-500 dark:text-ink-400 mb-3 leading-relaxed">
                4 个真实战略场景（湖北数产 / 城商行 / 制造业 / SaaS）
              </p>
              <SeedLoader onLoaded={(doc) =>
                setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))
              } />
            </div>
            {/* 上传自己 */}
            <div className="p-4 rounded-xl bg-white/70 dark:bg-ink-900/40
                            border-2 border-dashed border-accent-300/60 dark:border-accent-700/60
                            hover:border-accent-400 dark:hover:border-accent-500
                            transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Upload size={14} className="text-accent-600" />
                <span className="text-[11px] uppercase tracking-wider text-accent-700 dark:text-accent-300 font-bold">
                  自定义
                </span>
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
                上传你自己的文档
              </div>
              <p className="text-[11px] text-ink-500 dark:text-ink-400 mb-3 leading-relaxed">
                支持 .txt / .md / .pdf · 拖拽文件到下方或点击
              </p>
              <DocumentUploader onUploaded={(doc) =>
                setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))
              } />
            </div>
          </div>

          {/* 已上传文件 */}
          <AnimatePresence>
            {uploads.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20
                           border border-emerald-200/60 dark:border-emerald-800/40"
              >
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    已选择 {uploads.length} 份文档
                  </span>
                </div>
                <ul className="space-y-1">
                  {uploads.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300
                                 px-2 py-1"
                    >
                      <span className="w-1 h-1 rounded-full bg-emerald-500" />
                      <span className="truncate">{u.filename}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* P1-16: 复制配置提示 banner */}
        {clonedFrom && (
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            className={`card p-3 flex items-center gap-2 text-xs ${
              clonedFrom.startsWith('__error__')
                ? 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 text-amber-800 dark:text-amber-200'
                : 'border-brand-300/60 bg-brand-50/70 dark:bg-brand-950/30 dark:border-brand-800/60 text-brand-800 dark:text-brand-200'
            }`}
          >
            {clonedFrom.startsWith('__error__')
              ? <AlertCircle size={14} className="shrink-0" />
              : <Copy size={14} className="shrink-0" />}
            <div className="flex-1">
              {clonedFrom.startsWith('__error__')
                ? <>复制配置失败（run: {clonedFrom.replace('__error__:', '')}），请手动配置参数</>
                : <>已从历史 run <code className="px-1 rounded bg-white/60 dark:bg-ink-900/60 font-mono">{clonedFrom}</code> 复制配置：时长 / 报告风格 已自动填入</>
              }
            </div>
            <div className="flex items-center gap-1 text-ink-500">
              <Info size={11} />
              <span>文档需重新上传（旧文档已过期）</span>
            </div>
            <button
              onClick={() => setClonedFrom(null)}
              className="ml-1 text-ink-400 hover:text-ink-700 text-[10px] px-1.5"
              title="关闭提示"
            >
              ✕
            </button>
          </motion.div>
        )}

        {/* ========== 配置 + 启动（合并为一个统一的"下一步"卡片） ========== */}
        <motion.section variants={fadeUp} className="card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <span className={`step-num ${uploads.length === 0 ? 'opacity-40' : ''}`}>2</span>
              <div>
                <h2 className="font-semibold text-ink-900 dark:text-white">
                  {uploads.length === 0 ? '先上传文档' : '配置参数并启动推演'}
                </h2>
                <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                  {uploads.length === 0
                    ? '上传至少一个文档后即可启动推演'
                    : '默认参数已适用于多数场景；可按需调整'}
                </p>
              </div>
            </div>
            {!showConfig && uploads.length > 0 && (
              <button
                onClick={() => setShowConfig(true)}
                className="btn-ghost h-8 text-xs"
              >
                <Settings size={12} /> {DASHBOARD.openConfig}
              </button>
            )}
            {showConfig && uploads.length > 0 && (
              <button
                onClick={() => setShowConfig(false)}
                className="text-xs text-ink-400 hover:text-ink-700"
              >
                {DASHBOARD.closeConfig}
              </button>
            )}
          </div>

          <AnimatePresence>
            {showConfig && uploads.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40">
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* 启动按钮 - 始终显示在底部 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {uploads.length === 0 && !runId ? (
              <div className="text-sm text-ink-400 flex items-center gap-1.5">
                <ChevronDown size={12} className="-rotate-90" />
                {DASHBOARD.needDoc}
              </div>
            ) : !runId ? (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary h-11 px-6 text-sm"
                onClick={handleStart}
                disabled={isStarting}
              >
                {isStarting
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Play size={16} />}
                {isStarting ? '正在构建推演任务…' : '启动推演'}
              </motion.button>
            ) : (
              <div className="w-full">
                <PipelineDashboard
                  runId={runId}
                  currentStage={currentStage}
                  progress={progress}
                  status={status}
                />
                <div className="flex flex-wrap gap-2 mt-3">
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

        {/* 推演运行状态 - 实时可视化（与 Workbench 同源） */}
        {runId && status !== 'idle' && (
          <motion.section variants={fadeUp}>
            <LiveRunPanel
              runId={runId}
              compact
              title="推演实时可视化"
              subtitle="这是 Workbench 的核心可视化紧凑版 · 点击右上角进入完整工作台"
            />
          </motion.section>
        )}

        

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
