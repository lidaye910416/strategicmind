/**
 * useRoundStream - 统一订阅"推演回合（simRounds）"数据。
 *
 * 数据源（按优先级）：
 *   1. store 内 simRounds（来自 SSE live_event 的 round_completed 事件）
 *   2. REST GET /api/pipeline/<runId>/network-frames（启动时一次性拉全量）
 *
 * 注意：不开 EventSource（统一由 store 内的 _openSSE 唯一管理）。
 */
import { useEffect, useMemo, useRef } from 'react'
import { useSimRounds, usePipelineStore } from '../pipeline'
import type { SimRound } from '../pipeline'
import http from '../../services/http'

export interface UseRoundStreamOptions {
  fallback?: SimRound[] | null
}

export interface UseRoundStreamResult {
  rounds: SimRound[]
  source: 'store' | 'fallback' | 'empty'
  totalRounds: number
  totalEdges: number
  /** 从 simRounds 派生：所有传播边扁平化 */
  propagationEdges: { source: string; target: string; channel: string; round: number }[]
  /** 从 simRounds 派生：所有活跃 agent 列表 */
  agents: { id: string; type: string; influence: number; round: number }[]
}

export function useRoundStream(runId: string | null | undefined, opts: UseRoundStreamOptions = {}): UseRoundStreamResult {
  const rounds = useSimRounds()
  const appendSimRound = usePipelineStore((s) => s.appendSimRound)
  const lastRunId = useRef<string | null>(null)

  useEffect(() => {
    if (!runId) return
    if (lastRunId.current === runId) return
    lastRunId.current = runId
    if (rounds.length > 0) return

    let cancelled = false
    ;(async () => {
      try {
        const r = await http.get(`/pipeline/${runId}/network-frames`)
        if (cancelled) return
        const data = r.data || {}
        const list: any[] = (data.frames || []) as any[]
        for (const f of list) {
          appendSimRound({
            round: f.round,
            total_rounds: f.total_rounds || list.length,
            actions_count: f.actions_count ?? 0,
            active_agents: (f.active_agents ?? []) as any,
            belief_shift_count: 0,
            propagation_events_count: (f.edges || f.propagation_edges || []).length,
            new_entities: f.new_entities ?? [],
            new_relations: f.new_relations ?? [],
            propagation_edges: f.edges || f.propagation_edges || [],
          })
        }
      } catch {
        // SSE 后续补
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const source: UseRoundStreamResult['source'] = useMemo(() => {
    if (rounds.length > 0) return 'store'
    if (opts.fallback) return 'fallback'
    return 'empty'
  }, [rounds.length, opts.fallback])

  return useMemo<UseRoundStreamResult>(() => {
    const activeRounds = source === 'store'
      ? rounds
      : (source === 'fallback' && opts.fallback) ? opts.fallback : []
    const propagationEdges = activeRounds.flatMap((f) => f.propagation_edges || [])
    const totalEdges = propagationEdges.length
    // 派生 agent 列表（去重，按最后出现轮次保留）
    const agentMap = new Map<string, { id: string; type: string; influence: number; round: number }>()
    for (const f of activeRounds) {
      const aids: any[] = Array.isArray(f.active_agents) ? f.active_agents : []
      for (const aid of aids) {
        const prev = agentMap.get(aid)
        agentMap.set(aid, {
          id: aid,
          type: prev?.type || 'ANALYST',
          influence: prev?.influence ?? 0.5,
          round: f.round,
        })
      }
    }
    return {
      rounds: activeRounds,
      source,
      totalRounds: activeRounds.length,
      totalEdges,
      propagationEdges,
      agents: Array.from(agentMap.values()),
    }
  }, [source, rounds, opts.fallback])
}
