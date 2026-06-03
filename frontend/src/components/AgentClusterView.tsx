/**
 * AgentClusterView - Visualize agent clusters
 * Implements: US-066
 */
import { useEffect, useState } from 'react'
import { Users, AlertCircle, Loader2 } from 'lucide-react'
import api from '../services/api'

interface Cluster { name: string; entity_types: string[]; agent_count: number; stance: string }
interface Props { simulationId: string }

const STANCE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  supportive: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  opposed: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700' },
  neutral: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' },
}

function stanceKey(s: string): keyof typeof STANCE_COLORS {
  const l = s.toLowerCase()
  if (l.includes('support')) return 'supportive'
  if (l.includes('oppos')) return 'opposed'
  return 'neutral'
}

export default function AgentClusterView({ simulationId }: Props) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get(`/simulation/${simulationId}/clusters`)
      .then((r) => setClusters(r.data?.clusters || []))
      .catch((e) => setError(e?.response?.data?.error || 'Failed to load clusters'))
      .finally(() => setLoading(false))
  }, [simulationId])

  if (loading) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1">
          <Users size={16} /> Agent Clusters
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1">
          <Users size={16} /> Agent Clusters
        </h3>
        <div className="flex items-center gap-2 text-sm text-red-600 py-4">
          <AlertCircle size={14} /> {error}
        </div>
      </div>
    )
  }
  if (clusters.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1">
          <Users size={16} /> Agent Clusters (0)
        </h3>
        <p className="text-sm text-gray-400 py-4">No clusters yet</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1">
        <Users size={16} /> Agent Clusters ({clusters.length})
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {clusters.map((c, i) => {
          const k = stanceKey(c.stance)
          const colors = STANCE_COLORS[k]
          return (
            <div key={i} className={`border ${colors.border} ${colors.bg} rounded-lg overflow-hidden`}>
              <div className={`px-3 py-2 ${colors.text} font-medium flex justify-between items-center`}>
                <span className="text-sm">{c.name}</span>
                <span className="text-xs opacity-75">{c.agent_count} agents</span>
              </div>
              <div className="px-3 py-2 text-xs space-y-1">
                <div className="flex flex-wrap gap-1">
                  {c.entity_types.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-white rounded text-gray-700 border border-gray-200">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="text-gray-500">Stance: {c.stance}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
