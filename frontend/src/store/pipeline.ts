/**
 * Pipeline global state (Zustand) — 唯一 source of truth。
 *
 * 设计目标：
 *   - Dashboard / Workbench / LiveRunPanel 共享同一份 run 状态
 *   - URL 变化（/workbench/:runId）能自动 hydrate 进 store
 *   - SSE 事件全应用分发
 *
 * 来源：C3 P0 #2 + C1 C-01~08 融合
 *   - (a) 字段化 _sseRef + dispose action
 *   - (b) setTimeout 句柄存 ref 可取消
 *   - (c) 5 个 atomic selector hooks（避免整树 re-render）
 *   - (d) uploads: Map<id, UploadItem> + isStarting 首行设置
 *   - (e) lastEventAt 字段 + 5s 静默检测
 *
 * Implements: US-061, US-062
 */
import { create } from 'zustand'
import http from '../services/http'
import { formatErrorMessage } from '../lib/formatError'

export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface RunSnapshot {
  run_id: string
  status: PipelineStatus | string
  current_stage: string
  progress: number
  config?: Record<string, any>
  completed_stages?: string[]
  artifacts?: Record<string, any>
  error?: string | null
  started_at?: number
  updated_at?: number
  // 辅助字段（从 artifacts.SIMULATION_RUNNING 提取）
  current_round?: number
  total_rounds?: number
  active_agents?: number
}

export interface UploadItem {
  id: string
  docId: string
  filename: string
}

// ---- 事件流数据契约（P3-B：实时图谱 / 推演深度修复） ----

/** 实时涌现的实体（来自 entity_emerged 事件） */
export interface GraphNodeData {
  id: string
  label: string
  type: string
  influence?: number
  source?: 'seed' | 'llm' | 'action'
  round?: number
  emergedAt: number
}

/** 实时涌现的关系（来自 relationship_formed 事件） */
export interface GraphEdgeData {
  id: string
  source: string
  target: string
  type: string
  weight?: number
  source_origin?: 'seed' | 'llm' | 'action'
  round?: number
  formedAt: number
}

/** 推演回合（来自 round_completed 事件） */
export interface SimRound {
  round: number
  total_rounds: number
  actions_count: number
  active_agents: string[]
  belief_shift_count: number
  propagation_event_count: number
  new_entities_count: number
  new_relationships_count: number
  /** 当 round 内的传播边 */
  propagation_edges: { source: string; target: string; channel: string; round: number }[]
  completedAt: number
}

/** 图谱构建阶段进度（来自 graph_progress 事件） */
export interface GraphProgress {
  phase: 'idle' | 'started' | 'growing' | 'completed'
  nodes: number
  edges: number
}

// ---- 上限常量（防内存爆炸，FIFO 淘汰） ----
const GRAPH_NODES_LIMIT = 2000
const GRAPH_EDGES_LIMIT = 3000
const SIM_ROUNDS_LIMIT = 100

/** 把任意来源字段归一为 union 类型（容忍 REST/LLM 偶发字符串不一致） */
function _normalizeSource(v: unknown): 'seed' | 'llm' | 'action' | undefined {
  if (v === 'seed' || v === 'llm' || v === 'action') return v
  return undefined
}

interface PipelineState {
  // 核心 run 状态
  runId: string | null
  status: PipelineStatus
  currentStage: string
  progress: number
  error: string | null
  uploadedDocIds: string[]
  // 完整后端快照（artifacts / completed_stages 等）
  snapshot: RunSnapshot | null
  // UI 标志
  isStarting: boolean
  // 上传区（从 Dashboard 同步到 Workbench 不丢失）
  uploads: Map<string, UploadItem>
  // SSE 静默检测：上次收到事件的时间戳（ms）
  lastEventAt: number

