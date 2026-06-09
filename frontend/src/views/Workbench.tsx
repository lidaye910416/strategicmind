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
import { Link, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Play, Pause, FileText, Loader2, Sparkles, ArrowUpRight,
  Home, FastForward, Rocket, Upload, Eye,
} from 'lucide-react'
import api from '../services/api'
import companyApi, { type CompanyContext, type TopicResolution } from '../services/companyApi'
import WorkbenchSubnav from '../components/WorkbenchSubnav'
import WorkbenchLayout from '../components/Workbench/WorkbenchLayout'
import SystemLogs from '../components/SystemLogs'
import InnerWorkbenchContent from '../components/Workbench/InnerWorkbenchContent'
import MarketEventTicker from '../components/MarketEventTicker'
import ShockToast from '../components/ShockToast'
import YearAdvancedBanner from '../components/YearAdvancedBanner'
import MarketEnvPulse from '../components/MarketEnvPulse'
import ShockBanner from '../components/ShockBanner'
import RoundStartedBanner from '../components/RoundStartedBanner'
import EntityDanmaku from '../components/EntityDanmaku'

import PlatformStatusCards from '../components/PlatformStatusCards'
import Hero from '../components/layout/Hero'
import {
  WORKBENCH, STATUS_LABELS,  COMMON, APP_ROUTES,
} from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'
import {
  usePipelineStore, useRunId, useStatus, useStage, useSnapshot, useLastRunConfig,
  useGraphNodes, useGraphProgress, useSimRounds, useNetworkFrames,
  useMarketEvents, useRecentShocks, useYearAdvanced,
  useReportRisks,
} from '../store/pipeline'

// ---- P5: 7 步流水线定义已迁至 components/Workbench/StageProgressStrip.tsx 与 store/pipeline.ts ----

export default function Workbench() {

  // ---- 状态 ----
  const { runId: urlRunId } = useParams<{ runId?: string }>()
  const location = useLocation()
  const isReplayIntent = (location.state as { replay?: boolean } | null)?.replay === true
  const [searchParams] = useSearchParams()
  const [company, setCompany] = useState<CompanyContext | null>(null)
  // P1-19: 阶段/进度/状态全部由 store 派生（SSE 自动推），不再用 local state + 2s 轮询
  const runId = useRunId()
  const status = useStatus()
  const stage = useStage()
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

        {/* ===== P5: 7 步流水线状态条由 WorkbenchLayout 内部渲染 (T2.2) ===== */}

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

        {/* ===== 主体：3-region 布局 (WorkbenchLayout 替代旧 2-col body) ===== */}
        {runId ? (
          <motion.div variants={fadeUp} className="px-0 md:px-2">
            <WorkbenchLayout>
              <InnerWorkbenchContent
                company={company}
                companyId={companyId}
                runId={runId}
                status={status}
                stage={stage}
                topicInput={topicInput}
                setTopicInput={setTopicInput}
                resolution={resolution}
                resolving={resolving}
                resolveTopic={resolveTopic}
                runCompanySimulation={runCompanySimulation}
                simResult={simResult}
                simulating={simulating}
                simulatingRound={simulatingRound}
                simulatingPct={simulatingPct}
                downloadCompanyReport={downloadCompanyReport}
                handleStartPipeline={handleStartPipeline}
                graphNodes={graphNodes}
                graphProgress={graphProgress}
                simRounds={simRounds}
                networkFrames={networkFrames}
                reportRisks={reportRisks}
                graphRefreshIntervalMs={graphRefreshIntervalMs}
                setGraphRefreshIntervalMs={setGraphRefreshIntervalMs}
              />
            </WorkbenchLayout>
          </motion.div>
        ) : (
          /* 无 runId: 仅显示启动 CTA */
          <motion.div variants={fadeUp} className="card p-8 text-center bg-gradient-to-br from-brand-50/50 to-accent-50/30 dark:from-brand-950/20 dark:to-accent-950/10">
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
          </motion.div>
        )}

        {/* ===== SystemLogs 全宽终端 (P5: 在 3-region 下方) ===== */}
        {runId && (
          <motion.div variants={fadeUp} className="px-0 md:px-2">
            <SystemLogs runId={runId} height={220} />
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
