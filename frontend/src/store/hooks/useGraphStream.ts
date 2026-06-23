/**
 * useGraphStream - N7 简化版。
 *
 * 之前: 内部有两个 useEffect 拉 REST /graph-snapshot 做兜底, 跟 useCurrentGraph 的
 *        selector 拼装逻辑耦合, 触发 Bug #3 跨页面数据漂移。
 * 现在: 退化为纯 SSE 订阅写 store, 不再拉 REST, 不再 return source 字段。
 *        REST 兜底迁到 useCurrentGraph 的 queryFn (setGraphSnapshot 回 store)。
 *
 * 兼容:
 *   - opts.fallback 仍接受但忽略 (走 useCurrentGraph 的 snapshot 路径)
 *   - source 字段 deprecated — 调用方改用 useCurrentGraph().source
 */
import { useMemo } from 'react'
import { useGraphNodes, useGraphEdges, useGraphProgress } from '../pipeline'
import type { GraphNodeData, GraphEdgeData } from '../pipeline'

export interface UseGraphStreamOptions {
  /** @deprecated — REST fallback 已迁到 useCurrentRunView 的 queryFn, 忽略此参数 */
  fallback?: { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null
}

export interface UseGraphStreamResult {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  progress: ReturnType<typeof useGraphProgress>
  /** @deprecated — 用 useCurrentGraph().source ('live' | 'snapshot' | 'empty') */
  source?: 'store' | 'fallback' | 'empty'
  totalNodes: number
  totalEdges: number
}

export function useGraphStream(
  _runId: string | null | undefined,
  _opts: UseGraphStreamOptions = {},
): UseGraphStreamResult {
  // 仅订阅 store 字段 (SSE 已通过 store._openSSE 写入)
  const storeNodes = useGraphNodes()
  const storeEdges = useGraphEdges()
  const progress = useGraphProgress()

  // N7: lastRunId/lastPhase/lastStage refs + 两个 REST useEffect 全部删除
  // REST 兜底迁到 useCurrentRunView 的 queryFn (见 useCurrentGraph)。
  // source discriminator 全部删除 — 调用方改 useCurrentGraph().source

  return useMemo(
    () => ({
      nodes: [...storeNodes],
      edges: [...storeEdges],
      progress,
      totalNodes: storeNodes.length,
      totalEdges: storeEdges.length,
    }),
    [storeNodes, storeEdges, progress],
  )
}
