/**
 * uiSlice — run identity + status + SSE plumbing + hydrate.
 *
 * One of the 4 typed slices composing the pipeline store (G8).
 * Owns: runId, status, currentStage, progress, error, snapshot, reportRisks,
 *       plus setRunId, setStatus, setProgress, setSnapshot,
 *       hydrateFromRunId, _openSSE, _closeSSE, dispose.
 *
 * _openSSE / _closeSSE live here (rather than free functions in pipeline.ts)
 * because they touch multiple slices' state (graph progress, market events,
 * belief shifts, etc.) via composite store. The `get()` they receive is the
 * full composite store, so all slice setters are reachable from SSE handlers.
 */
import type {
  PipelineStatus,
  RunSnapshot,
  RiskItem,
  GraphNodeData,
  GraphEdgeData,
  GraphProgress,
  SimRound,
} from '../pipeline'

/**
 * worldState — round_completed event 写入的"世界状态快照"。
 *
 * 来源: LoopEngine emit 的 SSE round_completed 事件 (Task 3 改了 event payload,
 *       加 simulated_hours_elapsed / simulated_label / actions_this_round /
 *       nodes_added / edges_added 5 字段).
 * 用途: useRoundStream selector 派生 RoundStreamSnapshot (Task 5).
 * 兼容: 旧 run 快照缺字段时 selector 返回 0 / '' 默认值 (不破 UI).
 */
export interface WorldStateSnapshot {
  round_num?: number
  total_rounds?: number
  simulated_hours_elapsed?: number
  simulated_label?: string
  actions_this_round?: number
  nodes_added?: number
  edges_added?: number
  [k: string]: any
}

export interface UiSliceState {
  // 字段
  runId: string | null
  status: PipelineStatus
  currentStage: string
  progress: number
  error: string | null
  snapshot: RunSnapshot | null
  reportRisks: RiskItem[]
  _sseRef: EventSource | null
  _sseCloseTimer: number | null
  /** G10: 当前 run 的世界状态 (round_completed 事件写入, useRoundStream 派生用) */
  worldState: WorldStateSnapshot | null

  // actions
  setRunId: (runId: string | null) => void
  setStatus: (status: PipelineStatus) => void
  setProgress: (stage: string, progress: number) => void
  setSnapshot: (snap: RunSnapshot) => void
  hydrateFromRunId: (runId: string, signal?: AbortSignal, active?: boolean) => Promise<boolean>
  dispose: () => void
  /** G10: 更新 worldState (SSE round_completed handler 调用) */
  setWorldState: (ws: WorldStateSnapshot | null) => void

  // SSE helpers (composite store only — not exported as part of public API)
  _openSSE: (runId: string, get: () => any, set: (p: any) => void) => void
  _closeSSE: (get: () => any, set: (p: any) => void) => void
}

export type UiSliceCreator = (
  set: (partial: any) => void,
  get: () => any,
) => UiSliceState

/**
 * Internal SSE handler.
 *
 * Lives on the composite store (not the slice) because it needs to write to
 * multiple slices (graph, sim, ui) in one stream. We install the helper onto
 * the store at composite-time so handlers can call `get().<sliceAction>(...)`.
 */
