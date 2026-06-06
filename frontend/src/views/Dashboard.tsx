/**
 * 工作台（Dashboard）- 上传种子文档、配置推演参数、启动 7 步流水线。
 *
 * Implements: US-059, US-060, US-062
 * P2-8: 拆分为 components/dashboard/{Hero,Upload,Config,RunControl,LiveSnapshot}.tsx
 *       本文件只保留状态管理 + 副作用 + 5 块组合，<= 180 行。
 *
 * Feature Flag: flags.dashboardSplit（默认 false）— 后续可挂更多行为开关
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
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

export default function Dashboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showConfig, setShowConfig] = useState(false)
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<ReportStyle>('executive')
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null)
  const [clonedFrom, setClonedFrom] = useState<string | null>(null)

  const loadProvider = () => api.get('/provider/current').then((r) => setCurrentProvider(r.data)).catch(() => {})

  useEffect(() => { loadProvider() }, [])

  // P1-16: URL ?cloneConfig=<runId> → fetch 该 run config 填 hours/style
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
      simulation_hours: hours, report_style: style,
      doc_ids: uploads.map((u) => u.docId).filter(Boolean),
    })
    if (newRunId) navigate(`/workbench/${newRunId}`)
  }
  const addUpload = (doc: UploadItem) =>
    setUploads((prev) => (prev.find((u) => u.docId === doc.docId) ? prev : [...prev, doc]))

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
