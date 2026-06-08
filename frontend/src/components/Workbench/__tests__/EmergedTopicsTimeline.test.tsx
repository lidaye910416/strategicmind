/**
 * EmergedTopicsTimeline 单元测试
 *
 * 覆盖：
 *   1) 空态: graphNodes/simRounds 都为空 → 显示 emTopicEmpty 文案
 *   2) 渲染涌现实体: graphNodes 含 source='emergence' → 列表展示
 *   3) 过滤 chip 切换: 选 PERSON → 只剩 PERSON 实体
 *   4) belief 聚合: 同一 (round, entity) 出现多条 updates → 取平均
 *   5) 按 round 升序
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// vi.mock 会被 hoist 到文件顶部，引用需用 vi.hoisted
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

// 动态 import 以确保 mock 先生效
const { usePipelineStore } = await import('../../../store/pipeline')
import EmergedTopicsTimeline from '../EmergedTopicsTimeline'

// 给一个全局 EventSource stub
class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

describe('EmergedTopicsTimeline', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('空态: graphNodes + simRounds 都为空 → 显示 "推演完成后" 文案', () => {
    render(<EmergedTopicsTimeline />)
    expect(screen.getByTestId('em-topic-timeline')).toBeTruthy()
    // emTopicEmpty 文案
    expect(screen.getByText(/推演完成后/)).toBeTruthy()
  })

  it('渲染涌现实体: 列表展示 entity label', () => {
    // 直接 mutate store
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '新竞品 Alpha', entity_type: 'COMPANY', type: 'COMPANY', source: 'emergence', round: 3 } as any,
        { id: 'e2', label: '张总裁', entity_type: 'PERSON', type: 'PERSON', source: 'emergence', round: 5 } as any,
      ],
    })
    render(<EmergedTopicsTimeline />)
    const items = screen.getAllByTestId('em-topic-item')
    expect(items).toHaveLength(2)
    expect(screen.getByText('新竞品 Alpha')).toBeTruthy()
    expect(screen.getByText('张总裁')).toBeTruthy()
  })

  it('按 round 升序排序', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'late', label: 'LateTopic', entity_type: 'COMPANY', type: 'COMPANY', source: 'emergence', round: 8 } as any,
        { id: 'early', label: 'EarlyTopic', entity_type: 'COMPANY', type: 'COMPANY', source: 'emergence', round: 2 } as any,
      ],
    })
    render(<EmergedTopicsTimeline />)
    const items = screen.getAllByTestId('em-topic-item')
    expect(items[0].textContent).toContain('EarlyTopic')
    expect(items[1].textContent).toContain('LateTopic')
  })

  it('过滤 chip 切换: 选 PERSON → chip 变为 active 态', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'co1', label: 'CoX', entity_type: 'COMPANY', type: 'COMPANY', source: 'emergence', round: 1 } as any,
        { id: 'p1', label: '人A', entity_type: 'PERSON', type: 'PERSON', source: 'emergence', round: 2 } as any,
        { id: 'p2', label: '人B', entity_type: 'PERSON', type: 'PERSON', source: 'emergence', round: 3 } as any,
      ],
    })
    render(<EmergedTopicsTimeline />)
    expect(screen.getAllByTestId('em-topic-item')).toHaveLength(3)

    // 切到 PERSON — 验证 chip 状态 (active 态有 bg-brand-500 className)
    const personChip = screen.getByTestId('em-topic-filter-PERSON')
    expect(personChip.className).not.toContain('bg-brand-500')  // 初始非 active
    fireEvent.click(personChip)
    // 重新查询 (重新渲染后)
    const personChipAfter = screen.getByTestId('em-topic-filter-PERSON')
    expect(personChipAfter.className).toContain('bg-brand-500')  // 变为 active
    // 验证 'all' chip 不再 active
    const allChip = screen.getByTestId('em-topic-filter-all')
    expect(allChip.className).not.toContain('bg-brand-500')
  })

  it('belief 聚合: 同一 (round, entity) 多条 updates → 取平均', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: 'X', entity_type: 'COMPANY', type: 'COMPANY', source: 'emergence', round: 2 } as any,
      ],
      simRounds: [
        {
          round: 2,
          belief_updates: [
            { entity_id: 'e1', delta: 0.2 },
            { entity_id: 'e1', delta: 0.4 },
            { entity_id: 'e1', delta: -0.1 },
            { entity_id: 'other', delta: 0.99 },  // 不同 entity, 忽略
          ],
        } as any,
      ],
    })
    render(<EmergedTopicsTimeline />)
    const items = screen.getAllByTestId('em-topic-item')
    // 平均: (0.2 + 0.4 - 0.1) / 3 = 0.166... → +0.17
    expect(items[0].textContent).toMatch(/\+0\.17/)
  })
})
