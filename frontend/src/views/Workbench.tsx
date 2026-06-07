/**
 * 推演工作台 - 参考 MiroFish Process.vue 风格。
 *
 * 主视觉：左侧"实时图谱 + 部门态势" + 右侧"7 步流水线面板 + 议题推演"。
 *
 * 整个推演流程在一个 SPA 视图内完成：上传 → 推演 → 看图谱 → 解决议题 → 出报告。
 *
 * Implements: US-208 推演工作台
 */
import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, FileText, Loader2, Sparkles, ArrowUpRight,
  GitBranch, Users, Database, BookOpen,
  Activity, Zap, Home, Settings2, Network, FileDown, Lightbulb,
} from 'lucide-react'
import api from '../services/api'
import companyApi, { type CompanyContext, type TopicResolution } from '../services/companyApi'
import PipelineDashboard from '../components/PipelineDashboard'
import RoundTimeline from '../components/RoundTimeline'
import DepartmentGraph from '../components/DepartmentGraph'
import SimulationExplainer from '../components/SimulationExplainer'
import KnowledgeGraph from '../components/KnowledgeGraph'
import AgentInterview from '../components/AgentInterview'
import WorkbenchSubnav from '../components/WorkbenchSubnav'
import Stat from '../components/Workbench/Stat'
import DeptMini from '../components/Workbench/DeptMini'

import PlatformStatusCards from '../components/PlatformStatusCards'
import Hero from '../components/layout/Hero'
import {
  WORKBENCH, STAGE_LABELS, STATUS_LABELS,  COMMON, APP_ROUTES,
} from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'
import {
  usePipelineStore, useRunId, useStatus, useStage, useProgress, useSnapshot, useLastRunConfig,
} from '../store/pipeline'

// ---- 7 步流水线定义 ----
const STAGES = [
  { key: 'SEED_PARSING', icon: BookOpen, desc: '解析种子文档' },
  { key: 'GRAPH_BUILDING', icon: GitBranch, desc: '构建知识图谱' },
  { key: 'ENTITY_EXTRACTION', icon: Database, desc: '抽取实体关系' },
  { key: 'PROFILE_GENERATION', icon: Users, desc: '生成 Agent 画像' },
  { key: 'CONFIG_GENERATION', icon: Settings2, desc: '生成仿真配置' },
  { key: 'SIMULATION_RUNNING', icon: Activity, desc: '执行多 Agent 推演' },
  { key: 'REPORT_GENERATING', icon: FileText, desc: '生成战略报告' },
]

