/**
 * Run — 单条 pipeline run 的最小化元数据形状。
 *
 * 来源：/api/pipeline/runs 返回的每条 entry。Dashboard / RecentRuns / useCurrentRunView
 * 都需要这套 shape, 集中在一个文件避免 3 处独立 interface 漂移。
 */
import type { PipelineStatus } from './index'

export interface Run {
  run_id: string
  status: PipelineStatus | string
  /** updated_at 是 unix seconds (来自后端) */
  updated_at?: number
  progress?: number
  started_at?: number
  current_stage?: string
  completed_stages?: string[]
  config_summary?: Record<string, any>
  config?: Record<string, any>
  error?: string | null
}
