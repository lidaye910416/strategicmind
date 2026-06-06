/**
 * LiveSnapshotSection - 推演实时可视化（与 Workbench 同源的 LiveRunPanel 紧凑版）。
 *
 * 来源：原 views/Dashboard.tsx 行 493-502 区块，P2-8 拆出。
 */
import { motion } from 'framer-motion'
import LiveRunPanel from '../LiveRunPanel'

interface Props {
  runId: string
  status: string | undefined
}

export default function LiveSnapshotSection({ runId, status }: Props) {
  if (!runId || status === 'idle') return null
  return (
    <motion.section>
      <LiveRunPanel
        runId={runId}
        compact
        title="推演实时可视化"
        subtitle="这是 Workbench 的核心可视化紧凑版 · 点击右上角进入完整工作台"
      />
    </motion.section>
  )
}
