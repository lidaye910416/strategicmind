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
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, FileText, Loader2, Sparkles, ArrowUpRight,
  GitBranch, Users, Database, BookOpen,
  Activity, Zap, Home, Settings2, Network, FileDown,
} from 'lucide-react'
import api, { pipelineApi } from '../services/api'
import companyApi, { type CompanyContext, type TopicResolution } from '../services/companyApi'
import PipelineDashboard from '../components/PipelineDashboard'
import RoundTimeline from '../components/RoundTimeline'
import DepartmentGraph from '../components/DepartmentGraph'
import SimulationExplainer from '../components/SimulationExplainer'
import KnowledgeGraph from '../components/KnowledgeGraph'
import AgentInterview from '../components/AgentInterview'

import PlatformStatusCards from '../components/PlatformStatusCards'
import Hero from '../components/layout/Hero'
import {
  WORKBENCH, STAGE_LABELS, STATUS_LABELS,  COMMON, APP_ROUTES,
} from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'
import type { PipelineStatus } from '../types'

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

interface SimState {
  run_id: string
  status: PipelineStatus
  current_stage: string
  progress: number
  current_round?: number
  total_rounds?: number
  active_agents?: number
}

export default function Workbench() {

  // ---- 状态 ----
  const [company, setCompany] = useState<CompanyContext | null>(null)
  const [simState, setSimState] = useState<SimState | null>(null)
  const [stage, setStage] = useState<string>('SEED_PARSING')
  const [progress, setProgress] = useState(0)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [topicInput, setTopicInput] = useState<string>('是否加大 AI 研发投入')
  const [resolution, setResolution] = useState<TopicResolution | null>(null)
  const [resolving, setResolving] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState<any>(null)
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] })
  // P1-8: 记录推演开始时间（用于 PlatformStatusCards 的 ETA 估算）
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)

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

  // ---- 启动推演 ----
  const startPipeline = useCallback(async () => {
    try {
      const r = await pipelineApi.start({ simulation_hours: 72, report_style: 'executive' })
      const runId = r.data.run_id
      setSimState({
        run_id: runId,
        status: 'running',
        current_stage: 'SEED_PARSING',
        progress: 0,
      })
      // P1-8: 记录开始时间用于 ETA
      setRunStartedAt(Math.floor(Date.now() / 1000))
    } catch (e) {
      console.error('启动失败', e)
    }
  }, [])

  // ---- 轮询推演状态 ----
  // 来源：C3 P0 #7 + C1 C-25：用 AbortController 包住每次 fetch
  //       路由切换 / 组件卸载 → 取消 in-flight 请求，避免 setState on unmounted
  useEffect(() => {
    if (!simState || simState.status === 'completed' || simState.status === 'failed' || simState.status === 'cancelled') return
    const controller = new AbortController()
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/pipeline/${simState.run_id}`, { signal: controller.signal })
        setSimState((s) => s ? { ...s, ...r.data } : s)
        setStage(r.data.current_stage || 'SEED_PARSING')
        setProgress(r.data.progress || 0)
      } catch (e: any) {
        // AbortError 是用户主动取消/组件卸载，不算错误
        if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
        console.error('轮询失败', e)
      }
    }, 2000)
    return () => {
      clearInterval(t)
      controller.abort()
    }
  }, [simState])

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

  // ---- 控制推演 ----
  const control = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    if (!simState) return
    try {
      await api.post(`/pipeline/${simState.run_id}/${action}`)
    } catch (e) { console.error(e) }
  }, [simState])

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
            {simState && (
              <span className={`badge-${simState.status}`}>
                {STATUS_LABELS[simState.status] || simState.status}
              </span>
            )}
            {simState?.status === 'running' && (
              <button onClick={() => control('pause')} className="btn-ghost h-9">
                <Pause size={14} /> 暂停
              </button>
            )}
            {simState?.status === 'paused' && (
              <button onClick={() => control('resume')} className="btn-primary h-9">
                <Play size={14} /> 继续
              </button>
            )}
            {simState?.status === 'completed' && (
              <Link to={APP_ROUTES.report(simState.run_id)} className="btn-primary h-9">
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
            status={simState?.status}
          />
        </motion.div>

        {/* ===== 顶部 7 步流水线 Dashboard ===== */}
        <motion.div variants={fadeUp}>
          <PipelineDashboard
            runId={simState?.run_id || 'preview'}
            currentStage={stage}
            progress={progress}
            status={simState?.status}
          />
        </motion.div>

        {/* P1-8: 平台进度双卡（外部推演 + 内部推演，跨双卡 ETA 自动显示）
            取代原 240-245 死代码空 fragment；P1-9 已从 LiveRunPanel 内嵌副本中上提 */}
        {simState && (
          <motion.div variants={fadeUp}>
            <PlatformStatusCards
              status={simState.status}
              currentStage={stage}
              currentRound={simState.current_round || 0}
              totalRounds={simState.total_rounds || 0}
              activeAgents={simState.active_agents || 0}
              startedAt={runStartedAt ?? undefined}
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

            {/* 议题推演（部门博弈） */}
            <div className="card p-5">
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
                    title="用 4 个典型战略议题连续推演 4 回合"
                  >
                    {simulating ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
                    {WORKBENCH.runMultiRound}
                  </button>
                  <button
                    onClick={downloadCompanyReport}
                    disabled={!companyId}
                    className="btn-ghost h-8 text-[11px] px-2"
                    title="下载公司级报告（Markdown 格式）"
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

                    {/* 部门立场条形图 */}
                    <div className="space-y-1.5">
                      {resolution.positions
                        .sort((a, b) => b.position - a.position)
                        .map((p) => (
                          <div key={p.dept_type} className="flex items-center gap-2 text-[11px]">
                            <div className="w-16 text-ink-600 dark:text-ink-300 truncate">{p.dept_name}</div>
                            <div className="flex-1 h-2 rounded-full bg-ink-200/60 dark:bg-ink-800/60 relative overflow-hidden">
                              <div
                                className={`absolute top-0 h-full rounded-full ${
                                  p.position > 0 ? 'bg-emerald-500 left-1/2' : 'bg-rose-500 right-1/2'
                                }`}
                                style={{ width: `${Math.abs(p.position) * 50}%` }}
                              />
                              <div className="absolute top-0 left-1/2 w-px h-full bg-ink-400/50" />
                            </div>
                            <div className={`w-12 text-right font-mono font-semibold ${
                              p.position > 0.2 ? 'text-emerald-600' :
                              p.position < -0.2 ? 'text-rose-600' : 'text-ink-500'
                            }`}>
                              {p.position >= 0 ? '+' : ''}{p.position.toFixed(2)}
                            </div>
                          </div>
                        ))}
                    </div>

                    <div className="mt-3 text-[11px] text-ink-600 dark:text-ink-400 italic">
                      {resolution.summary}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* ---------- 右栏：7 步详情 + 实时事件流 ---------- */}
          <motion.div variants={fadeUp} className="lg:col-span-7 space-y-4">
            {/* 部门关系图（力导向） */}
            {company && <DepartmentGraph company={company} height={400} />}

            {/* 知识图谱（参考 MiroFish GraphPanel） */}
            {graphData.nodes.length > 0 && (
              <KnowledgeGraph nodes={graphData.nodes} edges={graphData.edges} height={400} />
            )}

            {/* 智能体采访（参考 MiroFish Step5Interaction） */}
            {companyId && <AgentInterview companyId={companyId} />}

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
            {(stage === 'SIMULATION_RUNNING' || simState?.status === 'running') && simState?.run_id && (
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
                      实时博弈事件流
                    </div>
                  </div>
                </div>
                <RoundTimeline simulationId={simState.run_id} />
              </div>
            )}

            {/* 操作面板（启动/重启） */}
            {!simState && (
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
                <button onClick={startPipeline} className="btn-primary">
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

// ---- 子组件 ----
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50">
      <div className="text-[10px] text-ink-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold text-ink-900 dark:text-white font-mono mt-0.5">{value}</div>
    </div>
  )
}

function DeptMini({ dept }: { dept: any }) {
  const support = dept.decision_power != null ? Math.round(dept.decision_power * 100) : 50
  return (
    <div className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50 border border-ink-200/50 dark:border-ink-800/50">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${support * 3.6}, 70%, 55%)` }} />
        <div className="text-[11px] font-semibold text-ink-900 dark:text-white truncate flex-1">
          {dept.name}
        </div>
      </div>
      <div className="text-[10px] text-ink-500">话语权 {support}%</div>
    </div>
  )
}
