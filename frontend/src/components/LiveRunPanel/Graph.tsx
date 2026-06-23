/**
 * frontend/src/components/LiveRunPanel/Graph.tsx
 *
 * 实时图谱子组件 — 包 RealtimeGraph, 共享 useCurrentRunId
 */
import { motion } from 'framer-motion'
import RealtimeGraph from '../graph/RealtimeGraph'
import { useCurrentRunId } from '../../store/hooks/useCurrentRunView'

export default function Graph() {
  const runId = useCurrentRunId()
  if (!runId) {
    return (
      <div className="card p-8 text-center text-ink-500">
        实时图谱 · 尚未启动推演
      </div>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 }}
    >
      <RealtimeGraph runId={runId} height={440} title="实时知识图谱" />
    </motion.div>
  )
}
