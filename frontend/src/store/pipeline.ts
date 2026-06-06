/**
 * Pipeline global state (Zustand) — 唯一 source of truth。
 *
 * 设计目标：
 *   - Dashboard / Workbench / LiveRunPanel 共享同一份 run 状态
 *   - URL 变化（/workbench/:runId）能自动 hydrate 进 store
 *   - SSE 事件全应用分发（**唯一 EventSource 入口** — FE3 P3-C）
 *
 * 来源：C3 P0 #2 + C1 C-01~08 融合
 *   - (a) 字段化 _sseRef + dispose action
 *   - (b) setTimeout 句柄存 ref 可取消
 *   - (c) 5 个 atomic selector hooks（避免整树 re-render）
 *   - (d) uploads: Map<id, UploadItem> + isStarting 首行设置
 *   - (e) lastEventAt 字段 + 5s 静默检测
 *
 * FE3 P3-C（EventSource 统一）：
 *   - _openSSE 解析 live_event 时写入模块级 _liveEventsBuffer（200 环形）
 *   - 同步维护 graphNodes / graphEdges（graph_progress 驱动）
 *   - 同步维护 networkFrames（round_progress 驱动）
 *   - 暴露 useGraphNodes / useGraphEdges / useNetworkFrames 三个 selector
 *   - 重新导出 usePipelineEvent（订阅 live_event 的通用 hook）
 *
 * Implements: US-061, US-062
 */
import { create } from 'zustand'
import http from '../services/http'
import { formatErrorMessage } from '../lib/formatError'
import {
  pushPipelineEvent,
  clearPipelineEvents as _clearPipelineEvents,
} from '../lib/hooks/usePipelineEvent'

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

// ---- 实时事件驱动派生数据（FE3 P3-C） ----
export interface GraphNodeLive {
  id: string
  label: string
  type: string
  index: number
}
export interface GraphEdgeLive {
  id: string
  source: string
  target: string
  type: string
  index: number
}
export interface NetworkEdgeLive {
  source: string
  target: string
  channel: string
  round: number
}
export interface NetworkFrameLive {
  round: number
  actions_count: number
  active_agents: number
  edges: NetworkEdgeLive[]
  cumulative_edge_count: number
}

const GRAPH_PHASE_TYPES = ['COMPANY', 'PERSON', 'PRODUCT', 'BUSINESS', 'GOVERNMENT', 'REGULATION']
const GRAPH_EDGE_TYPES = ['OWNS', 'MANAGES', 'INFLUENCES', 'DEPENDS_ON', 'REGULATED_BY']

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

  // ---- 实时事件派生数据（FE3 P3-C） ----
  graphNodes: GraphNodeLive[]
  graphEdges: GraphEdgeLive[]
  graphPhase: 'building' | 'completed' | 'idle'
  networkFrames: NetworkFrameLive[]

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
  /** 全量替换图谱节点（来自 REST snapshot 初始化） */
  seedGraph: (nodes: GraphNodeLive[], edges: GraphEdgeLive[]) => void
  /** 重置全部实时派生数据（重置 pipeline 时清空） */
  resetLiveData: () => void
  dispose: () => void
}

// ---- 实时派生数据处理工具（FE3 P3-C） ----

/** 从 cumulative count 派生节点数组（与原组件 growNodes 行为一致） */
function _buildGraphNodes(target: number): GraphNodeLive[] {
  const out: GraphNodeLive[] = []
  for (let i = 0; i < target; i++) {
    out.push({
      id: `n${i}`,
      label: `Entity ${i + 1}`,
      type: GRAPH_PHASE_TYPES[i % GRAPH_PHASE_TYPES.length],
      index: i,
    })
  }
  return out
}

function _buildGraphEdges(target: number): GraphEdgeLive[] {
  const out: GraphEdgeLive[] = []
  for (let i = 0; i < target; i++) {
    out.push({
      id: `e${i}`,
      source: `n${i % Math.max(1, target)}`,
      target: `n${(i * 7 + 1) % Math.max(1, target)}`,
      type: GRAPH_EDGE_TYPES[i % GRAPH_EDGE_TYPES.length],
      index: i,
    })
  }
  return out
}