export function makeSseHandlers() {
  function _openSSE(runId: string, get: () => any, set: (p: any) => void) {
    // 关闭旧的
    _closeSSE(get, set)
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    set({ _sseRef: es, lastEventAt: Date.now() })
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.run_id && data.artifacts !== undefined) {
          const reportArt = data.artifacts?.REPORT_GENERATING
          const risks: RiskItem[] = Array.isArray(reportArt?.risks) ? reportArt.risks : []
          set({
            snapshot: data,
            runId: data.run_id,
            status: (data.status as PipelineStatus) || get().status,
            currentStage: data.current_stage || get().currentStage,
            progress: typeof data.progress === 'number' ? data.progress : get().progress,
            lastEventAt: Date.now(),
            reportRisks: risks,
          })
        }
        if (data.current_stage) {
          set({ currentStage: data.current_stage })
        }
        if (typeof data.progress === 'number') {
          set({ progress: data.progress })
        }
        if (data.status) {
          set({ status: data.status as PipelineStatus, lastEventAt: Date.now() })
          if (['completed', 'failed', 'cancelled'].includes(data.status)) {
            const existing = get()._sseCloseTimer
            if (existing) {
              clearTimeout(existing)
            }
            const t = window.setTimeout(() => {
              _closeSSE(get, set)
              set({ _sseCloseTimer: null })
            }, 5000)
            set({ _sseCloseTimer: t })
          }
        }

        if (data.type === 'live_event' && data.event) {
          const evt = data.event
          const evtType = evt.type
          const evtData = evt.data || {}
          set({ lastEventAt: Date.now() })
          if (evtType === 'graph_progress') {
            get().setGraphProgress({
              phase: evtData.phase || 'graph_building',
              nodes: evtData.nodes ?? get().graphProgress.nodes,
              edges: evtData.edges ?? get().graphProgress.edges,
              delta_nodes: evtData.delta_nodes,
              delta_edges: evtData.delta_edges,
              new_entities: evtData.new_entities,
              new_relations: evtData.new_relations,
              current_doc: evtData.current_doc,
              error: evtData.error,
            } as GraphProgress)
            if (Array.isArray(evtData.new_entities)) {
              for (const n of evtData.new_entities) {
                // Task 8: 记录 emerged_round = 当前 worldState.round_num
                const wsRound = get().worldState?.round_num
                const stamped: GraphNodeData = wsRound != null
                  ? ({ ...(n as any), emerged_round: wsRound } as GraphNodeData)
                  : (n as GraphNodeData)
                get().appendGraphNode(stamped)
              }
            }
            if (Array.isArray(evtData.new_relations)) {
              for (const e of evtData.new_relations) get().appendGraphEdge(e as GraphEdgeData)
            }
          } else if (evtType === 'entity_emerged' && evtData.entity) {
            // Task 8: 记录 emerged_round = 当前 worldState.round_num
            const wsRound = get().worldState?.round_num
            const stamped: GraphNodeData = wsRound != null
              ? ({ ...(evtData.entity as any), emerged_round: wsRound } as GraphNodeData)
              : (evtData.entity as GraphNodeData)
            get().appendGraphNode(stamped)
          } else if (evtType === 'relationship_formed' && evtData.relation) {
            get().appendGraphEdge(evtData.relation as GraphEdgeData)
          } else if (evtType === 'round_completed' || evtType === 'round_progress') {
            get().appendSimRound({
              round: evtData.round ?? 0,
              total_rounds: evtData.total_rounds,
              progress: evtData.progress,
              actions_count: evtData.actions?.length ?? evtData.actions_count,
              belief_updates_count: evtData.belief_updates?.length ?? evtData.belief_updates_count,
              belief_shift_count: evtData.belief_shift_count ?? 0,
              propagation_events_count: evtData.propagation_events?.length ?? evtData.propagation_events_count,
              active_agents: evtData.active_agents,
              actions: evtData.actions,
              belief_updates: evtData.belief_updates,
              propagation_events: evtData.propagation_events,
              new_entities: evtData.new_entities,
              new_relations: evtData.new_relations,
              ts: Date.now(),
            } as SimRound)
            // G10: 写 worldState (Task 5 useRoundStream 派生用)
            try {
              get().setWorldState(evtData as WorldStateSnapshot)
            } catch { /* ignore — old backend 缺字段时兜底 */ }
          } else if (evtType === 'market_event') {
            get().appendMarketEvent({
              type: evtData.type || 'UNKNOWN',
              industry: evtData.industry,
              gdp_growth: typeof evtData.gdp_growth === 'number' ? evtData.gdp_growth : undefined,
              cycle_label: evtData.cycle_label,
              description: evtData.description,
              ts: evtData.ts ?? Date.now(),
            } as any)
            try {
              get().setLatestMarketEvent({
                type: evtData.type || 'UNKNOWN',
                industry: evtData.industry,
                gdp_growth: typeof evtData.gdp_growth === 'number' ? evtData.gdp_growth : undefined,
                cycle_label: evtData.cycle_label,
                description: evtData.description,
                ts: evtData.ts ?? Date.now(),
                ...(evtData as any),
              } as any)
            } catch { /* ignore */ }
          } else if (evtType === 'shock_injected') {
            get().appendShock({
              factor_name: evtData.factor_name || '未知因素',
              severity: typeof evtData.severity === 'number' ? evtData.severity : 0.5,
              description: evtData.description,
              ts: evtData.ts ?? Date.now(),
            } as any)
            try {
              get().setActiveShock({
                factor_name: evtData.factor_name || '未知因素',
                severity: typeof evtData.severity === 'number' ? evtData.severity : 0.5,
                description: evtData.description,
                ts: evtData.ts ?? Date.now(),
                ...(evtData as any),
              } as any)
            } catch { /* ignore */ }
          } else if (evtType === 'year_advanced') {
            get().setYearAdvanced({
              year: evtData.year ?? 1,
              rounds_added: evtData.rounds_added ?? 0,
              entities_count: evtData.entities_count,
              ts: evtData.ts ?? Date.now(),
            } as any)
            if (evtData.status === 'completed' || evtData.status === 'failed') {
              set({ status: evtData.status as PipelineStatus })
            }
          } else if (evtType === 'belief_shift') {
            try {
              get().appendBeliefShift({
                round: evtData.round ?? 0,
                agent_id: String(evtData.agent_id ?? 'unknown'),
                topic: evtData.topic,
                old_value: evtData.old_value,
                new_value: evtData.new_value,
                delta: typeof evtData.delta === 'number' ? evtData.delta : 0,
                magnitude: evtData.magnitude,
                ts: evtData.ts ?? Date.now(),
              } as any)
            } catch { /* ignore */ }
          } else if (evtType === 'round_started') {
            try {
              get().setRoundStartedBanner({
                round: evtData.round ?? 0,
                total_rounds: evtData.total_rounds,
                ts: evtData.ts ?? Date.now(),
              })
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore malformed events */ }
    }
    es.onerror = () => {
      if (['completed', 'failed', 'cancelled'].includes(get().status)) {
        _closeSSE(get, set)
      }
    }
  }

  function _closeSSE(get: () => any, set: (p: any) => void) {
    const cur = get()._sseRef
    if (cur) {
      try { cur.close() } catch { /* ignore */ }
      set({ _sseRef: null })
    }
    const t = get()._sseCloseTimer
    if (t) {
      clearTimeout(t)
      set({ _sseCloseTimer: null })
    }
  }

  return { _openSSE, _closeSSE }
}

