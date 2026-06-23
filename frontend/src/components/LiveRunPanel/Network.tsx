/**
 * frontend/src/components/LiveRunPanel/Network.tsx
 *
 * 迭代关系网子组件 — 包 SimulationNetworkGraph
 */
import { motion } from 'framer-motion'
import SimulationNetworkGraph from '../SimulationNetworkGraph'
import { useCurrentRunId } from '../../store/hooks/useCurrentRunView'

export default function Network() {
  const runId = useCurrentRunId()
  if (!runId) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
    >
      <SimulationNetworkGraph runId={runId} height={400} title="迭代关系网" />
    </motion.div>
  )
}
