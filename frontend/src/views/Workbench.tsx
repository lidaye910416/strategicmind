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
import { Link, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, FileText, Loader2, Sparkles, ArrowUpRight,
  GitBranch, Users, Database, BookOpen,
  Activity, Zap, Home, Settings2, Network, FileDown, Lightbulb,
  FastForward, Rocket, Upload, Eye, RefreshCw,
} from 'lucide-react'
import api from '../services/api'
import companyApi, { type CompanyContext, type TopicResolution } from '../services/companyApi'
import PipelineDashboard from '../components/PipelineDashboard'
import RoundTimeline from '../components/RoundTimeline'
import DepartmentGraph from '../components/DepartmentGraph'
import SimulationExplainer from '../components/SimulationExplainer'
import RealtimeKnowledgeGraph from '../components/RealtimeKnowledgeGraph'
import BeliefEvolutionChart from '../components/BeliefEvolutionChart'
import SimulationNetworkGraph from '../components/SimulationNetworkGraph'
import RiskMatrixHeatmap from '../components/RiskMatrixHeatmap'
import AgentInterview from '../components/AgentInterview'
import WorkbenchSubnav from '../components/WorkbenchSubnav'
import Stat from '../components/Workbench/Stat'
import DeptMini from '../components/Workbench/DeptMini'
import EmergedTopicsTimeline from '../components/Workbench/EmergedTopicsTimeline'
import GraphRoundDiff from '../components/Workbench/GraphRoundDiff'
import DeeperSimCta from '../components/Workbench/DeeperSimCta'
import MarketEventTicker from '../components/MarketEventTicker'
import ShockToast from '../components/ShockToast'
import YearAdvancedBanner from '../components/YearAdvancedBanner'
import MarketEnvPulse from '../components/MarketEnvPulse'
import ShockBanner from '../components/ShockBanner'
import RoundStartedBanner from '../components/RoundStartedBanner'
import BeliefShiftFeed from '../components/BeliefShiftFeed'
import EntityDanmaku from '../components/EntityDanmaku'
import EntityTypeLegend from '../components/EntityTypeLegend'