export const uiSlice: UiSliceCreator = (set, get) => {
  const { _openSSE, _closeSSE } = makeSseHandlers()

  return {
    runId: null,
    status: 'idle',
    currentStage: 'IDLE',
    progress: 0,
    error: null,
    snapshot: null,
    reportRisks: [],
    _sseRef: null,
    _sseCloseTimer: null,
    worldState: null,

    setRunId: (runId) => {
      set({ runId })
      if (runId) _openSSE(runId, get, set)
      else _closeSSE(get, set)
    },
    setStatus: (status) => set({ status }),
    setProgress: (stage, progress) => set({ currentStage: stage, progress }),
    setSnapshot: (snap) => set({ snapshot: snap, runId: snap.run_id }),
    setWorldState: (ws) => set({ worldState: ws }),

    hydrateFromRunId: async (runId, signal, active = true) => {
      if (!runId) return false
      if (!active) return false

      const sleep = (ms: number) => new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms)
        if (signal) {
          const onAbort = () => { clearTimeout(t); resolve() }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }
      })
      const isAborted = () => !!signal?.aborted || !active

      const RETRY_DELAYS_MS = [1000, 2000, 4000]
      let snap: any = null
      let lastErr: any = null
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (isAborted()) return false
        try {
          const r = await import('../../services/http').then((m) =>
            m.default.get(`/pipeline/${runId}`, { signal }),
          )
          if (r.data && r.data.run_id) {
            snap = r.data
            break
          }
          lastErr = new Error('empty payload')
        } catch (e) {
          lastErr = e
        }
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt])
        }
      }
      if (!snap) {
        // eslint-disable-next-line no-console
        console.warn('[hydrateFromRunId] 3 次 retry 后仍失败', lastErr)
        return false
      }
      if (!active) return false

      set({
        runId: snap.run_id,
        status: (snap.status as PipelineStatus) || 'idle',
        currentStage: snap.current_stage || 'IDLE',
        progress: typeof snap.progress === 'number' ? snap.progress : 0,
        snapshot: snap,
        error: snap.error || null,
      })

      // 并行拉 graph-snapshot + network-frames 把 store 填满
      const http = (await import('../../services/http')).default
      const fillPromises: Promise<void>[] = []
      fillPromises.push((async () => {
        if (isAborted()) return
        try {
          const r = await http.get(`/pipeline/${runId}/graph-snapshot`, { signal })
          const data = r.data || {}
          const nodes = Array.isArray(data.nodes) ? data.nodes as GraphNodeData[] : []
          const edges = Array.isArray(data.edges) ? data.edges as GraphEdgeData[] : []
          if (nodes.length || edges.length) {
            if (!active) return
            get().setGraphSnapshot(nodes, edges, {
              phase: 'completed',
              nodes: nodes.length,
              edges: edges.length,
            })
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[hydrateFromRunId] graph-snapshot 拉取失败（降级）', e)
        }
      })())
      fillPromises.push((async () => {
        if (isAborted()) return
        try {
          const r = await http.get(`/pipeline/${runId}/network-frames`, { signal })
          const data = r.data || {}
          const frames = Array.isArray(data.frames) ? data.frames as any[] : []
          if (frames.length) {
            if (!active) return
            for (const f of frames) {
              get().appendSimRound({
                round: f.round_num,
                total_rounds: data.total_rounds,
                actions_count: f.actions_count ?? (Array.isArray(f.actions) ? f.actions.length : 0),
                belief_updates_count: Array.isArray(f.belief_updates) ? f.belief_updates.length : 0,
                propagation_events_count: Array.isArray(f.propagation_events) ? f.propagation_events.length : 0,
                active_agents: f.active_agents,
                actions: f.actions,
                belief_updates: f.belief_updates,
                propagation_events: f.propagation_events,
                new_entities: undefined,
                new_relations: undefined,
                ts: f.end_time ? f.end_time * 1000 : Date.now(),
              } as SimRound)
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[hydrateFromRunId] network-frames 拉取失败（降级）', e)
        }
      })())
      await Promise.all(fillPromises)

      if (isAborted()) return false
      if (!['completed', 'failed', 'cancelled'].includes(snap.status)) {
        _openSSE(snap.run_id, get, set)
      }
      return true
    },

    dispose: () => {
      _closeSSE(get, set)
      set({ _sseRef: null, _sseCloseTimer: null })
    },

    _openSSE,
    _closeSSE,
  }
}