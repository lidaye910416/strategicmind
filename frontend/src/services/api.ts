/**
 * Pipeline API - 与后端 /api/pipeline/* 配套使用。
 *
 * 来源：C3 P0 #13：所有视图通过单一 http 实例访问后端。
 *      api.ts 不再独立 axios.create，全部委托给 services/http.ts。
 */
import http from './http'

export const pipelineApi = {
  start: (config: Record<string, unknown>) => http.post('/pipeline/start', { config }),
  getStatus: (runId: string) => http.get(`/pipeline/${runId}`),
  pause: (runId: string) => http.post(`/pipeline/${runId}/pause`),
  resume: (runId: string) => http.post(`/pipeline/${runId}/resume`),
  cancel: (runId: string) => http.post(`/pipeline/${runId}/cancel`),
}

// 兼容旧引用：很多视图 import api from '../services/api'
export default http
