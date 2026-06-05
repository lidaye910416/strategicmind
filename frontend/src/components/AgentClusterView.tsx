/**
 * AgentClusterView - Visualize agent clusters
 * Implements: US-066
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, AlertCircle, Loader2 } from 'lucide-react'
import api from '../services/api'
import { SIMULATION, CLUSTER_STANCE_LABELS } from '../i18n/zh'

interface Cluster { name: string; entity_types: string[]; agent_count: number; stance: string }
interface Props { simulationId: string }

const STANCE_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  supportive: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/60 dark:border-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  opposed:    { bg: 'bg-rose-50 dark:bg-rose-950/30',          border: 'border-rose-200/60 dark:border-rose-900/40',          text: 'text-rose-700 dark:text-rose-300',          dot: 'bg-rose-500' },
  neutral:    { bg: 'bg-ink-50 dark:bg-ink-900/40',            border: 'border-ink-200/60 dark:border-ink-800/60',            text: 'text-ink-700 dark:text-ink-200',            dot: 'bg-ink-400' },
}

function stanceKey(s: string): keyof typeof STANCE_STYLES {
  const l = s.toLowerCase()
  if (l.includes('support') || l.includes('支持')) return 'supportive'
  if (l.includes('oppos') || l.includes('反对')) return 'opposed'
  return 'neutral'
}

export default function AgentClusterView({ simulationId }: Props) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get(`/simulation/${simulationId}/clusters`)
      .then((r) => setClusters(r.data?.clusters || []))
      .catch((e) => setError(e?.response?.data?.error || SIMULATION.failed))
      .finally(() => setLoading(false))
  }, [simulationId])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white flex items-center gap-1.5">
          <Users size={14} /> {SIMULATION.clustersTitle(clusters.length)}
        </h3>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400 py-8 justify-center">
          <Loader2 size={14} className="animate-spin" /> {SIMULATION.loading}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 py-4">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {!loading && !error && clusters.length === 0 && (
        <div className="text-sm text-ink-400 dark:text-ink-500 py-8 text-center
                        border border-dashed border-ink-200 dark:border-ink-800 rounded-xl">
          {SIMULATION.clustersEmpty}
        </div>
      )}
      {!loading && !error && clusters.length > 0 && (
        <motion.div
          initial="hidden" animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {clusters.map((c, i) => {
            const k = stanceKey(c.stance)
            const s = STANCE_STYLES[k]
            return (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
                }}
                className={`rounded-xl border ${s.border} ${s.bg} overflow-hidden
                            hover:shadow-card transition-shadow duration-200`}
              >
                <div className={`px-3 py-2 ${s.text} font-medium flex justify-between items-center`}>
                  <span className="text-sm flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                    {c.name}
                  </span>
                  <span className="text-xs opacity-75">{c.agent_count} Agent</span>
                </div>
                <div className="px-3 py-2 text-xs space-y-1.5">
                  <div className="flex flex-wrap gap-1">
                    {c.entity_types.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 bg-white/80 dark:bg-ink-800/60
                                                rounded text-ink-600 dark:text-ink-300
                                                border border-ink-200/40 dark:border-ink-700/40">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="text-ink-500 dark:text-ink-400">
                    立场: {CLUSTER_STANCE_LABELS[k] || c.stance}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}
