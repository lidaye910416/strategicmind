/**
 * useGraphStream - 统一订阅"实时知识图谱"数据。
 *
 * 数据源（按优先级）：
 *   1. store 内 graphNodes / graphEdges（来自 SSE live_event 增量）
 *   2. REST GET /api/pipeline/<runId>/graph-snapshot（启动时一次性拉全量）
 *
 * 设计要点：
 *   - 不开 EventSource（统一由 store 的 _openSSE 唯一管理）
 *   - 当 runId 变化 / store 已有数据时跳过 REST
 *   - runId 为空时返回 fallback（演示数据）
 */
import { useEffect, useMemo, useRef } from 'react'
import { useGraphNodes, useGraphEdges, useGraphProgress, usePipelineStore } from '../pipeline'
import type { GraphNodeData, GraphEdgeData } from '../pipeline'
import http from '../../services/http'

export interface UseGraphStreamOptions {
  /** runId 为空时使用的演示数据（Dashboard / 未启动场景） */
  fallback?: { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null
}

export interface UseGraphStreamResult {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  progress: ReturnType<typeof useGraphProgress>
  source: 'store' | 'fallback' | 'empty'
  totalNodes: number
  totalEdges: number
}

export function useGraphStream(runId: string | null | undefined, opts: UseGraphStreamOptions = {}): UseGraphStreamResult {
  const storeNodes = useGraphNodes()
  const storeEdges = useGraphEdges()
  const progress = useGraphProgress()
  const setGraphSnapshot = usePipelineStore((s) => s.setGraphSnapshot)

  const lastRunId = useRef<string | null>(null)
  const lastPhase = useRef<string | null>(null)
  const lastStage = useRef<string | null>(null)

  // 启动时拉一次全量（仅当 store 为空 + runId 变化时）
  useEffect(() => {
    if (!runId) return
    if (lastRunId.current === runId) return
    lastRunId.current = runId
    lastPhase.current = null
    lastStage.current = null

    // 已有数据（SSE 已经在推）就跳过 REST 补底
    if (storeNodes.length > 0) return

    let cancelled = false
    ;(async () => {
      try {
        const r = await http.get(`/pipeline/${runId}/graph-snapshot`)
        if (cancelled) return
        const data = r.data || {}
        setGraphSnapshot(
          (data.nodes || []) as GraphNodeData[],
          (data.edges || []) as GraphEdgeData[],
          { phase: data.current_stage || 'completed', nodes: data.nodes?.length ?? 0, edges: data.edges?.length ?? 0 },
        )
      } catch {
        // 静默：SSE 后续会陆续补上
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // 关键修复：当 stage 推进（e.g. SEED_PARSING → GRAPH_BUILDING → ENTITY_EXTRACTION）
  // 或 graph_progress phase 变化时，重新拉全量 snapshot 补底。
  // 因为 SSE live_event 链路不稳（多个 stage 的 emit 路径不一致），
  // 用 stage 推进事件做兜底，确保 store 总是反映后端最新数据。
  useEffect(() => {
    if (!runId) return
    if (lastRunId.current !== runId) return  // 第一次会跑上面那个 effect
    if (progress.phase === lastPhase.current) return
    lastPhase.current = progress.phase
    // 当 phase 进入 graph_building/completed 时拉一次
    if (!['graph_building', 'completed', 'starting'].includes(progress.phase)) return

    let cancelled = false
    ;(async () => {
      try {
        const r = await http.get(`/pipeline/${runId}/graph-snapshot`)
        if (cancelled) return
        const data = r.data || {}
        setGraphSnapshot(
          (data.nodes || []) as GraphNodeData[],
          (data.edges || []) as GraphEdgeData[],
          { phase: data.current_stage || progress.phase, nodes: data.nodes?.length ?? 0, edges: data.edges?.length ?? 0 },
        )
      } catch { /* 静默 */ }
    })()
    return () => { cancelled = true }
  }, [runId, progress.phase])

  const source: UseGraphStreamResult['source'] = useMemo(() => {
    if (storeNodes.length > 0 || storeEdges.length > 0) return 'store'
    if (opts.fallback) return 'fallback'
    return 'empty'
  }, [storeNodes.length, storeEdges.length, opts.fallback])

  const result: UseGraphStreamResult = useMemo(() => {
    if (source === 'store') {
      return {
        nodes: [...storeNodes],
        edges: [...storeEdges],
        progress,
        source,
        totalNodes: storeNodes.length,
        totalEdges: storeEdges.length,
      }
    }
    if (source === 'fallback' && opts.fallback) {
      return {
        nodes: opts.fallback.nodes,
        edges: opts.fallback.edges,
        progress,
        source,
        totalNodes: opts.fallback.nodes.length,
        totalEdges: opts.fallback.edges.length,
      }
    }
    return { nodes: [], edges: [], progress, source: 'empty', totalNodes: 0, totalEdges: 0 }
  }, [source, storeNodes, storeEdges, progress, opts.fallback])

  return result
}
