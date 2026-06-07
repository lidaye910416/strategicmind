/**
 * LatestRunGraph - 首页"上次完成的图谱"区块。
 *
 * 职责:
 *   1. 拉 /api/pipeline/runs 取最新 status==='completed' 的 run
 *   2. 拉 /api/pipeline/<id>/graph-snapshot 拿真实 nodes/edges
 *   3. 用 RealtimeKnowledgeGraph 的 `fallback` 接口渲染（不走 SSE，不污染 store）
 *   4. 三态: loading / has-data / no-history
 *
 * 复用:
 *   - RealtimeKnowledgeGraph.tsx:131-151 (runId 路径) + :165-177 (fallback 路径)
 *   - 数据源与 RecentRuns.tsx:155 同端点 (/api/pipeline/runs)
 *
 * 不渲染条件:
 *   - 当前 runId 存在时 (用户已点启动) → 父组件不挂载本组件, LiveSnapshotSection 接管实时态
 *   - 无 completed run → 显示占位插画
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Network, AlertCircle } from 'lucide-react'
import api from '../../services/api'
import { DASHBOARD } from '../../i18n/zh'
import RealtimeKnowledgeGraph from '../RealtimeKnowledgeGraph'

interface Run {
  run_id: string
  status: string
  updated_at?: number
}

interface GraphData {
  nodes: any[]
  edges: any[]
}

export default function LatestRunGraph() {
  const [latestRunId, setLatestRunId] = useState<string | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shortId, setShortId] = useState<string>('')

  // 1) 取最新 completed run
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.get('/pipeline/runs')
      .then((r) => {
        if (cancelled) return
        const runs: Run[] = r.data.runs || []
        // 按 updated_at 降序, 取第一个 status==='completed'
        const completed = [...runs]
          .filter((x) => x.status === 'completed')
          .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        if (completed.length === 0) {
          setLatestRunId(null)
          setLoading(false)
          return
        }
        const top = completed[0]
        setLatestRunId(top.run_id)
        setShortId(top.run_id.replace(/^run_/, '').slice(0, 6))
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e?.message || e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // 2) 拿到 runId 后拉 graph-snapshot
  useEffect(() => {
    if (!latestRunId) return
    let cancelled = false
    setLoading(true)
    api.get(`/pipeline/${latestRunId}/graph-snapshot`)
      .then((r) => {
        if (cancelled) return
        const data = r.data
        const nodes = data?.nodes || []
        const edges = data?.edges || []
        setGraphData({ nodes, edges })
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e?.message || e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [latestRunId])

  // 3) 三态渲染
  return (
    <div className="card overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/40 dark:border-ink-800/40">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-brand-600 dark:text-brand-400" />
          <span className="text-[13px] font-bold text-ink-800 dark:text-ink-100">
            {DASHBOARD.latestGraphTitle}
          </span>
          {shortId && (
            <span className="text-[10px] font-mono text-ink-400">#{shortId}</span>
          )}
        </div>
        {graphData && (
          <span className="text-[10px] text-ink-400">
            {graphData.nodes.length} 节点 · {graphData.edges.length} 关系
          </span>
        )}
      </div>

      {/* 内容区 */}
      <div className="bg-gradient-to-br from-ink-50/30 to-white/30 dark:from-ink-900/30 dark:to-ink-800/20">
        {error ? (
          <div className="flex items-center gap-2 px-4 py-8 text-xs text-rose-500 justify-center">
            <AlertCircle size={14} />
            {DASHBOARD.latestGraphFailed(latestRunId || '?')}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-[400px]">
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className="text-xs text-ink-400"
            >
              {DASHBOARD.latestGraphLoading}
            </motion.div>
          </div>
        ) : !graphData || graphData.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] gap-2 text-ink-400">
            <Network size={48} className="opacity-30" />
            <p className="text-xs">{DASHBOARD.latestGraphNoHistory}</p>
          </div>
        ) : (
          <RealtimeKnowledgeGraph
            key={latestRunId}
            runId={null}
            live={false}
            height={400}
            title={DASHBOARD.latestGraphTitle}
            fallback={graphData}
          />
        )}
      </div>
    </div>
  )
}
