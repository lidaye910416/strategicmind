/**
 * Simulation view - real-time simulation progress and analysis.
 *
 * Implements: US-061, US-063
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, X, FileText } from 'lucide-react'
import api from '../services/api'
import SimulationRoundProgress from '../components/SimulationRoundProgress'
import BeliefEvolutionChart from '../components/BeliefEvolutionChart'
import AgentClusterView from '../components/AgentClusterView'
import StakeholderMap from '../components/StakeholderMap'
import NotificationToast from '../components/NotificationToast'

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
    } catch (e) {
      console.error('Failed to load simulation status', e)
    }
  }

  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    try { await api.post(`/simulation/${runId}/${action}`); await loadStatus() }
    catch (e) { console.error(`Failed to ${action}`, e) }
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={20} />
        Loading simulation {runId}…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NotificationToast status={state.status} runId={runId} stage={state.stage} />

      <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center gap-3 sticky top-0 z-10">
        <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <ArrowLeft size={16} /> Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Simulation: {runId}</h1>
        <span className={`badge-${state.status}`}>{state.status}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {state.status === 'running' && (
            <button className="btn-ghost" onClick={() => control('pause')} title="Pause">
              <Pause size={16} /> Pause
            </button>
          )}
          {state.status === 'paused' && (
            <button className="btn-primary" onClick={() => control('resume')} title="Resume">
              <Play size={16} /> Resume
            </button>
          )}
          {(state.status === 'running' || state.status === 'paused') && (
            <button className="btn-danger" onClick={() => control('cancel')} title="Cancel">
              <X size={16} /> Cancel
            </button>
          )}
          {state.status === 'completed' && (
            <Link to={`/report/${runId}`} className="btn-primary">
              <FileText size={16} /> View Report
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <SimulationRoundProgress
          currentRound={state.current_round || 0}
          totalRounds={state.total_rounds || 10}
          activeAgents={state.active_agents || 0}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <BeliefEvolutionChart data={beliefs} agents={agents} />
          </div>
          <div className="card">
            <AgentClusterView simulationId={runId} />
          </div>
        </div>
        <div className="card">
          <StakeholderMap simulationId={runId} />
        </div>
      </main>
    </div>
  )
}

function Loader2({ className, size }: { className?: string; size: number }) {
  return <span className={className} style={{ display: 'inline-block', width: size, height: size }}>⏳</span>
}
