/**
 * frontend/src/lib/runFilters.ts
 *
 * 共享 run 过滤/排序 helpers — 避免 3 处 ad-hoc "latest" 定义漂移 (N6)。
 * 唯一允许改 "completed 怎么算" 的地方。
 *
 * 设计：
 *   - selectLatestCompleted: Dashboard / Workbench / useCurrentRunView 共享的
 *     "最近一次 completed run" 排序定义。3 处都调这同一个 helper, 永远一致。
 *   - selectActiveOrRecent: RecentRuns 用的"显示 active + recent, 排除 failed/cancelled"
 *     排序定义。
 *   - selectCompletedByRecency: 若某处需要 completed 列表 (而不是单条), 用这个。
 */
import type { Run } from '../types/run'

/** 取最近一次 completed run, 按 updated_at 降序 */
export function selectLatestCompleted(runs: Run[]): Run | null {
  if (!Array.isArray(runs) || runs.length === 0) return null
  return (
    [...runs]
      .filter((r) => r.status === 'completed')
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0] ?? null
  )
}

/** 按 updated_at 降序 (不过滤, RecentRuns 用的"显示所有" 排序) */
export function selectAllByRecency(runs: Run[]): Run[] {
  if (!Array.isArray(runs)) return []
  return [...runs].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
}

/** 排除 failed + cancelled, 按 updated_at 降序 */
export function selectActiveOrRecent(runs: Run[]): Run[] {
  if (!Array.isArray(runs)) return []
  return [...runs]
    .filter((r) => r.status !== 'failed' && r.status !== 'cancelled')
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
}

/** 仅过滤 completed + completed 排序（保留数组） */
export function selectCompletedByRecency(runs: Run[]): Run[] {
  if (!Array.isArray(runs)) return []
  return [...runs]
    .filter((r) => r.status === 'completed')
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
}
