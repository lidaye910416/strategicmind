/**
 * Pipeline global state (Zustand).
 *
 * Implements: US-061, US-062
 */
import { create } from 'zustand'
import api from '../services/api'

export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

interface PipelineState {
  runId: string | null
  status: PipelineStatus
  currentStage: string
  progress: number
  error: string | null
  uploadedDocIds: string[]

  startPipeline: (config: Record<string, unknown>) => Promise<string | null>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  setProgress: (stage: string, progress: number) => void
  setStatus: (status: PipelineStatus) => void
  addUploadedDoc: (docId: string) => void
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  runId: null,
  status: 'idle',
  currentStage: 'IDLE',
  progress: 0,
  error: null,
  uploadedDocIds: [],

  startPipeline: async (config) => {
    set({ status: 'running', currentStage: 'SEED_PARSING', progress: 0, error: null })
    try {
      const r = await api.post('/pipeline/start', { config })
      const runId: string = r.data.run_id
      set({ runId })
      // Open SSE stream for live updates
      const es = new EventSource(`/api/pipeline/${runId}/events`)
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          // Backend serializes PipelineRun as `current_stage` (see
          // services/pipeline_orchestrator._snapshot). Accept both spellings
          // for safety with any older clients.
          const stage = data.current_stage ?? data.stage
          if (stage) {
            const pct = typeof data.progress === 'number' ? data.progress : get().progress
            get().setProgress(stage, pct)
          }
          if (data.status) get().setStatus(data.status as PipelineStatus)
        } catch { /* ignore malformed events */ }
      }
      es.onerror = () => {
        // Don't close immediately on transient errors - the EventSource
        // will auto-retry. Only give up on terminal status.
        if (['completed', 'failed', 'cancelled'].includes(get().status)) {
          es.close()
        }
      }
      return runId
    } catch (e: any) {
      set({ status: 'failed', error: e?.message || '启动推演失败' })
      return null
    }
  },

  pause: async () => {
    const { runId } = get()
    if (!runId) return
    await api.post(`/pipeline/${runId}/pause`)
    set({ status: 'paused' })
  },

  resume: async () => {
    const { runId } = get()
    if (!runId) return
    await api.post(`/pipeline/${runId}/resume`)
    set({ status: 'running' })
  },

  cancel: async () => {
    const { runId } = get()
    if (!runId) return
    await api.post(`/pipeline/${runId}/cancel`)
    set({ status: 'cancelled' })
  },

  reset: () => set({
    runId: null,
    status: 'idle',
    currentStage: 'IDLE',
    progress: 0,
    error: null,
  }),

  setProgress: (stage, progress) => set({ currentStage: stage, progress }),
  setStatus: (status) => set({ status }),
  addUploadedDoc: (docId) =>
    set((s) => ({ uploadedDocIds: [...s.uploadedDocIds, docId] })),
}))
