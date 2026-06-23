/**
 * useCurrentRunView — Canonical "current run" selector (Bug #3 修复)。
 *
 * 4 个页面 (Dashboard / Workbench / Simulation / RecentRuns) 全部订阅同一 hook,
 * 拿到一致的数据 — 修复跨页面内容不一致 (节点数/边数/agents 漂移)。
 *
 * 设计:
 *   - 拆为 5 个 per-slice sub-hook (避免 SSE frame 触发整页 re-render)
 *   - 数据源优先级: live store → REST snapshot fallback (内部简单 cache, staleTime 30s)
 *   - source discriminator: 'live' | 'snapshot' | 'empty'
 *   - queryFn 用 selectLatestCompleted 共享排序 (N6)
 *   - REST 兜底迁到这里 (N7), useGraphStream 退化为纯 SSE 订阅
 *
 * 依赖: usePipelineStore (Zustand) — 不依赖外部数据客户端, 用 module-level cache
 * 模拟 30s staleTime (4 个调用方共用同一份 query)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  usePipelineStore,
  useGraphNodes,
  useGraphEdges,
  useGraphProgress,
  useRunId,
  type GraphNodeData,
  type GraphEdgeData,
  type GraphProgress,
  type RunSnapshot,
} from '../pipeline'
import type { Run } from '../../types/run'
import { selectLatestCompleted } from '../../lib/runFilters'
import http from '../../services/http'

export type ViewSource = 'live' | 'snapshot' | 'empty'

export interface GraphSlice {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  source: ViewSource
  progress: GraphProgress | null
}

export interface AgentSummary {
  id: string
  name?: string
  type?: string
  influence?: number
  last_action_round?: number | null
  position?: string
}

export interface LogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  message: string
  source?: string
}

export interface TimelineEntry {
  round: number
  ts?: number
  summary: string
  actions_count?: number
  belief_updates_count?: number
  propagation_events_count?: number
  active_agents?: string[] | number
}

// ============================================================================
// Per-slice sub-hooks — 页面只订阅自己渲染的 slice
// ============================================================================

export function useCurrentRunId(): string | null {
  return useRunId()
}

export function useCurrentRunMeta(): RunSnapshot | null {
  return usePipelineStore((s) => s.snapshot)
}

// ---------------------------------------------------------------------------
// Module-level cache for REST snapshot fallback (mimics TanStack Query cache
// 4 个调用方共用同一份 query + 30s staleTime; 避免引入 @tanstack/react-query 依赖)
// ---------------------------------------------------------------------------
interface FallbackCache {
  ts: number
  data: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; runId: string } | null
}
let _fallbackCache: FallbackCache | null = null
let _fallbackInflight: Promise<FallbackCache | null> | null = null
const FALLBACK_STALE_MS = 30_000

async function _fetchFallbackSnapshot(): Promise<FallbackCache | null> {
  if (_fallbackCache && _fallbackCache.data && Date.now() - _fallbackCache.ts < FALLBACK_STALE_MS) {
    return _fallbackCache
  }
  if (_fallbackInflight) return _fallbackInflight

  _fallbackInflight = (async () => {
    try {
      const r = await http.get('/pipeline/runs')
      const runs: Run[] = (r.data?.runs || []) as Run[]
      const latest = selectLatestCompleted(runs)
      if (!latest) {
        // 缓存"空"但极短 (避免测试污染)
        _fallbackCache = { ts: 0, data: null }
        return _fallbackCache
      }
      const snap = await http.get(`/pipeline/${latest.run_id}/graph-snapshot`)
      const data = snap.data || {}
      const nodes: GraphNodeData[] = (data.nodes || []) as GraphNodeData[]
      const edges: GraphEdgeData[] = (data.edges || []) as GraphEdgeData[]
      _fallbackCache = {
        ts: Date.now(),
        data: { nodes, edges, runId: latest.run_id },
      }
      return _fallbackCache
    } catch {
      _fallbackCache = { ts: 0, data: null }
      return _fallbackCache
    } finally {
      _fallbackInflight = null
    }
  })()
  return _fallbackInflight
}

/** Test-only helper: clear the module-level fallback cache. */
export function _resetFallbackCacheForTests() {
  _fallbackCache = null
  _fallbackInflight = null
}

/**
 * Graph slice: live store → REST snapshot fallback (queryFn 用 selectLatestCompleted)
 *
 * 关键修复 (N7): useGraphStream 的 REST 兜底迁移到这里的 queryFn;
 *                queryFn 成功后直接 setGraphSnapshot 把数据灌进 store.
 */
