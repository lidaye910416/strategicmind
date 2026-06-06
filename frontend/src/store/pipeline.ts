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
// Re-export usePipelineEvent (定义在 lib/hooks) 供业务组件统一从 store 导入
export { usePipelineEvent, type PipelineEvent } from '../lib/hooks/usePipelineEvent'

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

// ============================================================================
// 实时图谱 / 推演回合数据类型（FE2/FE3 消费方）
// ============================================================================

/** 图谱节点 (实体) */
export interface GraphNodeData {
  id: string
  label?: string
  name?: string
  type?: string
  entity_type?: string
  /** 影响力权重 (0-1)，Agent 推演节点用；普通实体可不填默认 0.5 */
  influence?: number
  /** 来源 (seed / emergence / rest_snapshot) */
  source?: string
  /** 涌现轮次（仅 emergence 来源的节点用） */
  round?: number
  properties?: Record<string, any>
  // 布局位置（d3-force 自实现力布局 / 自实现 rAF 布局 维护）
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

/** 图谱边 (关系) */
export interface GraphEdgeData {
  /** 缺省时由 `${source}->${target}` 生成 */
  id?: string
  source: string
  target: string
  type?: string
  relation?: string
  weight?: number
  /** 涌现轮次 */
  round?: number
  properties?: Record<string, any>
}

/** 图谱构建阶段进度 */
export interface GraphProgress {
  phase: 'idle' | 'starting' | 'graph_building' | 'completed' | 'failed' | string
  nodes: number
  edges: number
  delta_nodes?: number
  delta_edges?: number
  new_entities?: GraphNodeData[]
  new_relations?: GraphEdgeData[]
  current_doc?: string
  error?: string
}

/** 推演单轮（SimulationLoop 每轮 emit 的快照） */
export interface SimRound {
  round: number
  total_rounds?: number
  progress?: number
  actions_count?: number
  belief_updates_count?: number
  belief_shift_count?: number
  propagation_events_count?: number
  active_agents?: string[] | number  // 兼容 string[] (ids) 和 number (count)
  ts?: number
  // 详情（可选）
  actions?: any[]
  belief_updates?: any[]
  propagation_events?: any[]
  /** 兼容旧字段名（FE2 useRoundStream 派生 propagation_edges 用） */
  propagation_edges?: any[]
  // 涌现（可选）
  new_entities?: GraphNodeData[]
  new_relations?: GraphEdgeData[]
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
  // P3-A: 最近一次启动推演时的 config（含 user_params），Workbench 用以读取真实配置
  lastRunConfig: Record<string, unknown> | null

  // ---- 实时图谱 / 推演回合数据（FE2/FE3 SSE 消费方） ----
  /** 当前 run 的知识图谱节点数组。SSE entity_emerged 增量追加；REST /graph-snapshot 整批 seed */
  graphNodes: GraphNodeData[]
  /** 当前 run 的知识图谱边数组 */
  graphEdges: GraphEdgeData[]
  /** GRAPH_BUILDING 阶段进度（含 phase/nodes/edges/new_entities/new_relations） */
  graphProgress: GraphProgress
  /** 推演回合数组（按 round 升序）。SSE round_completed 追加；REST /network-frames 整批 seed */
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

  // ---- 图谱 / 推演回合 actions（FE2/FE3） ----
  /** 兼容旧 API：FE2 RealtimeKnowledgeGraph 用 seedGraph(rawNodes, rawEdges) */
  seedGraph: (nodes: GraphNodeData[], edges: GraphEdgeData[]) => void
  /** 整批 seed 当前 run 的图谱（REST 拉全量时用） */
  setGraphSnapshot: (nodes: GraphNodeData[], edges: GraphEdgeData[], progress?: GraphProgress) => void
  /** 追加单条实体（entity_emerged 事件） */
  appendGraphNode: (node: GraphNodeData) => void
  /** 追加单条关系（relationship_formed 事件） */
  appendGraphEdge: (edge: GraphEdgeData) => void
  /** 更新图谱阶段进度（graph_progress 事件） */
  setGraphProgress: (progress: GraphProgress) => void
  /** 追加单轮推演结果（round_completed 事件） */
  appendSimRound: (round: SimRound) => void
  /** 重置图谱 + 推演数据（切 run 时调用） */
  resetGraphStream: () => void
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
      // 完整快照（含 artifacts）
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
      // 增量事件
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

