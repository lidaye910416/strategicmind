/**
 * LatestRunGraph - Dashboard "最近完成的图谱"区块 (Bug #3 修复)。
 *
 * 之前: 独立 useEffect 调 /pipeline/runs + /pipeline/<id>/graph-snapshot,
 *        跟 RecentRuns / useCurrentGraph 3 处独立数据源。
 * 现在: 用 useCurrentGraph() 单一来源, 由 useCurrentRunView 的 queryFn 兜底。
 *        没有任何本地 useEffect 拉 snapshot。
 */
import { motion } from 'framer-motion'
import { Network, AlertCircle } from 'lucide-react'
import { useCurrentGraph } from '../../store/hooks/useCurrentRunView'
import RealtimeGraph from '../graph/RealtimeGraph'
import { DASHBOARD } from '../../i18n/zh'

export default function LatestRunGraph() {
  const { nodes, edges, source } = useCurrentGraph()

  if (source === 'empty') {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/40 dark:border-ink-800/40">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-brand-600 dark:text-brand-400" />
            <span className="text-[13px] font-bold text-ink-800 dark:text-ink-100">
              {DASHBOARD.latestGraphTitle}
            </span>
          </div>
        </div>
        <div className="bg-gradient-to-br from-ink-50/30 to-white/30 dark:from-ink-900/30 dark:to-ink-800/20">
          <div className="flex flex-col items-center justify-center h-[400px] gap-2 text-ink-400">
            <Network size={48} className="opacity-30" />
            <p className="text-xs">{DASHBOARD.latestGraphNoHistory}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/40 dark:border-ink-800/40">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-brand-600 dark:text-brand-400" />
          <span className="text-[13px] font-bold text-ink-800 dark:text-ink-100">
            {DASHBOARD.latestGraphTitle}
          </span>
          {source === 'snapshot' && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              snapshot
            </span>
          )}
        </div>
        <span className="text-[10px] text-ink-400">
          {nodes.length} 节点 · {edges.length} 关系
        </span>
      </div>
      <div className="bg-gradient-to-br from-ink-50/30 to-white/30 dark:from-ink-900/30 dark:to-ink-800/20">
        <RealtimeGraph
          height={400}
          title={DASHBOARD.latestGraphTitle}
          runId={null}
        />
      </div>
    </div>
  )
}
