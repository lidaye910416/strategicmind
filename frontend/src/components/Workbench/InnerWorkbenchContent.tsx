/**
 * InnerWorkbenchContent — Workbench 3-region 布局的中心面板 (T2.3)
 *
 * 6 tab 一次只显示一个, 减少空白占位堆叠:
 *   1) 实时图谱 (realtime)    — RealtimeKG + Polling toggle
 *   2) 部门 Agent (departments) — 公司画像 + 部门列表 + 部门关系图
 *   3) 议题推演 (debate)       — 议题输入 + 多回合 + 公司决议
 *   4) 智能体采访 (interview)  — AgentInterview
 *   5) 推演分析 (analysis)     — 信念演化 + 关系网时序 + 风险矩阵
 *   6) 涌现议题 (topics)      — EmergedTopics + BeliefShift + GraphRoundDiff
 *
 * 数据源: 由父组件 Workbench.tsx 传入。
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.3
 */
import { memo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Network, Zap, Activity, Loader2, FileDown, Lightbulb, RefreshCw, Play, Sparkles,
  Users, MessageSquare,
} from 'lucide-react'
import type { CompanyContext, TopicResolution } from '../../services/companyApi'
import { WORKBENCH, APP_ROUTES } from '../../i18n/zh'
import { fadeUp } from '../../lib/motion'
import type {
  SimRound, GraphNodeData, NetworkFrameLive, RiskItem,
} from '../../store/pipeline'
import Stat from './Stat'
import DeptMini from './DeptMini'
import DepartmentGraph from '../DepartmentGraph'
import RealtimeKnowledgeGraph from '../graph/RealtimeGraph'
import EntityTypeLegend from '../EntityTypeLegend'
import BeliefEvolutionChart from '../BeliefEvolutionChart'
import SimulationNetworkGraph from '../SimulationNetworkGraph'
import RiskMatrixHeatmap from '../RiskMatrixHeatmap'
import RoundTimeline from '../RoundTimeline'
import EmergedTopicsTimeline from './EmergedTopicsTimeline'
import BeliefShiftFeed from '../BeliefShiftFeed'
import GraphRoundDiff from './GraphRoundDiff'
import DeeperSimCta from './DeeperSimCta'
import AgentInterview from '../AgentInterview'

export interface InnerWorkbenchContentProps {
  company: CompanyContext | null
  companyId: string | null
  runId: string | null
  status: string
  stage: string
  topicInput: string
  setTopicInput: (s: string) => void
  resolution: TopicResolution | null
  resolving: boolean
  resolveTopic: () => Promise<void> | void
  runCompanySimulation: () => Promise<void> | void
  simResult: any
  simulating: boolean
  simulatingRound: number
  simulatingPct: number
  downloadCompanyReport: () => void
  handleStartPipeline: () => Promise<void> | void
  graphNodes: GraphNodeData[]
  graphProgress: { phase: string; nodes: number; edges: number }
  simRounds: SimRound[]
  networkFrames: NetworkFrameLive[]
  reportRisks: RiskItem[]
  graphRefreshIntervalMs: number
  setGraphRefreshIntervalMs: (n: number | ((prev: number) => number)) => void
  dataTestId?: string
}

const TABS = [
  { id: 'realtime',    label: '实时图谱', icon: Network },
  { id: 'departments', label: '部门',     icon: Users },
  { id: 'debate',      label: '议题推演', icon: Zap },
  { id: 'interview',   label: '采访',     icon: MessageSquare },
  { id: 'analysis',    label: '分析',     icon: Activity },
  { id: 'topics',      label: '涌现议题', icon: Lightbulb },
] as const

type TabId = (typeof TABS)[number]['id']

