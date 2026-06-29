/**
 * configSlice — start/pause/resume/cancel/advance + uploads + lastRunConfig.
 *
 * One of the 4 typed slices composing the pipeline store (G8).
 * Owns: isStarting, lastEventAt, lastRunConfig, uploads, uploadedDocIds,
 *       plus startPipeline / pause / resume / cancel / advanceYear / reset,
 *       uploads helpers.
 *
 * 设计: startPipeline 会同时重置 simSlice / graphSlice 的运行时数据
 * (因为是新 run), 所以这里使用复合 set 同时写多个 slice 字段。
 */
import http from '../../services/http'
import type { UploadItem } from '../pipeline'
import { formatErrorMessage } from '../../lib/formatError'

export interface ConfigSliceState {
  // 字段
  isStarting: boolean
  lastEventAt: number
  lastRunConfig: Record<string, unknown> | null
  uploads: Map<string, UploadItem>
  uploadedDocIds: string[]

  // actions
  startPipeline: (config: Record<string, unknown>) => Promise<string | null>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  advanceYear: (yearOffset?: number) => Promise<{ run_id: string; year_offset: number; rounds_to_run: number; status: string } | null>
  reset: () => void
  addUpload: (item: UploadItem) => void
  removeUpload: (id: string) => void
  clearUploads: () => void
  addUploadedDoc: (docId: string) => void
}

export type ConfigSliceCreator = (
  set: (partial: any) => void,
  get: () => any,
) => ConfigSliceState

export const configSlice: ConfigSliceCreator = (set, get) => ({
  isStarting: false,
  lastEventAt: 0,
  lastRunConfig: null,
  uploads: new Map(),
  uploadedDocIds: [],

  startPipeline: async (config) => {
    // 首行立刻设置 isStarting; 同时重置上一 run 的 graph/sim 数据
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
      // _openSSE is provided by uiSlice (composite store owns this helper)
      const openSSE = (get() as any)._openSSE
      if (typeof openSSE === 'function') openSSE(runId, get, set)
      return runId
    } catch (e: any) {
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
    const closeSSE = (get() as any)._closeSSE
    if (typeof closeSSE === 'function') closeSSE(get, set)
  },

  advanceYear: async (yearOffset = 1) => {
    const { runId } = get()
    if (!runId) return null
    set({
      status: 'running',
      currentStage: 'SIMULATION_RUNNING',
      error: null,
    })
    try {
      const r = await http.post(`/pipeline/${runId}/advance-year`, { year_offset: yearOffset })
      return r.data
    } catch (e: any) {
      set({ status: 'failed', error: formatErrorMessage(e) })
      return null
    }
  },

  reset: () => {
    const closeSSE = (get() as any)._closeSSE
    if (typeof closeSSE === 'function') closeSSE(get, set)
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

  addUploadedDoc: (docId) =>
    set((s: any) => ({ uploadedDocIds: [...s.uploadedDocIds, docId] })),

  addUpload: (item) =>
    set((s: any) => {
      const next = new Map(s.uploads)
      next.set(item.id, item)
      return { uploads: next }
    }),

  removeUpload: (id) =>
    set((s: any) => {
      const next = new Map(s.uploads)
      next.delete(id)
      return { uploads: next }
    }),

  clearUploads: () => set({ uploads: new Map() }),
})