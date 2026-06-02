/**
 * Simulation view - real-time simulation progress and analysis.
 *
 * Implements: US-061, US-063
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, X } from 'lucide-react'
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

interface BeliefPoint {
  round: number
  [agent: string]: number
}

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
      const data: SimulationState = r.data
      setState(data)
      // Pull belief evolution
      try {
        const br = await api.get(`/simulation/${runId}/beliefs`)
        const beliefData = (br.data?.beliefs || []) as BeliefPoint[]
        const agentNames = beliefData.length > 0
          ? Object.keys(beliefData[0]).filter((k) => k !== 'round')
          : []
        setBeliefs(beliefData)
        setAgents(agentNames)
      } catch {
        // beliefs may be empty until first round completes
      }
    } catch (e) {
      console.error('Failed to load simulation status', e)
    }
  }

  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      await api.post(`/simulation/${runId}/${action}`)
      await loadStatus()
    } catch (e) {
      console.error(`Failed to ${action}`, e)
    }
  }

  if (!state) {
    return (
      <div className="simulation-view">
        <Link to="/">← Back</Link>
        <p>Loading simulation {runId}…</p>
      </div>
    )
  }

  return (
    <div className="simulation-view">
      <NotificationToast status={state.status} runId={runId} stage={state.stage} />

      <header className="view-header">
        <Link to="/"><ArrowLeft size={16} /> Dashboard</Link>
        <h1>Simulation: {runId}</h1>
        <div className="controls">
          {state.status === 'running' && (
            <button onClick={() => control('pause')} title="Pause"><Pause size={16} /></button>
          )}
          {state.status === 'paused' && (
            <button onClick={() => control('resume')} title="Resume"><Play size={16} /></button>
          )}
          {(state.status === 'running' || state.status === 'paused') && (
            <button onClick={() => control('cancel')} title="Cancel"><X size={16} /></button>
          )}
          {state.status === 'completed' && (
            <Link className="view-report-link" to={`/report/${runId}`}>
              View Report →
            </Link>
          )}
        </div>
      </header>

      <SimulationRoundProgress
        currentRound={state.current_round || 0}
        totalRounds={state.total_rounds || 10}
        activeAgents={state.active_agents || 0}
      />

      <section className="analysis-grid">
        <div className="card">
          <BeliefEvolutionChart data={beliefs} agents={agents} />
        </div>
        <div className="card">
          <AgentClusterView simulationId={runId} />
        </div>
        <div className="card full">
          <StakeholderMap simulationId={runId} />
        </div>
      </section>
    </div>
  )
}
