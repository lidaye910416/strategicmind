import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export const pipelineApi = {
  start: (config: any) => api.post('/pipeline/start', config),
  getStatus: (runId: string) => api.get(`/pipeline/${runId}`),
  pause: (runId: string) => api.post(`/pipeline/${runId}/pause`),
  resume: (runId: string) => api.post(`/pipeline/${runId}/resume`),
  cancel: (runId: string) => api.post(`/pipeline/${runId}/cancel`),
}

export default api
