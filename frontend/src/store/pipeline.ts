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
          if (data.stage) get().setProgress(data.stage, data.progress ?? get().progress)
          if (data.status) get().setStatus(data.status as PipelineStatus)
        } catch { /* ignore malformed events */ }
      }
      es.onerror = () => {
        es.close()
      }
      return runId
    } catch (e: any) {
      set({ status: 'failed', error: e?.message || 'Failed to start pipeline' })
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
