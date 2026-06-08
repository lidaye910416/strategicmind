/**
 * RoundTimelineChart 单元测试
 *
 * 覆盖:
 *  (1) buildRoundTimelineChartData 正确派生 actions / beliefUpdates 数量
 *  (2) 空数组 early return → []
 *  (3) 字段缺失时降级为 0（不抛错）
 *  (4) 默认组件渲染空态（无数据时显示提示）
 *  (5) highlightToRound 渲染 "R0 – RN" hint (跳过 recharts ResponsiveContainer, jsdom 不支持)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RoundTimelineChart, {
  buildRoundTimelineChartData,
  type RoundTimelineChartPoint,
} from '../RoundTimelineChart'

describe('buildRoundTimelineChartData', () => {
  it('空数组 → []', () => {
    expect(buildRoundTimelineChartData([])).toEqual([])
  })

  it('正确派生每轮 actions / beliefUpdates 数量', () => {
    const rounds = [
      { round_num: 1, actions: [{}, {}, {}], belief_updates: [{}, {}] },
      { round_num: 2, actions: [{}], belief_updates: [{}, {}, {}, {}] },
      { round_num: 3, actions: [], belief_updates: [] },
    ]
    const data = buildRoundTimelineChartData(rounds as any)
    expect(data).toEqual([
      { round: 1, actions: 3, beliefUpdates: 2 },
      { round: 2, actions: 1, beliefUpdates: 4 },
      { round: 3, actions: 0, beliefUpdates: 0 },
    ])
  })

  it('字段缺失时降级为 0 (不抛错)', () => {
    const rounds = [
      { round_num: 1 },  // actions / belief_updates 完全缺失
      { round_num: 2, actions: null, belief_updates: undefined },
    ]
    const data = buildRoundTimelineChartData(rounds as any)
    expect(data).toEqual([
      { round: 1, actions: 0, beliefUpdates: 0 },
      { round: 2, actions: 0, beliefUpdates: 0 },
    ])
  })
})

describe('<RoundTimelineChart />', () => {
  beforeEach(() => cleanup())

  it('空数据时显示空态提示', () => {
    render(<RoundTimelineChart data={[]} />)
    expect(screen.getByText(/暂无趋势数据/)).toBeInTheDocument()
  })

  it('有数据且 highlightToRound 时显示 hint 文本', () => {
    // 跳过 recharts ResponsiveContainer 的渲染 (jsdom 无 ResizeObserver) —
    // 这里只测 wrapper 文本部分, 通过把容器宽度强制给 recharts 测试 SVG
    // (实际: 由于 jsdom 限制, 我们只测组件 text 内容, 用更简单的 props)
    const data: RoundTimelineChartPoint[] = [
      { round: 1, actions: 3, beliefUpdates: 2 },
      { round: 2, actions: 5, beliefUpdates: 4 },
    ]
    // Polyfill ResizeObserver for jsdom (recharts ResponsiveContainer 需要)
    ;(globalThis as any).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }
    try {
      render(<RoundTimelineChart data={data} highlightToRound={2} />)
      // 当前回放: R0 – R2 文本应存在
      expect(screen.getByText(/当前回放：R0 – R2/)).toBeInTheDocument()
    } finally {
      delete (globalThis as any).ResizeObserver
    }
  })
})

