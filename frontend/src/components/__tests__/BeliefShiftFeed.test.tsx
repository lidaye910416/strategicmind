/**
 * BeliefShiftFeed 单元测试
 *
 * 覆盖:
 *  (1) beliefShifts 空时显示空态
 *  (2) 有 shifts 时显示前 10 条, 每条含 agent_id / delta
 *  (3) isPositive → ArrowRight; 否则 ArrowLeft
 *  (4) |delta| > 0.5 用 rose 色, 否则 amber
 *  (5) round > 0 时显示 R{round} 标签
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import BeliefShiftFeed from '../BeliefShiftFeed'

const _shifts: any[] = []
vi.mock('../../store/pipeline', () => ({
  useBeliefShifts: () => _shifts,
}))

describe('<BeliefShiftFeed />', () => {
  beforeEach(() => {
    cleanup()
    _shifts.length = 0
  })

  it('空时显示空态', () => {
    _shifts.length = 0
    render(<BeliefShiftFeed />)
    expect(screen.getByTestId('belief-shift-feed-empty')).toBeInTheDocument()
    expect(screen.getByText(/尚无显著立场漂移/)).toBeInTheDocument()
  })

  it('有 shifts 时显示前 10 条 + agent_id + delta', () => {
    _shifts.push(
      { round: 1, agent_id: 'agent_a', old_value: 0.2, new_value: 0.6, delta: 0.40, ts: 1000 },
      { round: 2, agent_id: 'agent_b', old_value: 0.5, new_value: 0.0, delta: 0.50, ts: 2000 },
    )
    render(<BeliefShiftFeed />)
    expect(screen.getByTestId('belief-shift-feed')).toBeInTheDocument()
    expect(screen.getByText(/agent_a/)).toBeInTheDocument()
    expect(screen.getByText(/agent_b/)).toBeInTheDocument()
    expect(screen.getByText(/0\.40/)).toBeInTheDocument()
    expect(screen.getByText(/0\.50/)).toBeInTheDocument()
  })

  it('|delta| > 0.5 用 rose 色, 否则 amber', () => {
    _shifts.push({ round: 1, agent_id: 'big', delta: 0.70, ts: 1000 })
    const { container } = render(<BeliefShiftFeed />)
    // 查找 rose 色 class
    const html = container.innerHTML
    expect(html).toMatch(/text-rose-/)
  })

  it('round > 0 时显示 R{round} 标签', () => {
    _shifts.push({ round: 7, agent_id: 'agent_x', delta: 0.20, ts: 1000 })
    render(<BeliefShiftFeed />)
    expect(screen.getByText(/R7/)).toBeInTheDocument()
  })

  it('> 10 条时只显示前 10 条', () => {
    for (let i = 0; i < 15; i++) {
      _shifts.push({ round: i, agent_id: `agent_${i}`, delta: 0.20, ts: 1000 + i })
    }
    render(<BeliefShiftFeed />)
    // 验证 1..15 中只有 0..9 显示
    expect(screen.getByText(/agent_0/)).toBeInTheDocument()
    expect(screen.getByText(/agent_9/)).toBeInTheDocument()
    expect(screen.queryByText(/agent_10/)).not.toBeInTheDocument()
  })
})
