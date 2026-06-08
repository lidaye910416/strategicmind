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

/** Seed analyze API — AI 一键预填 (LLM 抽 3 类结构化参数) */
export interface SeedAnalyzePatch {
  company_name?: string | null
  org_structure?: Array<{
    id?: string; name: string; reports_to?: string; headcount?: number; kpi_focus?: string
  }>
  financials?: Record<string, number | null | undefined>
  market?: {
    tam_yi?: number | null
    market_growth_pct?: number | null
    stance?: 'supportive' | 'neutral' | 'restrictive'
    competitors?: string[]
    regulation?: string[]
  }
  sources?: Array<{ doc_id: string; title: string; chars: number }>
}

export const seedApi = {
  list: () => http.get('/seed/list'),
  analyze: (docIds: string[]) => http.post<SeedAnalyzePatch>('/seed/analyze', { doc_ids: docIds }),
}

// 兼容旧引用：很多视图 import api from '../services/api'
export default http
