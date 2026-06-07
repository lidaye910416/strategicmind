/**
 * 工作台（Dashboard）- 上传种子文档、配置推演参数、启动 7 步流水线。
 *
 * Implements: US-059, US-060, US-062
 * P2-8: 拆分为 components/dashboard/{Hero,Upload,Config,RunControl,LiveSnapshot}.tsx
 *       本文件只保留状态管理 + 副作用 + 5 块组合，<= 180 行。
 *
 * P3-A: 透传新参数到 startPipeline（user_params 子对象 + 兼容旧字段）
 *
 * Feature Flag: flags.dashboardSplit（默认 false）— 后续可挂更多行为开关
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertCircle, Copy } from 'lucide-react'
import { usePipelineStore, type PipelineStatus } from '../store/pipeline'
import api from '../services/api'
import { DASHBOARD, DASHBOARD_ACTIONS, APP_ROUTES } from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'
import { flags } from '../lib/featureFlags'
import HeroSection, { type CurrentProvider } from '../components/dashboard/HeroSection'
import UploadCard, { type UploadItem } from '../components/dashboard/UploadCard'
import ConfigCard, { type ReportStyle } from '../components/dashboard/ConfigCard'
import RunControlBar from '../components/dashboard/RunControlBar'
import LiveSnapshotSection from '../components/dashboard/LiveSnapshotSection'
import ProviderPicker from '../components/ProviderPicker'
import {
  DEFAULT_USER_PARAMS, type SimulationUserParams,
  parseExternalFactors, formatExternalFactors,
} from '../types/simulationConfig'

export default function Dashboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<ReportStyle>('executive')
  const [params, setParams] = useState<SimulationUserParams>(DEFAULT_USER_PARAMS)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null)
  const [clonedFrom, setClonedFrom] = useState<string | null>(null)

  const loadProvider = () => api.get('/provider/current').then((r) => setCurrentProvider(r.data)).catch(() => {})

  useEffect(() => { loadProvider() }, [])

  // P1-16: URL ?cloneConfig=<runId> → fetch 该 run config 填 hours/style
  // P3-A: 同步尝试从 user_params 还原新参数
  useEffect(() => {
    const cloneId = searchParams.get('cloneConfig')
    if (!cloneId) { setClonedFrom(null); return }
    const ctrl = new AbortController()
    let cancelled = false
    const clearParam = () => {
      const next = new URLSearchParams(searchParams); next.delete('cloneConfig')
      setSearchParams(next, { replace: true })
    }
    api.get(`/pipeline/${cloneId}`, { signal: ctrl.signal })
      .then((r) => {
        if (cancelled) return
        const cfg = r.data?.config || r.data || {}
        const nh = Number(cfg.simulation_hours)
        if (Number.isFinite(nh) && nh >= 24 && nh <= 168) setHours(nh)
        const ns = cfg.report_style
        if (ns === 'executive' || ns === 'technical' || ns === 'narrative') setStyle(ns)
        // 尝试从 user_params 还原
        const up = cfg.user_params
        if (up && typeof up === 'object') {
          setParams((prev) => ({
            ...prev,
            ...up,
            // 容错：external_factors 可能是数组也可能是 string
            external_factors: Array.isArray(up.external_factors)
              ? up.external_factors
              : (typeof up.external_factors === 'string'
                  ? parseExternalFactors(up.external_factors)
                  : prev.external_factors),
          }))
        }
        setClonedFrom(cloneId); setShowConfig(true); clearParam()
      })
      .catch((e) => {
        if (cancelled || e?.name === 'CanceledError') return
        console.warn(DASHBOARD_ACTIONS.cloneFailedConsole, e)
        setClonedFrom(`__error__:${cloneId}`); clearParam()
      })
    return () => { cancelled = true; ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const {
    runId, status, currentStage, progress, error, isStarting,
    startPipeline, pause, resume, cancel, reset, setProgress, setStatus,
  } = usePipelineStore()

  // 5s 兜底轮询
  useEffect(() => {
    if (!runId) return
    const tick = () => fetch(`/api/pipeline/${runId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        if (d.current_stage) setProgress(d.current_stage, d.progress ?? 0)
        if (d.status) setStatus(d.status as PipelineStatus)
      }).catch(() => { /* silent */ })
    tick()
    const t = setInterval(tick, 5000)
    return () => clearInterval(t)
  }, [runId])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    const newRunId = await startPipeline({
      // 旧字段（兼容）
      simulation_hours: hours,
      report_style: style,
      // 新字段（P3-A）
      user_params: {
        ...params,
        // 后端接受 string[] 形式的 external_factors；保持不变
      },
      doc_ids: uploads.map((u) => u.docId).filter(Boolean),
    })
    if (newRunId) navigate(`/workbench/${newRunId}`)
  }
  const addUpload = (doc: UploadItem) =>
    setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))

  // 兜底：externalText 解析后不要破坏已选值（仅显示用）
  void formatExternalFactors

  return (
    <div className="min-h-screen" data-dashboard-split={flags.dashboardSplit}>
      <HeroSection
        currentProvider={currentProvider}
        onShowPicker={() => setShowPicker(true)}
        canViewReport={!!(runId && status === 'completed')}
        viewReportHref={APP_ROUTES.report(runId || '')}
      />
      <motion.div variants={stagger(0.07)} initial="initial" animate="animate"
        className="px-6 md:px-10 pb-16 space-y-5 max-w-6xl">
        {/* P3 PERSIST: 顶部 banner — 复制配置后将打开新上传页 */}
        {clonedFrom && !clonedFrom.startsWith('__error__') && (
          <motion.div
            variants={fadeUp}
            data-testid="clone-banner"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg
                       border border-brand-300/60 bg-brand-50/70
                       dark:bg-brand-950/30 dark:border-brand-800/60
                       text-brand-800 dark:text-brand-200 text-xs"
          >
            <Copy size={14} className="shrink-0" />
            <span className="font-semibold">{DASHBOARD_ACTIONS.cloneOpenUploadHint}</span>
            <span className="text-ink-500 dark:text-ink-400">
              · {DASHBOARD_ACTIONS.cloneSuccessHint}
            </span>
            <button
              onClick={() => setClonedFrom(null)}
              className="ml-auto text-ink-400 hover:text-ink-700 text-[10px] px-1.5"
              title="关闭提示"
            >
              ✕
            </button>
          </motion.div>
        )}
        {error && (
          <motion.div variants={fadeUp}
            className="card border-red-300/60 bg-red-50 dark:bg-red-950/30 dark:border-red-900/60
                       flex items-start gap-3 text-red-700 dark:text-red-300">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm">{DASHBOARD.errorBox(error)}</div>
          </motion.div>
        )}
        <motion.div variants={fadeUp}><UploadCard uploads={uploads} onAddUpload={addUpload} /></motion.div>
        <motion.div variants={fadeUp}>
          <ConfigCard
            uploadsCount={uploads.length} showConfig={showConfig} onShowConfig={setShowConfig}
            hours={hours} style={style} onChangeHours={setHours} onChangeStyle={setStyle}
            params={params} onChangeParams={setParams}
            clonedFrom={clonedFrom} onDismissClone={() => setClonedFrom(null)}
          />
        </motion.div>
        <motion.div variants={fadeUp} className="card p-6 -mt-3">
          <RunControlBar
            uploadsCount={uploads.length} runId={runId} status={status}
            currentStage={currentStage} progress={progress} isStarting={isStarting}
            onStart={handleStart} onPause={pause} onResume={resume}
            onCancel={cancel} onReset={() => { reset(); setUploads([]) }}
          />
        </motion.div>
        <motion.div variants={fadeUp}><LiveSnapshotSection runId={runId || ''} status={status} /></motion.div>
        <div className="pt-6 pb-2 flex items-center justify-center gap-2 text-xs text-ink-400 dark:text-ink-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
          战略智脑 · StrategicMind · v0.1
        </div>
      </motion.div>
      <ProviderPicker open={showPicker} onClose={() => setShowPicker(false)} onChanged={loadProvider} />
    </div>
  )
}
