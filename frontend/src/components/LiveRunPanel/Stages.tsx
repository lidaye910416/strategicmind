/**
 * frontend/src/components/LiveRunPanel/Stages.tsx
 *
 * 7 步推演流水线子组件 — 包 StageCards, 共享 useCurrentRunId/Meta
 */
import { motion } from 'framer-motion'
import { GitBranch } from 'lucide-react'
import {
  useCurrentRunId,
  useCurrentRunMeta,
} from '../../store/hooks/useCurrentRunView'
import { useStage, useStatus, useProgress } from '../../store/pipeline'
import StageCards from '../StageCards'

export default function Stages() {
  const runId = useCurrentRunId()
  const meta = useCurrentRunMeta()
  const stage = useStage()
  const status = useStatus()
  const progress = useProgress()
  if (!runId) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="card p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
          <GitBranch size={16} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
            7 步推演流水线详情
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white">
            实时富内容阶段卡
          </div>
        </div>
      </div>
      <StageCards
        runId={runId}
        currentStage={stage}
        status={status}
        artifacts={meta?.artifacts || {}}
        progress={progress}
      />
    </motion.div>
  )
}
