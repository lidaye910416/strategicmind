/**
 * LiveSnapshotSection - Dashboard 上的"推演实时可视化"紧凑版 (Bug #3 修复)。
 *
 * Bug #3 修复: 改用 LiveRunPanel sub-components (Graph + Network), 不再调旧
 * LiveRunPanel.tsx shim (避免 deprecation 警告刷屏)。
 */
import { motion } from 'framer-motion'
import { Maximize2, ChevronRight, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Graph, Network } from '../LiveRunPanel'
import { APP_ROUTES } from '../../i18n/zh'

interface Props {
  runId: string
  status: string | undefined
}

export default function LiveSnapshotSection({ runId, status }: Props) {
  if (!runId || status === 'idle') return null
  return (
    <motion.section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
            <Radio size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              推演实时可视化
            </div>
            <div className="text-xs text-ink-700 dark:text-ink-300 truncate">
              这是 Workbench 的核心可视化紧凑版 · 点击右上角进入完整工作台
            </div>
          </div>
        </div>
        <Link
          to={APP_ROUTES.workbenchWithRun(runId)}
          className="btn-ghost h-8 text-[11px] flex items-center gap-1 flex-shrink-0"
        >
          <Maximize2 size={11} /> 完整工作台
          <ChevronRight size={11} />
        </Link>
      </div>
      <Graph />
      <Network />
    </motion.section>
  )
}