import PlatformStatusCards from '../components/PlatformStatusCards'
import Hero from '../components/layout/Hero'
import {
  WORKBENCH, STAGE_LABELS, STATUS_LABELS,  COMMON, APP_ROUTES,
} from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'
import {
  usePipelineStore, useRunId, useStatus, useStage, useProgress, useSnapshot, useLastRunConfig,
  useGraphNodes, useGraphProgress, useSimRounds, useNetworkFrames,
  useMarketEvents, useRecentShocks, useYearAdvanced,
  useReportRisks,
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
  const { runId: urlRunId } = useParams<{ runId?: string }>()
  const location = useLocation()
  const isReplayIntent = (location.state as { replay?: boolean } | null)?.replay === true
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
  // P4 LOOP (G5): 跨年推演 — 仅 completed/failed 可点
  const advanceYear = usePipelineStore((s) => s.advanceYear)
  const [advancingYear, setAdvancingYear] = useState(false)
  // P1-8 / P1-11: 快照供 PlatformStatusCards 取 current_round / total_rounds / active_agents
  const snapshot = useSnapshot()
  // P3-A: 读最近一次启动时的 config（用户在 Dashboard 选的真实参数），避免硬编码
  const lastRunConfig = useLastRunConfig()
  // store: 加载指定 runId 的快照到 store (snapshot + graph + rounds)
  const hydrateFromRunId = usePipelineStore((s) => s.hydrateFromRunId)
  // ---- replay 模式检测: URL 有 :runId 且 status 是终态 ----
  const isReplayMode = Boolean(
    urlRunId && isReplayIntent &&
    ['completed', 'failed', 'cancelled'].includes(status)
  )
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [topicInput, setTopicInput] = useState<string>('是否加大 AI 研发投入')
  const [resolution, setResolution] = useState<TopicResolution | null>(null)
  const [resolving, setResolving] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<any>(null)
  // ---- P3: 实时图谱数据直接从 store 派生（与 hydrateFromRunId / SSE 增量共用同一数据源） ----
  const graphNodes = useGraphNodes()
  const graphProgress = useGraphProgress()
  const simRounds = useSimRounds()
  const networkFrames = useNetworkFrames()
  // must-tier v2: 三个 SSE 事件队列（market_event / shock_injected / year_advanced）
  const marketEvents = useMarketEvents()
  const recentShocks = useRecentShocks()
  const yearAdvanced = useYearAdvanced()
  // must-tier v1: 风险矩阵派生
  const reportRisks = useReportRisks()
  // P1-8: 记录推演开始时间（用于 PlatformStatusCards 的 ETA 估算）
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)

  // ---- mirofish-tier: 30s 轮询 toggle (SSE 断线兜底) ----
  // 0 = 关闭 (默认), 30000 = 开启
  const [graphRefreshIntervalMs, setGraphRefreshIntervalMs] = useState<number>(0)

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

  // ---- replay 模式: URL 有 :runId → 拉快照到 store (hydrates 包含 snapshot + graph + rounds) ----
  // F2: 用 active flag 替代 AbortController。React 18 dev StrictMode 双挂载 race 中：
  //   - 第一次 effect 创建 controller#1, 立即被 unmount abort, axios 抛 CanceledError 被 try/catch 吞
  //   - 第二次 effect 走 controller#2 但 [urlRunId, runId, hydrateFromRunId] 依赖稳定, 短路 (line 129)
  //     加上请求未完成时第二次 effect 又走相同路径, hydrate 后半状态写入 store 产生幽灵节点
  // 修复: 1) 去掉 AbortController, 改用 let active = true; cleanup=()=>{active=false}
  //       2) hydrateFromRunId 接收 active 参数, 只在 active=true 时写 store
  //       3) 依赖简化为 [urlRunId, hydrateFromRunId], effect 内 if(urlRunId===get().runId) return
  //       4) 顶部早返回 if(!active) return false 跳过第一次 mount 的请求
  useEffect(() => {
    if (!urlRunId) return
    if (urlRunId === runId) return  // 已经在 store 里 (live run 或已 hydrate)
    let active = true
    hydrateFromRunId(urlRunId, undefined, active).catch((e) => {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
      if (!active) return
      console.error('hydrate 失败', e)
    })
    return () => {
      active = false
    }
  }, [urlRunId, runId, hydrateFromRunId])

  // ---- 初始化：仅在有 runId 时才搭建默认公司（不预先加载 demo 假数据，避免一打开就显示一堆"示例"） ----
  // 来源：C3 P0 #7：用 AbortController 防止组件卸载后的 setState warning
  useEffect(() => {
    if (!runId) return  // 没 runId 不预创建，避免空 Workbench 看着像 demo
    // replay 模式: 不创建新公司, 公司由 hydrate 路径 (snapshot) 填充
    if (isReplayMode) return
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
    })()
    return () => controller.abort()
  }, [runId, isReplayMode])

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

  // P4 LOOP (G5): "再推 1 年" — 在 completed/failed run 上推进
  const handleAdvanceYear = useCallback(async () => {
    if (advancingYear) return
    setAdvancingYear(true)
    try {
      await advanceYear(1)
    } catch (e) {
      console.error('advance-year 失败', e)
    } finally {
      // 跑 12 轮要一会儿；保持按钮显示 loading 由 store 状态切换来驱动
      setTimeout(() => setAdvancingYear(false), 1500)
    }
  }, [advanceYear, advancingYear])

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

      {/* must-tier v2: 三种实时事件 banner (市场/冲击/跨年) */}
      <MarketEventTicker events={marketEvents} />
      <ShockToast shocks={recentShocks} />
      <YearAdvancedBanner yearAdvanced={yearAdvanced} />
      {/* should-tier v3: 红色高亮冲击横幅 + 顶部 round_started 闪现 */}
      <ShockBanner />
      <RoundStartedBanner />
      {/* should-tier v3: 实体涌现弹幕 (右下角) */}
      <EntityDanmaku />

      {/* Replay 模式横幅: 从 /history 跳进 /workbench/<已完成的 run> 时显示 */}
      {isReplayMode && runId && (
        <motion.div
          data-testid="replay-banner"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="mx-4 md:mx-10 mt-4 card p-3 flex items-center gap-3
                     bg-amber-50/70 dark:bg-amber-950/20
                     border-amber-200/60 dark:border-amber-800/40"
        >
          <Eye size={16} className="text-amber-600 dark:text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
              复盘模式 · 只读视图
            </div>
            <div className="text-[10px] text-amber-700/80 dark:text-amber-300/70 mt-0.5">
              正在查看历史任务 <code className="font-mono">{runId}</code> · 推演快照已加载, 控制面板已禁用
            </div>
          </div>
          <Link to={APP_ROUTES.home} className="btn-ghost h-8 text-[11px]">
            <Home size={12} /> 回到首页
          </Link>
          <Link to={APP_ROUTES.report(runId)} className="btn-primary h-8 text-[11px]">
            <FileText size={12} /> 查看报告
          </Link>
        </motion.div>
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
            {/* P4 LOOP (G5): 跨年推演 — completed/failed run 可点 */}
            {(status === 'completed' || status === 'failed') && runId && (
              <button
                onClick={handleAdvanceYear}
                disabled={advancingYear}
                className="btn-primary h-9 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                title={WORKBENCH.advanceYearTitle}
              >
                {advancingYear ? <Loader2 size={14} className="animate-spin" /> : <FastForward size={14} />}
                {WORKBENCH.advanceYear}
              </button>
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
        {/* ===== 未启动推演时的"就绪"首屏：避免一打开就看见一堆空区块 ===== */}
        {!runId && (
          <motion.div
            variants={fadeUp}
            className="card p-8 md:p-12 text-center bg-gradient-to-br from-brand-50/60 via-white to-accent-50/30 dark:from-brand-950/30 dark:via-ink-900 dark:to-accent-950/20"
          >
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 items-center justify-center text-white mb-4 shadow-soft">
              <Rocket size={28} />
            </div>
            <h2 className="text-2xl font-bold text-ink-900 dark:text-white mb-2">
              {WORKBENCH.idleTitle || '准备就绪'}
            </h2>
            <p className="text-sm text-ink-600 dark:text-ink-300 max-w-xl mx-auto mb-6">
              {WORKBENCH.idleSubtitle || '请到首页上传种子文档并配置推演参数，启动后将自动回到本工作台进行实时监控。'}
            </p>
            <Link to={APP_ROUTES.home} className="btn-primary h-10 px-6">
              <Upload size={14} /> {WORKBENCH.idleCta || '回到首页配置'}
            </Link>
          </motion.div>
        )}

        {/* ===== 有 runId 时, 推演说明仍展示（数据到之前可视） ===== */}
        {runId && (
          <motion.div variants={fadeUp}>
            <SimulationExplainer
              currentStage={stage}
              progress={progress}
              status={status}
            />
          </motion.div>
        )}

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

        {/* should-tier v3: 市场环境脉搏仪表盘 (在 PlatformStatusCards 旁边) */}
        {runId && (
          <motion.div variants={fadeUp}>
            <MarketEnvPulse />
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
            {company && company.departments.length > 0 && (
              <section id="rel" className="scroll-mt-28">
                <DepartmentGraph company={company} height={400} />
              </section>
            )}

            {/* 实时知识图谱（must-tier v1: 替换旧 KnowledgeGraph）— PR-2 P1-2 锚点 #graph */}
            {graphNodes.length > 0 || runId ? (
              <section id="graph" className="scroll-mt-28 relative">
                <RealtimeKnowledgeGraph
                  runId={runId}
                  live
                  height={400}
                  title={WORKBENCH.realtimeGraphTitle}
                  refreshIntervalMs={graphRefreshIntervalMs}
                />
                {/* mirofish-tier: 实体类型图例 (右上角 overlay) */}
                <EntityTypeLegend overlay />
                {/* mirofish-tier: 30s 轮询 toggle (SSE 兜底) */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    data-testid="realtime-kg-polling-toggle"
                    onClick={() =>
                      setGraphRefreshIntervalMs((v) => (v > 0 ? 0 : 30000))
                    }
                    className={`btn-ghost h-8 text-[11px] ${
                      graphRefreshIntervalMs > 0
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-300/60'
                        : ''
                    }`}
                    title={
                      graphRefreshIntervalMs > 0
                        ? '点击关闭 30s 轮询'
                        : '点击开启 30s 轮询 (SSE 断线兜底)'
                    }
                  >
                    <RefreshCw
                      size={12}
                      className={graphRefreshIntervalMs > 0 ? 'animate-spin-soft' : ''}
                    />
                    {graphRefreshIntervalMs > 0
                      ? WORKBENCH.realtimeGraphPollingOn
                      : WORKBENCH.realtimeGraphPollingOff}
                  </button>
                  {graphRefreshIntervalMs > 0 && (
                    <span
                      data-testid="realtime-kg-polling-badge"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-mono font-semibold"
                    >
                      {WORKBENCH.realtimeGraphPollingBadge(graphRefreshIntervalMs)}
                    </span>
                  )}
                </div>
              </section>
            ) : runId && !['completed', 'failed', 'cancelled'].includes(status) ? (
              /* 推演进行中: 展示 phase + 节点/边计数 */
              <section id="graph" className="scroll-mt-28">
                <div className="card p-8 flex flex-col items-center justify-center min-h-[320px] bg-gradient-to-br from-ink-50/30 to-white dark:from-ink-900/40 dark:to-ink-900/20">
                  <Loader2 size={32} className="text-brand-500 animate-spin mb-3" />
                  <div className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                    {WORKBENCH.loadingGraph}
                  </div>
                  <div className="text-[10px] text-ink-400 mt-1 font-mono">
                    {graphProgress.phase} · {graphProgress.nodes} 节点 / {graphProgress.edges} 边
                  </div>
                </div>
              </section>
            ) : runId ? (
              /* replay 模式但 hydrate 仍未拿到 entity（如后端图谱文件丢失）的兜底 */
              <section id="graph" className="scroll-mt-28">
                <div className="card p-8 text-center min-h-[320px] flex flex-col items-center justify-center">
                  <Network size={28} className="text-ink-300 mb-2" />
                  <div className="text-sm text-ink-500">未找到该 run 的知识图谱快照</div>
                </div>
              </section>
            ) : null}

            {/* must-tier v1: 信念演化多线 LineChart（#belief 锚点） */}
            {simRounds.length > 0 && (() => {
              // BeliefData = { round: number; [agent: string]: number }
              // 把 simRounds[].belief_updates 摊平为每个 round 一行
              const beliefByRound = new Map<number, Record<string, number>>()
              const agentSet = new Set<string>()
              for (const r of simRounds) {
                const updates = Array.isArray(r.belief_updates) ? r.belief_updates : []
                const row = beliefByRound.get(r.round) ?? { round: r.round }
                for (const u of updates) {
                  const aId = String((u as any).agent_id ?? (u as any).agentId ?? (u as any).agent ?? 'unknown')
                  const v = typeof (u as any).value === 'number' ? (u as any).value
                    : typeof (u as any).belief === 'number' ? (u as any).belief
                    : 0
                  row[aId] = v
                  agentSet.add(aId)
                }
                beliefByRound.set(r.round, row)
              }
              const data = Array.from(beliefByRound.values()).sort((a, b) => (a.round as number) - (b.round as number)) as Array<{ round: number; [agent: string]: number }>
              const agents = Array.from(agentSet)
              if (data.length === 0 || agents.length === 0) return null
              return (
                <section id="belief" className="card p-5 scroll-mt-28">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
                      <Activity size={16} />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                        {WORKBENCH.beliefTitle}
                      </div>
                      <div className="text-sm font-semibold text-ink-900 dark:text-white">
                        {WORKBENCH.beliefSubtitle}
                      </div>
                    </div>
                  </div>
                  <BeliefEvolutionChart data={data} agents={agents} />
                </section>
              )
            })()}

            {/* must-tier v1: 迭代关系网时序图（#net 锚点） */}
            {networkFrames.length > 0 && (
              <section id="net" className="card p-5 scroll-mt-28">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
                    <Network size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                      {WORKBENCH.networkTitle}
                    </div>
                    <div className="text-sm font-semibold text-ink-900 dark:text-white">
                      {WORKBENCH.networkSubtitle}
                    </div>
                  </div>
                </div>
                <SimulationNetworkGraph
                  runId={runId}
                  height={400}
                  title={WORKBENCH.networkTitle}
                />
              </section>
            )}

            {/* must-tier v1: 风险矩阵热力图（#risks 锚点） */}
            {reportRisks.length > 0 && (
              <section id="risks" className="card p-5 scroll-mt-28">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500/20 to-amber-500/20 inline-flex items-center justify-center text-rose-600">
                    <Zap size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                      {WORKBENCH.riskTitle}
                    </div>
                    <div className="text-sm font-semibold text-ink-900 dark:text-white">
                      {WORKBENCH.riskSubtitle}
                    </div>
                  </div>
                </div>
                <RiskMatrixHeatmap risks={reportRisks} />
              </section>
            )}

            {/* feature1 (feature/history-graph-and-viz): 涌现议题时间线 */}
            <EmergedTopicsTimeline />

            {/* should-tier v3: 信念漂移事件流 (放在 EmTopics 之后, 主题相关) */}
            <BeliefShiftFeed />

            {/* feature2: 图谱轮次 diff 对比 */}
            <GraphRoundDiff />

            {/* feature3: 进一步推演 CTA — 仅 completed/failed 显示 */}
            <DeeperSimCta />

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
                <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                  {WORKBENCH.stagesTitle}
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