      // ---- 新事件协议（BE2 SSE 双轨） ----
      // live_event 信封: { type: "live_event", event: { type: "...", stage: "...", data: {...} } }
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
          })
          if (Array.isArray(evtData.new_entities)) {
            for (const n of evtData.new_entities) get().appendGraphNode(n as GraphNodeData)
          }
          if (Array.isArray(evtData.new_relations)) {
            for (const e of evtData.new_relations) get().appendGraphEdge(e as GraphEdgeData)
          }
        } else if (evtType === 'entity_emerged' && evtData.entity) {
          get().appendGraphNode(evtData.entity as GraphNodeData)
        } else if (evtType === 'relationship_formed' && evtData.relation) {
          get().appendGraphEdge(evtData.relation as GraphEdgeData)
        } else if (evtType === 'round_completed' || evtType === 'round_progress') {
          get().appendSimRound({
            round: evtData.round ?? 0,
            total_rounds: evtData.total_rounds,
            progress: evtData.progress,
            actions_count: evtData.actions?.length ?? evtData.actions_count,
            belief_updates_count: evtData.belief_updates?.length ?? evtData.belief_updates_count,
            propagation_events_count: evtData.propagation_events?.length ?? evtData.propagation_events_count,
            active_agents: evtData.active_agents,
            actions: evtData.actions,
            belief_updates: evtData.belief_updates,
            propagation_events: evtData.propagation_events,
            new_entities: evtData.new_entities,
            new_relations: evtData.new_relations,
            ts: Date.now(),
          } as SimRound)
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
  lastRunConfig: null,
  graphNodes: [],
  graphEdges: [],
  graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
  simRounds: [],
  _sseRef: null,
  _sseCloseTimer: null,

  startPipeline: async (config) => {
    // 首行立刻设置 isStarting（消费方立即看到按钮变 loading）+ 重置上一 run 的图谱/回合数据
    set({
      status: 'running',
      currentStage: 'SEED_PARSING',
      progress: 0,
      error: null,
      isStarting: true,
      lastRunConfig: config,
      graphNodes: [],
      graphEdges: [],
      graphProgress: { phase: 'starting', nodes: 0, edges: 0 },
      simRounds: [],
    })
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
      lastRunConfig: null,
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

  dispose: () => {
    _closeSSE(get, set)
    set({ _sseRef: null, _sseCloseTimer: null })
  },

  // ---- 图谱 / 推演回合 actions（FE2/FE3 SSE + REST 消费方） ----
  /** 兼容旧 API：FE2 RealtimeKnowledgeGraph 用 seedGraph(rawNodes, rawEdges) */
  seedGraph: (nodes, edges) => {
    set({
      graphNodes: [...nodes],
      graphEdges: [...edges],
      graphProgress: { phase: 'completed', nodes: nodes.length, edges: edges.length },
    })
  },
  setGraphSnapshot: (nodes, edges, progress) => {
    set({
      graphNodes: [...nodes],
      graphEdges: [...edges],
      graphProgress: progress ?? { phase: 'completed', nodes: nodes.length, edges: edges.length },
    })
  },

  appendGraphNode: (node) => {
    const id = String(node.id)
    if (!id) return
    set((s) => {
      // 已存在则跳过（保留先来位置）
      if (s.graphNodes.some((n) => String(n.id) === id)) return s
      const next = [...s.graphNodes, node]
      return { graphNodes: next, graphProgress: { ...s.graphProgress, nodes: next.length } }
    })
  },

  appendGraphEdge: (edge) => {
    const id = String(edge.id ?? `${edge.source}->${edge.target}`)
    set((s) => {
      if (s.graphEdges.some((e) => String(e.id ?? `${e.source}->${e.target}`) === id)) return s
      const next = [...s.graphEdges, edge]
      return { graphEdges: next, graphProgress: { ...s.graphProgress, edges: next.length } }
    })
  },

  setGraphProgress: (progress) => set({ graphProgress: progress }),

  appendSimRound: (round) => {
    set((s) => {
      // 去重（同一 round 不重复 push）
      if (s.simRounds.some((r) => r.round === round.round)) return s
      const next = [...s.simRounds, round].sort((a, b) => a.round - b.round)
      return { simRounds: next }
    })
  },

  resetGraphStream: () => {
    set({
      graphNodes: [],
      graphEdges: [],
      graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
      simRounds: [],
    })
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
// P3-A: 读取最近一次启动时的完整 config（含 user_params）；Workbench 用以知道"用户在 Dashboard 选了啥"
export const useLastRunConfig = () => usePipelineStore((s) => s.lastRunConfig)

// ---- FE2/FE3: 实时图谱 + 推演回合 atomic selectors ----
export const useGraphNodes = () => usePipelineStore((s) => s.graphNodes)
export const useGraphEdges = () => usePipelineStore((s) => s.graphEdges)
export const useGraphProgress = () => usePipelineStore((s) => s.graphProgress)
export const useSimRounds = () => usePipelineStore((s) => s.simRounds)
/** 派生：图谱构建阶段（idle/starting/graph_building/completed） */
export const useGraphPhase = () => usePipelineStore((s) => s.graphProgress.phase)

/** FE2 兼容：网络帧（推演回合 + 涌现节点的扁平化视图） */
export interface NetworkFrameLive {
  round: number
  total_rounds?: number
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  actions_count?: number
  belief_updates_count?: number
  active_agents?: string[] | number
  ts?: number
}

// ---- FE2 兼容：图谱节点/边的"实时"形式（含 d3-force 位置字段） ----
/** RealtimeKnowledgeGraph 期望的"实时节点"类型（= GraphNodeData + 布局字段） */
export type GraphNodeLive = GraphNodeData & {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  index?: number
  isNew?: boolean
}
/** RealtimeKnowledgeGraph 期望的"实时边"类型 */
export type GraphEdgeLive = GraphEdgeData & {
  index?: number
  drawProgress?: number
  isNew?: boolean
}
/** FE2 兼容：从 simRounds 派生 NetworkFrameLive 数组 */
export const useNetworkFrames = (): NetworkFrameLive[] => {
  const rounds = useSimRounds()
  return rounds.map((r) => ({
    round: r.round,
    total_rounds: r.total_rounds,
    nodes: r.new_entities ?? [],
    edges: r.new_relations ?? [],
    actions_count: r.actions_count,
    belief_updates_count: r.belief_updates_count,
    ts: r.ts,
  }))
}