export default function Workbench() {

  // ---- 状态 ----
  const navigate = useNavigate()
  const { runId: urlRunId } = useParams<{ runId: string }>()
  const [searchParams] = useSearchParams()
  const [company, setCompany] = useState<CompanyContext | null>(null)
  // P1-19: 阶段/进度/状态全部由 store 派生（SSE 自动推），不再用 local state + 2s 轮询
  const runId = useRunId()
  const status = useStatus()
  const stage = useStage()
  const progress = useProgress()
  const startPipeline = usePipelineStore((s) => s.startPipeline)
  const pausePipeline = usePipelineStore((s) => s.pause)
  const resumePipeline = usePipelineStore((s) => s.resume)
  const cancelPipeline = usePipelineStore((s) => s.cancel)
  const hydrateFromRunId = usePipelineStore((s) => s.hydrateFromRunId)
  // P1-8 / P1-11: 快照供 PlatformStatusCards 取 current_round / total_rounds / active_agents
  const snapshot = useSnapshot()
  // P3-A: 读最近一次启动时的 config（用户在 Dashboard 选的真实参数），避免硬编码
  const lastRunConfig = useLastRunConfig()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [topicInput, setTopicInput] = useState<string>('是否加大 AI 研发投入')
  const [resolution, setResolution] = useState<TopicResolution | null>(null)
  const [resolving, setResolving] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<any>(null)
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] })
  // P1-8: 记录推演开始时间（用于 PlatformStatusCards 的 ETA 估算）
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  // P3 PERSIST: 标记 hydrate 状态（用于顶部"恢复中 / 3 秒后看到内容" 提示）
  const [hydrating, setHydrating] = useState(false)
  const [hydrateError, setHydrateError] = useState<string | null>(null)

  // ---- P3 PERSIST: 关键 — URL /workbench/:runId 直接刷新恢复 ----
  // store 的 hydrateFromRunId 内部已实现：retry 3 次 (1s/2s/4s) + 拉 graph/network + 重开 SSE
  useEffect(() => {
    if (!urlRunId) return
    if (urlRunId === runId) return  // store 已有这个 run，跳过
    const controller = new AbortController()
    setHydrating(true)
    setHydrateError(null)
    const start = Date.now()
    hydrateFromRunId(urlRunId, controller.signal)
      .then((ok) => {
        const elapsed = Date.now() - start
        // eslint-disable-next-line no-console
        console.info(`[Workbench] hydrate ${ok ? 'ok' : 'failed'} in ${elapsed}ms`)
        if (!ok) setHydrateError(`未找到 run ${urlRunId}（3 次重试后仍失败）`)
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[Workbench] hydrate error', e)
        setHydrateError(String(e?.message || e))
      })
      .finally(() => setHydrating(false))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRunId])
  // ---- P1-14: URL ?prefill= 预填议题（由 Report 派生或 AgentInterview 跳转而来） ----
  useEffect(() => {
    const prefill = searchParams.get('prefill')
    if (prefill && prefill.trim()) {
      try {
        setTopicInput(decodeURIComponent(prefill))
      } catch {
        setTopicInput(prefill)
      }
    }
  }, [searchParams])

  // ---- P1-17: 从 sessionStorage 读取 AgentInterview 设置的议题（用 try/catch 容错） ----
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('pendingTopic')
      if (pending && pending.trim()) {
        setTopicInput(pending)
        sessionStorage.removeItem('pendingTopic')
      }
    } catch {
      // sessionStorage 不可用（隐私模式/SSR）— 静默忽略
    }
  }, [])

  // ---- 初始化：搭建默认公司 + 加载演示图谱 ----
  // 来源：C3 P0 #7：用 AbortController 防止组件卸载后的 setState warning
  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const r = await companyApi.setup({
          company_name: '示例公司',
          business_model: 'PRODUCT_BASED',
        })
        setCompany(r.data.company)
        setCompanyId(r.data.company_id)
      } catch (e: any) {
        if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
        console.error('公司初始化失败', e)
      }
      try {
        const r = await api.get('/graph/demo-graph', { signal: controller.signal })
        setGraphData({ nodes: r.data.nodes || [], edges: r.data.edges || [] })
      } catch (e: any) {
        if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
        console.error('图谱加载失败', e)
      }
    })()
    return () => controller.abort()
  }, [])

  // ---- 启动推演（store 派生 + SSE 推流；不再需要本地 simState / 2s 轮询） ----
  // P3-A: 读 store 中 lastRunConfig（即用户在 Dashboard 选的真实配置）—— 不再硬编码 72h
  const handleStartPipeline = useCallback(async () => {
    try {
      const cfg = (lastRunConfig && Object.keys(lastRunConfig).length > 0)
        ? lastRunConfig
        : { simulation_hours: 72, report_style: 'executive' as const }
      await startPipeline(cfg)
      // P1-8: 记录开始时间用于 ETA（store 的 started_at 由后端推流，前端先用本地兜底）
      setRunStartedAt(Math.floor(Date.now() / 1000))
    } catch (e) {
      console.error('启动失败', e)
    }
  }, [startPipeline, lastRunConfig])

  // ---- 解决议题 ----
  const resolveTopic = useCallback(async () => {
    if (!companyId || !topicInput.trim()) return
    setResolving(true)
    try {
      const r = await companyApi.resolve(companyId, {
        topic: topicInput,
        external_pressure: 0.2,
      })
      setResolution(r.data)
    } catch (e) {
      console.error('解决失败', e)
    } finally {
      setResolving(false)
    }
  }, [companyId, topicInput])

  // ---- 下载公司报告 ----
  const downloadCompanyReport = useCallback(() => {
    if (!companyId) return
    window.open(`/api/company/${companyId}/report/download`, '_blank')
  }, [companyId])

  // ---- 部门博弈连续推演 ----
  // P1-10: 加 NProgress + 1/4→2/4→3/4→4/4 实时显示
  const [simulatingRound, setSimulatingRound] = useState(0)  // 0=未开始, 1..4=当前回合
  const [simulatingPct, setSimulatingPct] = useState(0)      // 0-100，进度条宽度
  const runCompanySimulation = useCallback(async () => {
    if (!companyId) return
    setSimulating(true)
    setSimulatingRound(1)
    setSimulatingPct(5)

    // 后端单次 POST 4 回合，没有原生进度；前端按"经验时长"模拟 1/4→4/4
    // 单回合预估 8-12s（保守），4 回合 32-48s；用平滑插值填充进度条
    const TOTAL_ROUNDS = 4
    const STEP_MS = 9000  // 每 9s 推进一步
    const startTs = Date.now()
    const tick = setInterval(() => {
      const elapsed = Date.now() - startTs
      const totalMs = STEP_MS * TOTAL_ROUNDS
      // 进度条：线性插值到 95%（剩余 5% 等请求完成）
      const pct = Math.min(95, (elapsed / totalMs) * 100)
      setSimulatingPct(pct)
      const newRound = Math.min(TOTAL_ROUNDS, Math.floor(elapsed / STEP_MS) + 1)
      setSimulatingRound(newRound)
    }, 500)

    try {
      const r = await api.post(`/company/${companyId}/simulate`, {
        max_rounds: TOTAL_ROUNDS,
        topics: [
          topicInput,
          '是否拓展新市场',
          '是否提价保住毛利率',
          '如何应对竞争',
        ],
      })
      setSimResult(r.data)
      setSimulatingPct(100)
      setSimulatingRound(TOTAL_ROUNDS)
    } catch (e) {
      console.error('仿真失败', e)
    } finally {
      clearInterval(tick)
      // 成功后保留 100% 一会儿再清，让用户看到 4/4
      setTimeout(() => {
        setSimulating(false)
        setSimulatingRound(0)
        setSimulatingPct(0)
      }, 600)
    }
  }, [companyId, topicInput])

  // ---- 控制推演（store 动作，原子粒度） ----
  const control = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      if (action === 'pause') await pausePipeline()
      else if (action === 'resume') await resumePipeline()
      else await cancelPipeline()
    } catch (e) { console.error(e) }
  }, [pausePipeline, resumePipeline, cancelPipeline])

  const currentStageIdx = STAGES.findIndex((s) => s.key === stage)
  const isCompleted = stage === 'COMPLETED'

  return (
    <div className="min-h-screen pb-20">
      {/* P1-10: 顶部 NProgress 进度条（CSS 实现，部门博弈连续推演 1/4→4/4 期间显示） */}
      {simulating && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-ink-200/40 dark:bg-ink-800/40 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-brand-500 via-accent-500 to-brand-500"
            initial={{ width: '0%' }}
            animate={{ width: `${simulatingPct}%` }}
            transition={{ duration: 0.4, ease: 'linear' }}
          />
        </div>
      )}

      <Hero
        eyebrow="战略智脑 · 推演工作台"
        title={WORKBENCH.title}
        subtitle={WORKBENCH.subtitle}
        rightSlot={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={APP_ROUTES.home} className="btn-ghost h-9">
              <Home size={14} /> {COMMON.backToDashboard}
            </Link>
            {hydrating && (
              <span
                data-testid="hydrating-badge"
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full
                           bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60
                           dark:border-amber-800/60 text-amber-700 dark:text-amber-300
                           text-[11px] font-semibold"
                title="正在从后端恢复推演状态（最多 3 次重试）"
              >
                <Loader2 size={11} className="animate-spin" />
                恢复中…
              </span>
            )}
            {hydrateError && !hydrating && (
              <span
                data-testid="hydrate-error-badge"
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full
                           bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60
                           dark:border-rose-800/60 text-rose-700 dark:text-rose-300
                           text-[11px] font-semibold"
                title={hydrateError}
              >
                恢复失败
              </span>
            )}
            {runId && (
              <span className={`badge-${status}`}>
                {STATUS_LABELS[status] || status}
              </span>
            )}
            {status === 'running' && (
              <button onClick={() => control('pause')} className="btn-ghost h-9">
                <Pause size={14} /> 暂停
              </button>
            )}
            {status === 'paused' && (
              <button onClick={() => control('resume')} className="btn-primary h-9">
                <Play size={14} /> 继续
              </button>
            )}
            {status === 'completed' && runId && (
              <Link to={APP_ROUTES.report(runId)} className="btn-primary h-9">
                <FileText size={14} /> 查看报告
                <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
        }
      />

      <motion.div
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="px-4 md:px-8 max-w-7xl mx-auto space-y-4"
      >
        {/* ===== 推演说明（让用户知道我们在干什么） ===== */}
        <motion.div variants={fadeUp}>
          <SimulationExplainer
            currentStage={stage}
            progress={progress}
            status={status}
          />
        </motion.div>

        {/* ===== 顶部 7 步流水线 Dashboard ===== */}
        <motion.div variants={fadeUp}>
          <PipelineDashboard
            runId={runId || 'preview'}
            currentStage={stage}
            progress={progress}
            status={status}
          />
        </motion.div>

        {/* ===== sticky 子导航（4 锚点 + scroll-spy + 心跳） PR-2 P1-1/2 ===== */}
        <motion.div variants={fadeUp}>
          <WorkbenchSubnav />
        </motion.div>

        {/* P1-8: 平台进度双卡（外部推演 + 内部推演，跨双卡 ETA 自动显示）
            取代原 240-245 死代码空 fragment；P1-9 已从 LiveRunPanel 内嵌副本中上提 */}
        {runId && (
          <motion.div variants={fadeUp}>
            <PlatformStatusCards
              status={status}
              currentStage={stage}
              currentRound={snapshot?.current_round || 0}
              totalRounds={snapshot?.total_rounds || 0}
              activeAgents={snapshot?.active_agents || 0}
              startedAt={snapshot?.started_at ?? runStartedAt ?? undefined}
            />
          </motion.div>
        )}

        {/* ===== 主体：左右分栏 ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ---------- 左栏：公司态势 + 议题推演 ---------- */}
          <motion.div variants={fadeUp} className="lg:col-span-5 space-y-4">
            {/* 公司画像卡 */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
                  <Network size={16} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.companySection}
                  </div>
                  <div className="text-sm font-semibold text-ink-900 dark:text-white">
                    {company?.company_name || '加载中…'}
                  </div>
                </div>
                {company && (
                  <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-semibold">
                    {company.business_model.model_name_cn}
                  </span>
                )}
              </div>

              {company && (
                <>
                  {/* 经营模式关键参数 */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat label={WORKBENCH.statMargin} value={`${(company.business_model.margin_baseline * 100).toFixed(0)}%`} />
                    <Stat label={WORKBENCH.statShock} value={company.business_model.shock_resilience.toFixed(2)} />
                    <Stat label={WORKBENCH.statCycle} value={company.market_env.cycle_label_cn} />
                  </div>

                  {/* 部门列表 */}
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-2">
                      {WORKBENCH.departments} ({company.departments.length})
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {company.departments.map((d) => (
                        <DeptMini key={d.agent_id} dept={d} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 议题推演（部门博弈） — PR-2 P1-2 锚点 #dept */}
            <section id="dept" className="card p-5 scroll-mt-28">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
                  <Zap size={16} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.debateSection}
                  </div>
                  <div className="text-sm font-semibold text-ink-900 dark:text-white">
                    {WORKBENCH.debateTitle}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  placeholder={WORKBENCH.debatePlaceholder}
                  className="input flex-1"
                  disabled={!companyId}
                />
                <button
                  onClick={resolveTopic}
                  disabled={!companyId || resolving || !topicInput.trim()}
                  className="btn-primary h-10"
                >
                  {resolving ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {WORKBENCH.debateRun}
                </button>
              </div>

              {/* 多回合连续推演 */}
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={runCompanySimulation}
                    disabled={!companyId || simulating}
                    className="btn-ghost h-8 text-[11px] flex-1"
                    title={WORKBENCH.runMultiRoundTitle}
                  >
                    {simulating ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
                    {WORKBENCH.runMultiRound}
                  </button>
                  <button
                    onClick={downloadCompanyReport}
                    disabled={!companyId}
                    className="btn-ghost h-8 text-[11px] px-2"
                    title={WORKBENCH.downloadReportTitle}
                  >
                    <FileDown size={11} />
                  </button>
                </div>
                {/* P1-10: 实时回合指示 1/4 → 2/4 → 3/4 → 4/4 */}
                {simulating && simulatingRound > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-ink-500">推演中</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4].map((r) => (
                        <span
                          key={r}
                          className={`px-1.5 py-0.5 rounded font-bold transition-colors ${
                            r < simulatingRound
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : r === simulatingRound
                                ? 'bg-brand-500 text-white animate-pulse-soft'
                                : 'bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500'
                          }`}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                    <span className="text-brand-600 dark:text-brand-400 font-bold tabular-nums">
                      {simulatingRound}/4
                    </span>
                    <span className="text-ink-400">·</span>
                    <span className="text-ink-500 tabular-nums">{Math.round(simulatingPct)}%</span>
                  </div>
                )}
              </div>

              {/* 多回合结果 */}
              {simResult && simResult.round_results && (
                <div className="mt-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.multiRoundResults}（{simResult.round_results.length} 回合）
                  </div>
                  {simResult.round_results.map((r: any, i: number) => {
                    const res = r.resolution || {}
                    return (
                      <div key={i} className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50 border border-ink-200/50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[11px] font-semibold text-ink-700 dark:text-ink-200 truncate">
                            R{r.round_num || i + 1} · {r.topic || res.topic}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold text-brand-600">
                              {res.company_position?.toFixed(2) || '0.00'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              res.outcome === 'ADOPTED' ? 'bg-emerald-100 text-emerald-700' :
                              res.outcome === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                              res.outcome === 'COMPROMISED' ? 'bg-amber-100 text-amber-700' :
                              'bg-ink-100 text-ink-700'
                            }`}>
                              {res.outcome_label_cn || res.outcome || '?'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <AnimatePresence>
                {resolution && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 p-4 rounded-xl bg-gradient-to-br from-brand-50 to-accent-50/40 dark:from-brand-950/40 dark:to-accent-950/20 border border-brand-200/50"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                          {WORKBENCH.companyStance}
                        </div>
                        <div className="text-2xl font-bold font-mono text-brand-700 dark:text-brand-300">
                          {resolution.company_position >= 0 ? '+' : ''}{resolution.company_position.toFixed(2)}
                        </div>
                      </div>
                      <span className={`text-xs px-3 py-1.5 rounded-full font-semibold ${
                        resolution.outcome === 'ADOPTED' ? 'bg-emerald-100 text-emerald-700' :
                        resolution.outcome === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                        resolution.outcome === 'COMPROMISED' ? 'bg-amber-100 text-amber-700' :
                        'bg-ink-100 text-ink-700'
                      }`}>
                        {resolution.outcome_label_cn}
                      </span>
                    </div>

                    {/* 部门立场条形图 — PR-2 P1-5：transform:scaleX 锚定 0 点 + 3 条参考线 */}
                    <div className="space-y-1.5">
                      {resolution.positions
                        .sort((a, b) => b.position - a.position)
                        .map((p) => {
                          // 把 position 限到 [-1, 1] 避免溢出（实际数据通常在此范围内）
                          const pos = Math.max(-1, Math.min(1, p.position))
                          return (
                            <div key={p.dept_type} className="flex items-center gap-2 text-[11px]">
                              <div className="w-16 text-ink-600 dark:text-ink-300 truncate">{p.dept_name}</div>
                              <div className="flex-1 h-2 rounded-full bg-ink-200/60 dark:bg-ink-800/60 relative overflow-hidden">
                                {/* 参考线：-0.5 / 0 / +0.5（25% / 50% / 75%） */}
                                <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '25%' }} aria-hidden="true" />
                                <div className="absolute top-0 h-full w-px bg-ink-400/70 dark:bg-ink-500/70" style={{ left: '50%' }} aria-hidden="true" />
                                <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '75%' }} aria-hidden="true" />
                                {/* 条形：从 0 点（left:50%）开始向左/右延伸；scaleX(pos) 自动取方向 */}
                                <div
                                  className={`absolute top-0 h-full rounded-full transition-transform ${
                                    pos >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                                  }`}
                                  style={{
                                    left: '50%',
                                    width: '50%',
                                    transformOrigin: 'left center',
                                    transform: `scaleX(${pos})`,
                                  }}
                                />
                              </div>
                              <div className={`w-12 text-right font-mono font-semibold ${
                                p.position > 0.2 ? 'text-emerald-600' :
                                p.position < -0.2 ? 'text-rose-600' : 'text-ink-500'
                              }`}>
                                {p.position >= 0 ? '+' : ''}{p.position.toFixed(2)}
                              </div>
                            </div>
                          )
                        })}
                    </div>

                    <div className="mt-3 text-[11px] text-ink-600 dark:text-ink-400 italic">
                      {resolution.summary}
                    </div>

                    {/* P1-12: 决议卡末尾 — 用此立场开新一轮推演 CTA */}
                    {runId && (
                      <button
                        onClick={() => {
                          // 决议作为新推演上下文传入；navigate + state 让 Simulation 端读 fromResolution
                          navigate(APP_ROUTES.simulation(runId), {
                            state: {
                              fromResolution: {
                                topic: topicInput,
                                outcome: resolution.outcome,
                                companyPosition: resolution.company_position,
                                summary: resolution.summary,
                              },
                            },
                          })
                        }}
                        className="mt-3 w-full inline-flex items-center justify-center gap-1.5
                                   h-9 px-3 rounded-lg
                                   bg-gradient-to-r from-brand-500 to-accent-500
                                   text-white text-xs font-semibold
                                   hover:from-brand-600 hover:to-accent-600
                                   shadow-soft transition-all"
                        title={WORKBENCH.ctaStartNewRoundTitle}
                      >
                        <Lightbulb size={13} /> {WORKBENCH.ctaStartNewRound}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </motion.div>

          {/* ---------- 右栏：7 步详情 + 实时事件流 ---------- */}
          <motion.div variants={fadeUp} className="lg:col-span-7 space-y-4">
            {/* 部门关系图（力导向） — PR-2 P1-2 锚点 #rel */}
            {company && (
              <section id="rel" className="scroll-mt-28">
                <DepartmentGraph company={company} height={400} />
              </section>
            )}

            {/* 知识图谱（参考 MiroFish GraphPanel） — PR-2 P1-2 锚点 #graph */}
            {graphData.nodes.length > 0 && (
              <section id="graph" className="scroll-mt-28">
                <KnowledgeGraph nodes={graphData.nodes} edges={graphData.edges} height={400} />
              </section>
            )}

            {/* 智能体采访 — PR-2 P1-2 锚点 #interview */}
            {companyId && (
              <section id="interview" className="scroll-mt-28">
                <AgentInterview companyId={companyId} />
              </section>
            )}

            {/* 7 步流水线（详细卡） */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
                  <GitBranch size={16} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.stagesTitle}
                  </div>
                  <div className="text-sm font-semibold text-ink-900 dark:text-white">
                    7 步推演流水线
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {STAGES.map((s, i) => {
                  const isDone = currentStageIdx > i || isCompleted
                  const isActive = currentStageIdx === i && !isCompleted
                  return (
                    <div
                      key={s.key}
                      className={`p-3 rounded-lg border transition-colors ${
                        isActive
                          ? 'bg-gradient-to-r from-brand-50 to-accent-50/30 border-brand-300 dark:from-brand-950/40 dark:to-accent-950/20 dark:border-brand-700'
                          : isDone
                            ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                            : 'bg-ink-50/50 border-ink-200/60 dark:bg-ink-900/30 dark:border-ink-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-bold ${
                          isDone ? 'bg-emerald-500 text-white' :
                          isActive ? 'bg-gradient-to-br from-brand-500 to-accent-500 text-white animate-pulse-soft' :
                          'bg-ink-200 dark:bg-ink-800 text-ink-500'
                        }`}>
                          {isDone ? '✓' : isActive ? <Loader2 size={12} className="animate-spin" /> : i + 1}
                        </div>
                        <s.icon size={14} className={
                          isActive ? 'text-brand-600' : isDone ? 'text-emerald-600' : 'text-ink-400'
                        } />
                        <div className="flex-1">
                          <div className={`text-sm font-semibold ${
                            isActive ? 'text-brand-900 dark:text-brand-100' : 'text-ink-900 dark:text-white'
                          }`}>
                            {STAGE_LABELS[s.key] || s.desc}
                          </div>
                          <div className="text-[10px] text-ink-500">{s.desc}</div>
                        </div>
                        {isActive && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500 text-white font-semibold">
                            {WORKBENCH.running}
                          </span>
                        )}
                        {isDone && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                            {WORKBENCH.done}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 实时事件流（仅在推演时显示） */}
            {(stage === 'SIMULATION_RUNNING' || status === 'running') && runId && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-brand-500/20 inline-flex items-center justify-center text-emerald-600">
                    <Activity size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                      {WORKBENCH.timelineTitle}
                    </div>
                    <div className="text-sm font-semibold text-ink-900 dark:text-white">
                      {WORKBENCH.timelineSubtitle}
                    </div>
                  </div>
                </div>
                <RoundTimeline simulationId={runId} />
              </div>
            )}

            {/* 操作面板（启动/重启） */}
            {!runId && (
              <div className="card p-8 text-center bg-gradient-to-br from-brand-50/50 to-accent-50/30 dark:from-brand-950/20 dark:to-accent-950/10">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 mx-auto inline-flex items-center justify-center text-white shadow-glow mb-3">
                  <Sparkles size={24} />
                </div>
                <h3 className="text-base font-semibold text-ink-900 dark:text-white mb-1">
                  {WORKBENCH.startTitle}
                </h3>
                <p className="text-xs text-ink-500 dark:text-ink-400 mb-4 max-w-md mx-auto">
                  {WORKBENCH.startDesc}
                </p>
                <button onClick={handleStartPipeline} className="btn-primary">
                  <Play size={16} /> {WORKBENCH.start}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