function _processGraphProgress(state: PipelineState, evt: any): Partial<PipelineState> {
  const nodes = typeof evt?.nodes === 'number' ? evt.nodes : state.graphNodes.length
  const edges = typeof evt?.edges === 'number' ? evt.edges : state.graphEdges.length
  const phase: 'building' | 'completed' =
    evt?.phase === 'completed' ? 'completed' : 'building'
  return {
    graphNodes: nodes === state.graphNodes.length ? state.graphNodes : _buildGraphNodes(nodes),
    graphEdges: edges === state.graphEdges.length ? state.graphEdges : _buildGraphEdges(edges),
    graphPhase: phase,
  }
}

function _processRoundProgress(_state: PipelineState, evt: any): Partial<PipelineState> {
  const round = evt?.round ?? 0
  if (!round) return {}
  const newFrame: NetworkFrameLive = {
    round,
    actions_count: evt?.actions_count || 0,
    active_agents: evt?.active_agents || 0,
    edges: (evt?.propagation_edges || []).map((e: any) => ({
      source: e.source,
      target: e.target,
      channel: e.channel,
      round,
    })),
    cumulative_edge_count: 0,
  }
  const filtered = _state.networkFrames.filter((f) => f.round !== round)
  const next = [...filtered, newFrame].sort((a, b) => a.round - b.round)
  let acc = 0
  for (const f of next) {
    acc += f.edges.length
    f.cumulative_edge_count = acc
  }
  return { networkFrames: next }
}

// ---- 内部 SSE 工具（仍在模块作用域，但只通过 store 字段访问） ----

function _openSSE(
  runId: string,
  get: () => PipelineState,
  set: (partial: Partial<PipelineState>) => void,
) {
  // 关闭旧的
  _closeSSE(get, set)
  // 切换 runId 时清空上一轮的 live event buffer 与派生数据
  _clearPipelineEvents()
  set({ graphNodes: [], graphEdges: [], graphPhase: 'idle', networkFrames: [] })
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
      // 实时事件（FE3 P3-C）：所有 live_event 都进 buffer + 派发到派生数据
      if (data.type === 'live_event' && data.event) {
        pushPipelineEvent({ type: data.event.type, data: data.event.data, raw: data.event })
        const ev = data.event
        if (ev.type === 'graph_progress') {
          set(_processGraphProgress(get(), ev.data || {}))
        } else if (ev.type === 'round_progress') {
          set(_processRoundProgress(get(), ev.data || {}))
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
  graphNodes: [],
  graphEdges: [],
  graphPhase: 'idle',
  networkFrames: [],
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
    _clearPipelineEvents()
    set({
      runId: null,
      status: 'idle',
      currentStage: 'IDLE',
      progress: 0,
      error: null,
      snapshot: null,
      isStarting: false,
      lastEventAt: 0,
      graphNodes: [],
      graphEdges: [],
      graphPhase: 'idle',
      networkFrames: [],
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

  seedGraph: (nodes, edges) =>
    set({
      graphNodes: nodes.length > 0 ? nodes : get().graphNodes,
      graphEdges: edges.length > 0 ? edges : get().graphEdges,
    }),

  resetLiveData: () =>
    set({ graphNodes: [], graphEdges: [], graphPhase: 'idle', networkFrames: [] }),

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

// ---- FE3 P3-C：实时事件驱动 selector（统一 EventSource 入口） ----
export const useGraphNodes = (): GraphNodeLive[] => usePipelineStore((s) => s.graphNodes)
export const useGraphEdges = (): GraphEdgeLive[] => usePipelineStore((s) => s.graphEdges)
export const useGraphPhase = () => usePipelineStore((s) => s.graphPhase)
export const useNetworkFrames = (): NetworkFrameLive[] => usePipelineStore((s) => s.networkFrames)

// 重新导出通用 live_event 订阅 hook（保持旧 import 路径兼容）
export { usePipelineEvent, pushPipelineEvent, clearPipelineEvents } from '../lib/hooks/usePipelineEvent'