  // ---- 事件流切片（P3-B：实时图谱 / 推演深度修复） ----
  /** 实时涌现的实体（来自 entity_emerged 事件 + graph-snapshot REST 补底） */
  graphNodes: Map<string, GraphNodeData>
  /** 实时涌现的关系（来自 relationship_formed 事件 + graph-snapshot REST 补底） */
  graphEdges: Map<string, GraphEdgeData>
  /** 图谱构建阶段进度（来自 graph_progress 事件） */
  graphProgress: GraphProgress
  /** 推演回合（来自 round_completed 事件） */
  simRounds: SimRound[]

  // ---- SSE 内部句柄（不暴露在公共 state，但放到 store 里便于 dispose 协同） ----
  _sseRef: EventSource | null
  _sseCloseTimer: number | null

  // ---- Atomic actions（细粒度，避免整树 re-render） ----
  startPipeline: (config: Record<string, unknown>) => Promise<string | null>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  setProgress: (stage: string, progress: number) => void
  setStatus: (status: PipelineStatus) => void
  setRunId: (runId: string | null) => void
  setSnapshot: (snap: RunSnapshot) => void
  hydrateFromRunId: (runId: string, signal?: AbortSignal) => Promise<boolean>  // 加载历史 run
  addUploadedDoc: (docId: string) => void
  addUpload: (item: UploadItem) => void
  removeUpload: (id: string) => void
  clearUploads: () => void
  dispose: () => void
  // 事件流切片 actions
  setGraphSnapshot: (nodes: GraphNodeData[], edges: GraphEdgeData[], progress?: Partial<GraphProgress>) => void
  appendGraphNodes: (nodes: GraphNodeData[]) => void
  appendGraphEdges: (edges: GraphEdgeData[]) => void
  setGraphProgress: (p: Partial<GraphProgress>) => void
  appendSimRound: (round: SimRound) => void
}

// ---- 内部 SSE 工具（仍在模块作用域，但只通过 store 字段访问） ----

function _openSSE(
  runId: string,
  get: () => PipelineState,
  set: (partial: Partial<PipelineState>) => void,
) {
  // 关闭旧的
  _closeSSE(get, set)
  const es = new EventSource(`/api/pipeline/${runId}/events`)
  set({ _sseRef: es, lastEventAt: Date.now() })
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      // ---- 完整快照（含 artifacts） ----
      if (data.run_id && data.artifacts !== undefined) {
        set({
          snapshot: data,
          runId: data.run_id,
          status: (data.status as PipelineStatus) || get().status,
          currentStage: data.current_stage || get().currentStage,
          progress: typeof data.progress === 'number' ? data.progress : get().progress,
          lastEventAt: Date.now(),
        })
      }
      // ---- 增量事件 ----
      if (data.current_stage) {
        set({ currentStage: data.current_stage })
      }
      if (typeof data.progress === 'number') {
        set({ progress: data.progress })
      }
      if (data.status) {
        set({ status: data.status as PipelineStatus, lastEventAt: Date.now() })
        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          // 终态保留 SSE 一小段时间再关，方便收尾事件
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
      // ---- live_event 增量（P3-B：实时图谱 / 推演深度修复） ----
      if (data.type === 'live_event' && data.event) {
        _applyLiveEvent(data.event, get, set)
      }
    } catch { /* ignore malformed events */ }
  }
  es.onerror = () => {
    if (['completed', 'failed', 'cancelled'].includes(get().status)) {
      _closeSSE(get, set)
    }
  }
}

function _closeSSE(get: () => PipelineState, set: (partial: Partial<PipelineState>) => void) {
  const cur = get()._sseRef
  if (cur) {
    try { cur.close() } catch {}
    set({ _sseRef: null })
  }
  const t = get()._sseCloseTimer
  if (t) {
    clearTimeout(t)
    set({ _sseCloseTimer: null })
  }
}

/**
 * 把 live_event 增量分派到对应的 store 切片。
 * - entity_emerged → graphNodes
 * - relationship_formed → graphEdges
 * - graph_progress → graphProgress
 * - round_completed → simRounds
 * 上限触发时 FIFO 淘汰，防止内存爆炸。
 */