export function useCurrentGraph(): GraphSlice {
  const runId = useRunId()
  const liveNodes = useGraphNodes()
  const liveEdges = useGraphEdges()
  const liveProgress = useGraphProgress()
  const setGraphSnapshot = usePipelineStore((s) => s.setGraphSnapshot)

  // ---- Step 1: live path (store 有数据) ----
  const liveSlice: GraphSlice | null = useMemo(() => {
    if (!runId) return null
    if (liveNodes.length === 0 && liveEdges.length === 0) return null
    return {
      nodes: liveNodes,
      edges: liveEdges,
      source: 'live',
      progress: liveProgress,
    }
  }, [runId, liveNodes, liveEdges, liveProgress])

  if (liveSlice) return liveSlice

  // ---- Step 2: REST fallback — 唯一允许拉 snapshot 的入口 (N7) ----
  // 只在 runId 为 null 时启用
  const [fallback, setFallback] = useState<{
    nodes: GraphNodeData[]
    edges: GraphEdgeData[]
  } | null>(null)
  const wroteRef = useRef<number>(0)

  useEffect(() => {
    if (runId !== null) return
    let cancelled = false
    ;(async () => {
      const cache = await _fetchFallbackSnapshot()
      if (cancelled || !cache || !cache.data) return
      // 把 snapshot 写回 store (N7 关键: useGraphStream 已不拉, 这里是唯一入口)
      if (wroteRef.current !== cache.ts) {
        wroteRef.current = cache.ts
        setGraphSnapshot(cache.data.nodes, cache.data.edges, {
          phase: 'completed',
          nodes: cache.data.nodes.length,
          edges: cache.data.edges.length,
        })
      }
      setFallback({ nodes: cache.data.nodes, edges: cache.data.edges })
    })()
    return () => {
      cancelled = true
    }
  }, [runId, setGraphSnapshot])

  if (runId === null && fallback) {
    return {
      nodes: fallback.nodes,
      edges: fallback.edges,
      source: 'snapshot',
      progress: liveProgress,
    }
  }

  // ---- Step 3: empty ----
  return { nodes: [], edges: [], source: 'empty', progress: null }
}

/**
 * Agents slice — 派生自 graph nodes + 最近 round 的 active_agents。
 * 替代 3 处 ad-hoc agent list (Simulation/Workbench/Dashboard)。
 */
export function useCurrentAgents(): AgentSummary[] {
  const { nodes } = useCurrentGraph()
  const simRounds = usePipelineStore((s) => s.simRounds)
  const lastRound = simRounds[simRounds.length - 1]

  return useMemo(() => {
    return nodes
      .filter(
        (n) =>
          n.type === 'PERSON' ||
          n.entity_type === 'PERSON' ||
          ((n.properties as any)?.role === 'agent'),
      )
      .map<AgentSummary>((n) => ({
        id: String(n.id),
        name: n.label ?? n.name ?? String(n.id),
        type: n.type ?? n.entity_type,
        influence: n.influence ?? (n.properties as any)?.influence,
        last_action_round: n.round ?? null,
        position: (n.properties as any)?.position,
      }))
  }, [nodes, lastRound?.round])
}

/** Logs slice — 从 store 的 SSE-fed 日志队列派生 (store 未原生 logs 时返回空数组) */
export function useCurrentLogs(): LogEntry[] {
  return usePipelineStore((s) => {
    const evs = (s as any).logs ?? []
    return evs as LogEntry[]
  })
}

/** Timeline slice — simRounds 派生 (round_completed 事件已落 store) */
export function useCurrentTimeline(): TimelineEntry[] {
  const rounds = usePipelineStore((s) => s.simRounds)
  return useMemo(
    () =>
      rounds.map((r) => ({
        round: r.round,
        ts: r.ts,
        summary: `Round ${r.round} · actions=${r.actions_count ?? 0} · beliefs=${r.belief_updates_count ?? 0}`,
        actions_count: r.actions_count,
        belief_updates_count: r.belief_updates_count,
        propagation_events_count: r.propagation_events_count,
        active_agents: r.active_agents,
      })),
    [rounds],
  )
}

// ============================================================================
// 组合 hook — 内部用 sub-hooks 拼, 调用方按需订阅单 slice 优先
// ============================================================================
export function useCurrentRunView() {
  const runId = useCurrentRunId()
  const meta = useCurrentRunMeta()
  const graph = useCurrentGraph()
  const agents = useCurrentAgents()
  const logs = useCurrentLogs()
  const timeline = useCurrentTimeline()
  return { runId, meta, ...graph, agents, logs, timeline }
}
