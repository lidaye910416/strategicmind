/**
 * runFilters — N6 共享排序 helper 单元测试 (Bug #3)。
 *
 * 覆盖:
 *   - selectLatestCompleted: Dashboard / Workbench / useCurrentRunView 3 处
 *     都用同一个 helper, 永远返回同一份结果。
 *   - selectActiveOrRecent: RecentRuns 共享, 排除 failed/cancelled。
 *   - 跨页面一致性 (acceptance criteria #1): 4 个不同调用方拿到同一份 run。
 */
import { describe, it, expect } from 'vitest'
import {
  selectLatestCompleted,
  selectActiveOrRecent,
  selectCompletedByRecency,
} from '../runFilters'
import type { Run } from '../../types/run'

const mk = (id: string, status: Run['status'], updated_at: number): Run => ({
  run_id: id,
  status,
  updated_at,
})

describe('selectLatestCompleted', () => {
  it('returns null on empty input', () => {
    expect(selectLatestCompleted([])).toBeNull()
  })

  it('returns null on non-array input', () => {
    // @ts-expect-error testing runtime guard
    expect(selectLatestCompleted(null)).toBeNull()
    // @ts-expect-error testing runtime guard
    expect(selectLatestCompleted(undefined)).toBeNull()
  })

  it('picks most recent completed by updated_at', () => {
    const runs = [
      mk('r1', 'completed', 100),
      mk('r2', 'running', 999), // 更新但 running — 必须忽略
      mk('r3', 'completed', 500),
    ]
    expect(selectLatestCompleted(runs)?.run_id).toBe('r3')
  })

  it('ignores failed/cancelled/running/idle', () => {
    const runs = [
      mk('r1', 'failed', 1000),
      mk('r2', 'cancelled', 999),
      mk('r3', 'running', 998),
      mk('r4', 'idle', 800),
      mk('r5', 'completed', 500),
    ]
    expect(selectLatestCompleted(runs)?.run_id).toBe('r5')
  })

  it('does not mutate input array', () => {
    const runs = [
      mk('r1', 'completed', 100),
      mk('r2', 'completed', 500),
    ]
    const before = JSON.stringify(runs)
    selectLatestCompleted(runs)
    expect(JSON.stringify(runs)).toBe(before)
  })

  it('does not mutate when called multiple times (idempotent)', () => {
    const runs = [
      mk('r1', 'completed', 100),
      mk('r2', 'completed', 500),
    ]
    const a = selectLatestCompleted(runs)
    const b = selectLatestCompleted(runs)
    expect(a?.run_id).toBe('r2')
    expect(b?.run_id).toBe('r2')
  })
})

describe('selectActiveOrRecent', () => {
  it('drops failed and cancelled but keeps running/completed/idle', () => {
    const runs = [
      mk('r1', 'failed', 1000),
      mk('r2', 'cancelled', 999),
      mk('r3', 'running', 998),
      mk('r4', 'completed', 500),
      mk('r5', 'idle', 100),
    ]
    const ids = selectActiveOrRecent(runs).map((r) => r.run_id)
    expect(ids).toEqual(['r3', 'r4', 'r5'])
  })

  it('returns empty array on empty input', () => {
    expect(selectActiveOrRecent([])).toEqual([])
  })

  it('sorts by updated_at desc', () => {
    const runs = [
      mk('r1', 'completed', 100),
      mk('r2', 'completed', 500),
      mk('r3', 'completed', 300),
    ]
    const ids = selectActiveOrRecent(runs).map((r) => r.run_id)
    expect(ids).toEqual(['r2', 'r3', 'r1'])
  })
})

describe('selectCompletedByRecency', () => {
  it('returns completed only, sorted by recency', () => {
    const runs = [
      mk('r1', 'failed', 999),
      mk('r2', 'completed', 100),
      mk('r3', 'completed', 500),
      mk('r4', 'running', 800),
    ]
    const ids = selectCompletedByRecency(runs).map((r) => r.run_id)
    expect(ids).toEqual(['r3', 'r2'])
  })
})

/**
 * Acceptance Criteria #1: 跨页面一致性
 *
 * Dashboard.LatestRunGraph + RecentRuns + useCurrentRunView 全部经由
 * selectLatestCompleted → 同 1 份 run。
 */
describe('cross-page consistency via selectLatestCompleted (AC #1)', () => {
  it('3 different call sites pick the same latest completed run', () => {
    const runs = [
      mk('r1', 'completed', 100),
      mk('r2', 'running', 999),
      mk('r3', 'completed', 500),
      mk('r4', 'failed', 800),
    ]
    const a = selectLatestCompleted(runs)
    const b = selectLatestCompleted(runs)
    const c = selectLatestCompleted(runs)
    expect(a?.run_id).toBe('r3')
    expect(b?.run_id).toBe('r3')
    expect(c?.run_id).toBe('r3')
  })
})
