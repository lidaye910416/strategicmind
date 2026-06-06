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
  _sseRef: null,
  _sseCloseTimer: null,

  startPipeline: async (config) => {
    // 首行立刻设置 isStarting（消费方立即看到按钮变 loading）
    set({ status: 'running', currentStage: 'SEED_PARSING', progress: 0, error: null, isStarting: true, lastRunConfig: config })
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
