/**
 * GraphRoundDiff + snapshotGraphAtRound 单元测试
 *
 * 覆盖：
 *   1) snapshotGraphAtRound: 同 round 去重
 *   2) appendSimRound 自动写 graphSnapshots
 *   3) resetGraphStream 清空 graphSnapshots
 *   4) simRounds < 2 → 空态文案
 *   5) simRounds >= 2 → 渲染双栏 + diff 摘要
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('../../../services/http', () => ({
  default: {
    get: mockGet,
    post: mockPost,
  },
}))

const { usePipelineStore } = await import('../../../store/pipeline')
import GraphRoundDiff from '../GraphRoundDiff'

class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

describe('snapshotGraphAtRound + graphSnapshots', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('snapshotGraphAtRound: 同 round 多次调用只保留第一次', () => {
    const s = usePipelineStore.getState()
    s.setGraphSnapshot([{ id: 'a' } as any], [{ id: 'e1' } as any])
    s.snapshotGraphAtRound(1)
    // 二次 snapshot 不应覆盖
    s.setGraphSnapshot([{ id: 'b' } as any], [])
    s.snapshotGraphAtRound(1)
    const snaps = usePipelineStore.getState().graphSnapshots
    expect(snaps[1].nodes).toHaveLength(1)
    expect(snaps[1].nodes[0].id).toBe('a')
  })

  it('appendSimRound: 自动写入 graphSnapshots[round]', () => {
    const s = usePipelineStore.getState()
    s.setGraphSnapshot([{ id: 'a' }, { id: 'b' }] as any, [])
    s.appendSimRound({ round: 3, ts: Date.now() } as any)
    const snaps = usePipelineStore.getState().graphSnapshots
    expect(snaps[3]).toBeDefined()
    expect(snaps[3].nodes).toHaveLength(2)
  })

  it('resetGraphStream: 清空 graphSnapshots', () => {
    const s = usePipelineStore.getState()
    s.snapshotGraphAtRound(1)
    expect(Object.keys(usePipelineStore.getState().graphSnapshots)).toHaveLength(1)
    s.resetGraphStream()
    expect(usePipelineStore.getState().graphSnapshots).toEqual({})
  })
})

describe('GraphRoundDiff 组件', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('空态: simRounds < 2 → 显示 "完成至少 2 轮推演后"', () => {
    render(<GraphRoundDiff />)
    expect(screen.getByTestId('graph-diff')).toBeTruthy()
    expect(screen.getByText(/完成至少 2 轮/)).toBeTruthy()
  })

  it('simRounds >= 2: 渲染双栏 + diff 摘要', () => {
    const s = usePipelineStore.getState()
    s.setGraphSnapshot(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] as any,
      [{ id: 'e1', source: 'a', target: 'b' }] as any,
    )
    s.snapshotGraphAtRound(1)
    s.setGraphSnapshot(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] as any,
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ] as any,
    )
    s.snapshotGraphAtRound(3)
    // 注入 2 轮 simRounds (因为 graphSnapshots 是 simRounds 驱动显示)
    s.appendSimRound({ round: 1, ts: Date.now() } as any)
    s.appendSimRound({ round: 3, ts: Date.now() } as any)
    // 上面 appendSimRound 会覆盖 snapshots — 重新注入
    usePipelineStore.setState({
      graphSnapshots: {
        1: { nodes: [{ id: 'a' }, { id: 'b' }] as any, edges: [{ id: 'e1' }] as any },
        3: { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any, edges: [{ id: 'e1' }, { id: 'e2' }] as any },
      },
    })

    render(<GraphRoundDiff />)
    expect(screen.getByTestId('graph-diff-pane-left')).toBeTruthy()
    expect(screen.getByTestId('graph-diff-pane-right')).toBeTruthy()
    const summary = screen.getByTestId('graph-diff-summary')
    expect(summary.textContent).toContain('+1')  // 1 个新节点
    expect(summary.textContent).toContain('+1')  // 1 条新关系
  })
})