function InnerWorkbenchContentImpl({
  company,
  companyId,
  runId,
  status,
  stage,
  topicInput,
  setTopicInput,
  resolution,
  resolving,
  resolveTopic,
  runCompanySimulation,
  simResult,
  simulating,
  simulatingRound,
  simulatingPct,
  downloadCompanyReport,
  handleStartPipeline,
  graphNodes,
  graphProgress,
  simRounds,
  networkFrames,
  reportRisks,
  graphRefreshIntervalMs,
  setGraphRefreshIntervalMs,
  dataTestId = 'wb-inner',
}: InnerWorkbenchContentProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('realtime')

  // ---- Tab content renderers ----

  /** Tab 1: 实时图谱 */
  const renderRealtimeTab = () => (
    <div className="space-y-3">
      {graphNodes.length > 0 || runId ? (
        <section id="graph" className="card p-3 scroll-mt-28 relative">
          <RealtimeKnowledgeGraph
            runId={runId}
            live
            height={360}
            title={WORKBENCH.realtimeGraphTitle}
            refreshIntervalMs={graphRefreshIntervalMs}
          />
          <EntityTypeLegend overlay />
          <div className="mt-2 flex items-center gap-2">
            <button
              data-testid="realtime-kg-polling-toggle"
              onClick={() =>
                setGraphRefreshIntervalMs((v) => (v > 0 ? 0 : 30000))
              }
              className={`btn-ghost h-7 text-[11px] ${
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
        <section id="graph" className="card p-6 flex flex-col items-center justify-center min-h-[280px] scroll-mt-28">
          <Loader2 size={28} className="text-brand-500 animate-spin mb-2" />
          <div className="text-sm font-semibold text-ink-700 dark:text-ink-200">
            {WORKBENCH.loadingGraph}
          </div>
          <div className="text-[10px] text-ink-400 mt-1 font-mono">
            {graphProgress.phase} · {graphProgress.nodes} 节点 / {graphProgress.edges} 边
          </div>
        </section>
      ) : runId ? (
        <section id="graph" className="card p-6 text-center min-h-[280px] flex flex-col items-center justify-center scroll-mt-28">
          <Network size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">未找到该 run 的知识图谱快照</div>
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[280px] flex flex-col items-center justify-center">
          <Network size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">启动推演后, 实体图谱会实时显示在这里</div>
        </div>
      )}

      {/* 实时事件流（仅在推演时显示） */}
      {(stage === 'SIMULATION_RUNNING' || status === 'running') && runId && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-brand-500/20 inline-flex items-center justify-center text-emerald-600">
              <Activity size={13} />
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
    </div>
  )

  /** Tab 2: 部门 */
  const renderDepartmentsTab = () => (
    <div className="space-y-3">
      {/* 公司画像 */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
            <Network size={14} />
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
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-semibold">
              {company.business_model.model_name_cn}
            </span>
          )}
        </div>

        {company && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={WORKBENCH.statMargin} value={`${(company.business_model.margin_baseline * 100).toFixed(0)}%`} />
              <Stat label={WORKBENCH.statShock} value={company.business_model.shock_resilience.toFixed(2)} />
              <Stat label={WORKBENCH.statCycle} value={company.market_env.cycle_label_cn} />
            </div>

            <div className="mt-3">
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

      {/* 部门关系图 */}
      {company && company.departments.length > 0 ? (
        <section id="rel" className="card p-3 scroll-mt-28">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-2">
            部门关系
          </div>
          <DepartmentGraph company={company} height={300} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[200px] flex flex-col items-center justify-center">
          <Users size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">部门关系图会在公司画像加载后显示</div>
        </div>
      )}
    </div>
  )

  /** Tab 3: 议题推演 */
  const renderDebateTab = () => (
    <div className="space-y-3">
      <section id="dept" className="card p-4 scroll-mt-28">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
            <Zap size={14} />
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
            className="btn-primary h-9"
          >
            {resolving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {WORKBENCH.debateRun}
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={runCompanySimulation}
              disabled={!companyId || simulating}
              className="btn-ghost h-7 text-[11px] flex-1"
              title={WORKBENCH.runMultiRoundTitle}
            >
              {simulating ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
              {WORKBENCH.runMultiRound}
            </button>
            <button
              onClick={downloadCompanyReport}
              disabled={!companyId}
              className="btn-ghost h-7 text-[11px] px-2"
              title={WORKBENCH.downloadReportTitle}
            >
              <FileDown size={11} />
            </button>
          </div>
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
              className="mt-3 p-3 rounded-xl bg-gradient-to-br from-brand-50 to-accent-50/40 dark:from-brand-950/40 dark:to-accent-950/20 border border-brand-200/50"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.companyStance}
                  </div>
                  <div className="text-xl font-bold font-mono text-brand-700 dark:text-brand-300">
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

              <div className="space-y-1.5">
                {resolution.positions
                  .sort((a, b) => b.position - a.position)
                  .map((p) => {
                    const pos = Math.max(-1, Math.min(1, p.position))
                    return (
                      <div key={p.dept_type} className="flex items-center gap-2 text-[11px]">
                        <div className="w-16 text-ink-600 dark:text-ink-300 truncate">{p.dept_name}</div>
                        <div className="flex-1 h-2 rounded-full bg-ink-200/60 dark:bg-ink-800/60 relative overflow-hidden">
                          <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '25%' }} aria-hidden="true" />
                          <div className="absolute top-0 h-full w-px bg-ink-400/70 dark:bg-ink-500/70" style={{ left: '50%' }} aria-hidden="true" />
                          <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '75%' }} aria-hidden="true" />
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

              <div className="mt-2 text-[11px] text-ink-600 dark:text-ink-400 italic">
                {resolution.summary}
              </div>

              {runId && (
                <button
                  onClick={() => {
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
                             h-8 px-3 rounded-lg
                             bg-gradient-to-r from-brand-500 to-accent-500
                             text-white text-xs font-semibold
                             hover:from-brand-600 hover:to-accent-600
                             shadow-soft transition-all"
                  title={WORKBENCH.ctaStartNewRoundTitle}
                >
                  <Lightbulb size={12} /> {WORKBENCH.ctaStartNewRound}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )

  /** Tab 4: 智能体采访 */
  const renderInterviewTab = () => (
    <div className="space-y-3">
      {companyId ? (
        <section id="interview" className="scroll-mt-28">
          <AgentInterview companyId={companyId} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[200px] flex flex-col items-center justify-center">
          <MessageSquare size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">启动推演后, 可对部门 Agent 发起智能体采访</div>
        </div>
      )}
    </div>
  )

  /** Tab 5: 推演分析 */
  const renderAnalysisTab = () => (
    <div className="space-y-3">
      {/* 信念演化多线 LineChart — #belief 锚点 */}
      {simRounds.length > 0 ? (() => {
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
        if (data.length === 0 || agents.length === 0) {
          return (
            <div className="card p-6 text-center min-h-[160px] flex flex-col items-center justify-center">
              <Activity size={24} className="text-ink-300 mb-2" />
              <div className="text-xs text-ink-500">信念演化图表会在推演推进后显示</div>
            </div>
          )
        }
        return (
          <section id="belief" className="card p-4 scroll-mt-28">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
                <Activity size={13} />
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
      })() : (
        <div className="card p-6 text-center min-h-[160px] flex flex-col items-center justify-center">
          <Activity size={24} className="text-ink-300 mb-2" />
          <div className="text-xs text-ink-500">信念演化图表会在推演推进后显示</div>
        </div>
      )}

      {/* 关系网时序图 — #net 锚点 */}
      {networkFrames.length > 0 && (
        <section id="net" className="card p-4 scroll-mt-28">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
              <Network size={13} />
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
            height={300}
            title={WORKBENCH.networkTitle}
          />
        </section>
      )}

      {/* 风险矩阵热力图 — #risks 锚点 */}
      {reportRisks.length > 0 ? (
        <section id="risks" className="card p-4 scroll-mt-28">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500/20 to-amber-500/20 inline-flex items-center justify-center text-rose-600">
              <Zap size={13} />
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
      ) : (
        <div className="card p-6 text-center min-h-[120px] flex flex-col items-center justify-center">
          <Zap size={24} className="text-ink-300 mb-2" />
          <div className="text-xs text-ink-500">报告生成后, 这里会显示风险矩阵</div>
        </div>
      )}

      {/* 进一步推演 CTA — 仅 completed/failed 显示 */}
      <DeeperSimCta />
    </div>
  )

  /** Tab 6: 涌现议题 */
  const renderTopicsTab = () => (
    <div className="space-y-3">
      {/* 涌现议题时间线 */}
      <EmergedTopicsTimeline />
      {/* 信念漂移事件流 */}
      <BeliefShiftFeed />
      {/* 图谱轮次 diff 对比 */}
      <GraphRoundDiff />
      {/* 操作面板（启动/重启） — 无 runId 时 */}
      {!runId && (
        <div className="card p-6 text-center bg-gradient-to-br from-brand-50/50 to-accent-50/30 dark:from-brand-950/20 dark:to-accent-950/10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 mx-auto inline-flex items-center justify-center text-white shadow-glow mb-2">
            <Sparkles size={20} />
          </div>
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
            {WORKBENCH.startTitle}
          </h3>
          <p className="text-xs text-ink-500 dark:text-ink-400 mb-3 max-w-md mx-auto">
            {WORKBENCH.startDesc}
          </p>
          <button onClick={handleStartPipeline} className="btn-primary">
            <Play size={14} /> {WORKBENCH.start}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      data-testid={dataTestId}
      className="h-full w-full flex flex-col"
    >
      {/* ===== Tab bar ===== */}
      <div
        data-testid="wb-inner-tabs"
        className="flex-shrink-0 flex gap-1 border-b border-ink-200/60 dark:border-ink-800/60 mb-2 px-1 overflow-x-auto nice-scroll"
        role="tablist"
      >
        {TABS.map((t) => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              data-testid={`wb-tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`flex-shrink-0 px-3 h-8 text-[11px] font-medium rounded-t-md flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                active
                  ? 'bg-brand-500 text-white'
                  : 'text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-white hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ===== Tab content ===== */}
      <motion.div
        variants={fadeUp}
        className="flex-1 min-h-0 overflow-y-auto nice-scroll pr-1"
        data-testid={`wb-tab-panel-${activeTab}`}
      >
        {activeTab === 'realtime'    && renderRealtimeTab()}
        {activeTab === 'departments' && renderDepartmentsTab()}
        {activeTab === 'debate'      && renderDebateTab()}
        {activeTab === 'interview'   && renderInterviewTab()}
        {activeTab === 'analysis'    && renderAnalysisTab()}
        {activeTab === 'topics'      && renderTopicsTab()}
      </motion.div>
    </div>
  )
}

const InnerWorkbenchContent = memo(InnerWorkbenchContentImpl)
export default InnerWorkbenchContent