function _applyLiveEvent(
  evt: any,
  get: () => PipelineState,
  set: (partial: Partial<PipelineState>) => void,
) {
  const t = evt?.type
  const d = evt?.data || {}
  const now = Date.now()

  if (t === 'entity_emerged') {
    const entity = d.entity
    if (!entity?.id) return
    const next = new Map(get().graphNodes)
    next.set(entity.id, {
      id: entity.id,
      label: entity.label || entity.name || entity.id,
      type: entity.type || entity.entity_type || 'DEFAULT',
      influence: typeof entity.influence === 'number' ? entity.influence : undefined,
      source: d.source,
      round: d.round,
      emergedAt: now,
    })
    if (next.size > GRAPH_NODES_LIMIT) {
      // FIFO 淘汰最旧的
      const firstKey = next.keys().next().value
      if (firstKey) next.delete(firstKey)
    }
    set({ graphNodes: next, lastEventAt: now })
    return
  }

  if (t === 'relationship_formed') {
    const rel = d.relationship
    if (!rel?.id || !rel?.source || !rel?.target) return
    const next = new Map(get().graphEdges)
    next.set(rel.id, {
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: rel.type || 'RELATED_TO',
      weight: typeof rel.weight === 'number' ? rel.weight : undefined,
      source_origin: d.source,
      round: d.round,
      formedAt: now,
    })
    if (next.size > GRAPH_EDGES_LIMIT) {
      const firstKey = next.keys().next().value
      if (firstKey) next.delete(firstKey)
    }
    set({ graphEdges: next, lastEventAt: now })
    return
  }

  if (t === 'graph_progress') {
    set({
      graphProgress: {
        phase: (d.phase as GraphProgress['phase']) || 'growing',
        nodes: typeof d.nodes === 'number' ? d.nodes : get().graphProgress.nodes,
        edges: typeof d.edges === 'number' ? d.edges : get().graphProgress.edges,
      },
      lastEventAt: now,
    })
    return
  }

  if (t === 'round_completed') {
    const edges = Array.isArray(d.propagation_edges) ? d.propagation_edges : []
    const round: SimRound = {
      round: d.round_num ?? d.round ?? 0,
      total_rounds: d.total_rounds ?? 0,
      actions_count: d.actions_count ?? 0,
      active_agents: Array.isArray(d.active_agents) ? d.active_agents : [],
      belief_shift_count: d.belief_shift_count ?? 0,
      propagation_event_count: d.propagation_event_count ?? edges.length,
      new_entities_count: d.new_entities_count ?? 0,
      new_relationships_count: d.new_relationships_count ?? 0,
      propagation_edges: edges.map((e: any) => ({
        source: e.source,
        target: e.target,
        channel: e.channel || 'unknown',
        round: d.round_num ?? d.round ?? 0,
      })),
      completedAt: now,
    }
    const prev = get().simRounds.filter((r) => r.round !== round.round)
    const next = [...prev, round].sort((a, b) => a.round - b.round)
    // FIFO 上限
    const trimmed = next.length > SIM_ROUNDS_LIMIT ? next.slice(next.length - SIM_ROUNDS_LIMIT) : next
    set({ simRounds: trimmed, lastEventAt: now })
    return
  }

  if (t === 'round_started') {
    set({
      graphProgress: { ...get().graphProgress, phase: 'growing' },
      lastEventAt: now,
    })
    return
  }
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  runId: null,
  status: 'idle',
  currentStage: 'IDLE',
  progress: 0,
  error: null,
  uploadedDocIds: [],
  snapshot: null,
  isStarting: false,
  uploads: new Map(),
  lastEventAt: 0,
  // 事件流切片初始值
  graphNodes: new Map(),
  graphEdges: new Map(),
  graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
  simRounds: [],
  _sseRef: null,
  _sseCloseTimer: null,

  startPipeline: async (config) => {
    // 首行立刻设置 isStarting（消费方立即看到按钮变 loading）
    set({ status: 'running', currentStage: 'SEED_PARSING', progress: 0, error: null, isStarting: true })
    try {
      const r = await http.post('/pipeline/start', { config })
      const runId: string = r.data.run_id
      set({ runId, isStarting: false })
      _openSSE(runId, get, set)
      return runId
    } catch (e: any) {
      // 来源：C3 P0 #10：启动失败用 formatError 翻译
      set({ status: 'failed', error: formatErrorMessage(e), isStarting: false })
      return null
    }
  },

  pause: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/pause`)
    set({ status: 'paused' })
  },

  resume: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/resume`)
    set({ status: 'running' })
  },

  cancel: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/cancel`)
    set({ status: 'cancelled' })
    _closeSSE(get, set)
  },

  reset: () => {
    _closeSSE(get, set)
    set({
      runId: null,
      status: 'idle',
      currentStage: 'IDLE',
      progress: 0,
      error: null,
      snapshot: null,
      isStarting: false,
      lastEventAt: 0,
      graphNodes: new Map(),
      graphEdges: new Map(),
      graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
      simRounds: [],
    })
  },

  setProgress: (stage, progress) => set({ currentStage: stage, progress }),
  setStatus: (status) => set({ status }),
  setRunId: (runId) => {
    set({ runId })
    if (runId) _openSSE(runId, get, set)
    else _closeSSE(get, set)
  },
  setSnapshot: (snap) => set({ snapshot: snap, runId: snap.run_id }),

  /**
   * Hydrate from a runId (e.g. from URL /workbench/:runId).
   * Fetches the snapshot from REST and opens SSE.
   * Returns true if the run exists and was loaded.
   */
  hydrateFromRunId: async (runId, signal) => {
    if (!runId) return false
    try {
      const r = await http.get(`/pipeline/${runId}`, { signal })
      const data = r.data
      if (!data || !data.run_id) return false
      set({
        runId: data.run_id,
        status: (data.status as PipelineStatus) || 'idle',
        currentStage: data.current_stage || 'IDLE',
        progress: typeof data.progress === 'number' ? data.progress : 0,
        snapshot: data,
        error: data.error || null,
      })
      // 终态就不开 SSE 了
      if (!['completed', 'failed', 'cancelled'].includes(data.status)) {
        _openSSE(data.run_id, get, set)
      }
      return true
    } catch {
      return false
    }
  },

  addUploadedDoc: (docId) =>
    set((s) => ({ uploadedDocIds: [...s.uploadedDocIds, docId] })),

  addUpload: (item) =>
    set((s) => {
      const next = new Map(s.uploads)
      next.set(item.id, item)
      return { uploads: next }
    }),

  removeUpload: (id) =>
    set((s) => {
      const next = new Map(s.uploads)
      next.delete(id)
      return { uploads: next }
    }),

  clearUploads: () => set({ uploads: new Map() }),

  // ---- 事件流切片 actions（P3-B） ----
  /**
   * 用 REST 一次性拉到的 graph-snapshot 初始化（或覆盖）图谱切片。
   * 只在 store 内 Map 为空 / 阶段变更时由组件调用。
   * 入参采用宽松类型（REST payload 字段名可能是 snake_case 旧版）。
   */
  setGraphSnapshot: (nodes, edges, progress) => {
    const nMap = new Map<string, GraphNodeData>()
    const now = Date.now()
    for (const raw of nodes as any[]) {
      if (!raw?.id) continue
      nMap.set(raw.id, {
        id: raw.id,
        label: raw.label || raw.name || raw.id,
        type: raw.type || raw.entity_type || 'DEFAULT',
        influence: typeof raw.influence === 'number' ? raw.influence : undefined,
        source: _normalizeSource(raw.source ?? raw.source_origin),
        round: raw.round,
        emergedAt: typeof raw.mergedAt === 'number' ? raw.mergedAt : now,
      })
    }
    const eMap = new Map<string, GraphEdgeData>()
    for (const raw of edges as any[]) {
      if (!raw?.id) continue
      eMap.set(raw.id, {
        id: raw.id,
        source: raw.source,
        target: raw.target,
        type: raw.type || 'RELATED_TO',
        weight: typeof raw.weight === 'number' ? raw.weight : undefined,
        source_origin: _normalizeSource(raw.source_origin ?? raw.source),
        round: raw.round,
        formedAt: typeof raw.formedAt === 'number' ? raw.formedAt : now,
      })
    }
    set((s) => ({
      graphNodes: nMap,
      graphEdges: eMap,
      graphProgress: progress
        ? { ...s.graphProgress, ...progress }
        : s.graphProgress,
    }))
  },

  appendGraphNodes: (nodes) => {
    if (!nodes?.length) return
    set((s) => {
      const next = new Map(s.graphNodes)
      const now = Date.now()
      for (const raw of nodes as any[]) {
        if (!raw?.id) continue
        next.set(raw.id, {
          id: raw.id,
          label: raw.label || raw.name || raw.id,
          type: raw.type || 'DEFAULT',
          influence: raw.influence,
          source: _normalizeSource(raw.source),
          round: raw.round,
          emergedAt: now,
        })
      }
      // FIFO
      while (next.size > GRAPH_NODES_LIMIT) {
        const k = next.keys().next().value
        if (!k) break
        next.delete(k)
      }
      return { graphNodes: next }
    })
  },

  appendGraphEdges: (edges) => {
    if (!edges?.length) return
    set((s) => {
      const next = new Map(s.graphEdges)
      const now = Date.now()
      for (const raw of edges as any[]) {
        if (!raw?.id) continue
        next.set(raw.id, {
          id: raw.id,
          source: raw.source,
          target: raw.target,
          type: raw.type || 'RELATED_TO',
          weight: raw.weight,
          source_origin: _normalizeSource(raw.source_origin),
          round: raw.round,
          formedAt: now,
        })
      }
      while (next.size > GRAPH_EDGES_LIMIT) {
        const k = next.keys().next().value
        if (!k) break
        next.delete(k)
      }
      return { graphEdges: next }
    })
  },

  setGraphProgress: (p) =>
    set((s) => ({ graphProgress: { ...s.graphProgress, ...p } })),

  appendSimRound: (round) =>
    set((s) => {
      const prev = s.simRounds.filter((r) => r.round !== round.round)
      const next = [...prev, round].sort((a, b) => a.round - b.round)
      const trimmed = next.length > SIM_ROUNDS_LIMIT ? next.slice(next.length - SIM_ROUNDS_LIMIT) : next
      return { simRounds: trimmed }
    }),

  dispose: () => {
    _closeSSE(get, set)
    set({ _sseRef: null, _sseCloseTimer: null })
  },
}))

// ============================================================
// Atomic selector hooks（P0-2 关键产出）
// 取代组件内 `usePipelineStore()` 整树订阅，
// 让组件只在订阅的字段变化时 re-render。
// ============================================================
export const useRunId = () => usePipelineStore((s) => s.runId)
export const useStatus = () => usePipelineStore((s) => s.status)
export const useStage = () => usePipelineStore((s) => s.currentStage)
export const useProgress = () => usePipelineStore((s) => s.progress)
export const useSnapshot = () => usePipelineStore((s) => s.snapshot)
export const useError = () => usePipelineStore((s) => s.error)
export const useIsStarting = () => usePipelineStore((s) => s.isStarting)
export const useUploads = () => usePipelineStore((s) => s.uploads)
export const useLastEventAt = () => usePipelineStore((s) => s.lastEventAt)
// ---- 事件流切片 selector（P3-B：实时图谱 / 推演深度） ----
export const useGraphNodes = () => usePipelineStore((s) => s.graphNodes)
export const useGraphEdges = () => usePipelineStore((s) => s.graphEdges)
export const useGraphProgress = () => usePipelineStore((s) => s.graphProgress)
export const useSimRounds = () => usePipelineStore((s) => s.simRounds)
