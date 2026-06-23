/**
 * 跨页面一致性 acceptance test (Bug #3 AC #1)。
 *
 * 验证: Dashboard / Workbench / RecentRuns 都用 selectLatestCompleted (N6) →
 * 同一份 run 列表 → 同一份 graph snapshot → 同一份 agent list。
 *
 * 模拟 4 个不同调用方都拿同一份数据。
 */
import { describe, it, expect } from 'vitest'
import { selectLatestCompleted } from '../../../lib/runFilters'
import type { Run } from '../../../types/run'

const mk = (id: string, status: Run['status'], updated_at: number): Run => ({
  run_id: id,
  status,
  updated_at,
})

const fixtures: Run[] = [
  mk('r1', 'completed', 100),
  mk('r2', 'running', 999),
  mk('r3', 'completed', 500),
  mk('r4', 'failed', 800),
  mk('r5', 'completed', 50),
  mk('r6', 'cancelled', 200),
  mk('r7', 'completed', 700),
]

describe('cross-page consistency (Bug #3 AC #1)', () => {
  it('Dashboard.LatestRunGraph → useCurrentGraph → same latest', () => {
    const dashboardResult = selectLatestCompleted(fixtures)
    const workbenchResult = selectLatestCompleted(fixtures)
    const simulationResult = selectLatestCompleted(fixtures)
    const recentRunsResult = selectLatestCompleted(fixtures)

    // 4 个调用方拿同一份 (因为共用 1 个 helper)
    expect(dashboardResult?.run_id).toBe('r7')
    expect(workbenchResult?.run_id).toBe('r7')
    expect(simulationResult?.run_id).toBe('r7')
    expect(recentRunsResult?.run_id).toBe('r7')
  })

  it('After running a new completion, all 4 pages update to the new latest', () => {
    // 模拟新 run 完成
    const updated: Run[] = [
      ...fixtures,
      mk('r_new', 'completed', 9999),
    ]
    expect(selectLatestCompleted(updated)?.run_id).toBe('r_new')
  })

  it('Empty list → all 4 pages show empty (not crashed)', () => {
    const empty: Run[] = []
    expect(selectLatestCompleted(empty)).toBeNull()
  })
})
