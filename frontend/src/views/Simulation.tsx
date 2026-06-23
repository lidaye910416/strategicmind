/**
 * 推演视图 - 实时推演进度与分析。
 *
 * 主视觉：每回合博弈事件流（工作台风格）
 * 辅助：信念演化、阵营分布、利益相关方关系图（折叠）
 *
 * Implements: US-061, US-063, US-100
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Pause, Play, X, FileText, Loader2, ArrowUpRight,
  AlertCircle, Home, ChevronDown, Activity, Users, GitBranch,
} from 'lucide-react'
import api from '../services/api'
import SimulationRoundProgress from '../components/SimulationRoundProgress'
import RoundTimeline from '../components/RoundTimeline'
import BeliefEvolutionChart from '../components/BeliefEvolutionChart'
import AgentListView from '../components/agent/AgentListView'
import StakeholderMap from '../components/StakeholderMap'
import NotificationToast from '../components/NotificationToast'
import Hero from '../components/layout/Hero'
import { SIMULATION, STATUS_LABELS, COMMON, APP_ROUTES } from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'

interface SimulationState {
  run_id: string
  current_round: number
  total_rounds: number
  active_agents: number
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  stage?: string
}

interface BeliefPoint { round: number; [agent: string]: number }

export default function Simulation() {
  const { runId = '' } = useParams<{ runId: string }>()
  const [state, setState] = useState<SimulationState | null>(null)
  const [beliefs, setBeliefs] = useState<BeliefPoint[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [notFound, setNotFound] = useState(false)
  // P1-3: 默认展开高级视图（信念演化 + 阵营分布），仍可手动折叠
  const [showAdvanced, setShowAdvanced] = useState(true)

  useEffect(() => {
    if (!runId) return
    loadStatus()
    const t = setInterval(loadStatus, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const loadStatus = async () => {
    try {
      const r = await api.get(`/simulation/${runId}`)
      setState(r.data)
      setNotFound(false)
      try {
        const br = await api.get(`/simulation/${runId}/beliefs`)
        const beliefData: BeliefPoint[] = br.data?.beliefs || []
        setBeliefs(beliefData)
        setAgents(
          beliefData.length > 0
            ? Object.keys(beliefData[0]).filter((k) => k !== 'round')
            : []
        )
      } catch { /* may be empty until first round completes */ }
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setNotFound(true)
      }
      console.error('加载推演状态失败', e)
    }
  }

  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    try { await api.post(`/simulation/${runId}/${action}`); await loadStatus() }
    catch (e) { console.error(`操作 ${action} 失败`, e) }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card p-8 max-w-md text-center"
        >
          <div className="w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-900/40
                          inline-flex items-center justify-center text-rose-600 dark:text-rose-300 mb-3">
            <AlertCircle size={22} />
          </div>
          <h2 className="text-lg font-semibold text-ink-900 dark:text-white mb-1">
            找不到推演 {runId}
          </h2>
          <p className="text-sm text-ink-500 dark:text-ink-400 mb-5">
            该运行 ID 不存在或已过期。可以从左侧「最近运行」列表选择一个，或在工作台发起新的推演。
          </p>
          <div className="flex gap-2 justify-center">
            <Link to={APP_ROUTES.home} className="btn-primary h-9">
              <Home size={14} /> {COMMON.backToDashboard}
            </Link>
            <Link to="/demo" className="btn-ghost h-9">
              查看案例示范
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-500">
        <Loader2 className="animate-spin mr-2" size={20} />
        {COMMON.loadingSimulation(runId)}
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <NotificationToast status={state.status} runId={runId} stage={state.stage} />

      <Hero
        eyebrow={`运行 ID · ${runId}`}
        title={SIMULATION.title}
        subtitle="实时查看博弈推演的回合进展、信念演化、阵营分布与利益相关方关系图。"
        rightSlot={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={APP_ROUTES.home} className="btn-ghost h-9">
              <ArrowLeft size={14} /> {COMMON.backToDashboard}
            </Link>
            <span className={`badge-${state.status}`}>{STATUS_LABELS[state.status] || state.status}</span>
            {state.status === 'running' && (
              <button className="btn-ghost h-9" onClick={() => control('pause')}>
                <Pause size={14} /> {SIMULATION.pause}
              </button>
            )}
            {state.status === 'paused' && (
              <button className="btn-primary h-9" onClick={() => control('resume')}>
                <Play size={14} /> {SIMULATION.resume}
              </button>
            )}
            {(state.status === 'running' || state.status === 'paused') && (
              <button className="btn-danger h-9" onClick={() => control('cancel')}>
                <X size={14} /> {SIMULATION.cancel}
              </button>
            )}
            {state.status === 'completed' && (
              <Link to={APP_ROUTES.report(runId)} className="btn-primary h-9">
                <FileText size={14} /> {SIMULATION.viewReport}
                <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
        }
      />

      <motion.div
        variants={stagger(0.07)}
        initial="initial"
        animate="animate"
        className="px-6 md:px-10 pb-16 space-y-4 max-w-6xl"
      >
        <motion.div variants={fadeUp}>
          <SimulationRoundProgress
            currentRound={state.current_round || 0}
            totalRounds={state.total_rounds || 10}
            activeAgents={state.active_agents || 0}
          />
        </motion.div>

        {/* 主视觉：每回合博弈时间线 */}
        <motion.div variants={fadeUp}>
          <RoundTimeline simulationId={runId} />
        </motion.div>

        {/* 高级视图（折叠）：信念演化、阵营分布、利益相关方 */}
        <motion.div variants={fadeUp}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full card p-4 flex items-center justify-between text-left
                       hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20
                              inline-flex items-center justify-center text-brand-600 dark:text-brand-400">
                <Activity size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900 dark:text-white">
                  高级视图：信念演化 / 阵营分布 / 利益相关方
                </div>
                <div className="text-[11px] text-ink-500 dark:text-ink-400">
                  展开查看图谱分析、信念曲线与阵营聚类
                </div>
              </div>
            </div>
            <motion.div
              animate={{ rotate: showAdvanced ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={18} className="text-ink-400" />
            </motion.div>
          </button>
          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  <div className="card p-5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wider mb-2">
                      <Activity size={12} /> 信念演化
                    </div>
                    <BeliefEvolutionChart data={beliefs} agents={agents} />
                  </div>
                  <div className="card p-5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wider mb-2">
                      <Users size={12} /> 阵营分布
                    </div>
                    <AgentListView runId={runId} variant="full" />
                  </div>
                </div>
                <div className="card p-5 mt-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 dark:text-ink-400 uppercase tracking-wider mb-2">
                    <GitBranch size={12} /> 利益相关方关系图
                  </div>
                  <StakeholderMap simulationId={runId} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  )
}
