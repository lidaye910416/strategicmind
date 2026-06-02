/**
 * AgentClusterView - Visualize agent clusters
 * Implements: US-066
 */
import { useEffect, useState } from 'react'
import api from '../services/api'

interface Cluster {
  name: string
  entity_types: string[]
  agent_count: number
  stance: string
}

interface Props {
  simulationId: string
}

export default function AgentClusterView({ simulationId }: Props) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClusters()
  }, [simulationId])

  const loadClusters = async () => {
    try {
      const response = await api.get(`/simulation/${simulationId}/clusters`)
      setClusters(response.data.clusters || [])
    } catch (error) {
      console.error('Failed to load clusters:', error)
    } finally {
      setLoading(false)
    }
  }

  const stanceColor = (stance: string) => {
    const s = stance.toLowerCase()
    if (s.includes('supportive')) return '#4caf50'
    if (s.includes('opposed')) return '#f44336'
    if (s.includes('neutral')) return '#9e9e9e'
    return '#2196f3'
  }

  if (loading) return <div>Loading clusters...</div>

  return (
    <div className="agent-cluster-view">
      <h3>Agent Clusters ({clusters.length})</h3>
      <div className="cluster-grid">
        {clusters.map((cluster, i) => (
          <div 
            key={i} 
            className="cluster-card"
            style={{ borderColor: stanceColor(cluster.stance) }}
          >
            <div className="cluster-header" style={{ background: stanceColor(cluster.stance) }}>
              <h4>{cluster.name}</h4>
              <span className="agent-count">{cluster.agent_count} agents</span>
            </div>
            <div className="cluster-body">
              <div className="entity-types">
                {cluster.entity_types.map(t => (
                  <span key={t} className="type-tag">{t}</span>
                ))}
              </div>
              <div className="stance">Stance: {cluster.stance}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
