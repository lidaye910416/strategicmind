/**
 * EntityDanmaku 单元测试
 *
 * 覆盖:
 *  (1) graphNodes 为空时不渲染 (零侵入)
 *  (2) 单个新节点出现时, 渲染对应卡片 + label
 *  (3) 卡片显示 type tag
 *  (4) 3s 后自动消失 (使用 fake timer)
 *  (5) 同一 id 在 250ms 节流窗口内不重复出现
 *  (6) 点击关闭按钮立即消失
 *  (7) 最多同时显示 MAX_VISIBLE (5) 张, 超出后最早被踢出
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import EntityDanmaku from '../EntityDanmaku'
import { usePipelineStore } from '../../store/pipeline'
import type { GraphNodeData } from '../../store/pipeline'

describe('<EntityDanmaku />', () => {
  beforeEach(() => {
    cleanup()
    vi.useFakeTimers()
    // 重置 store.graphNodes
    usePipelineStore.setState({ graphNodes: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('graphNodes 为空时不渲染 (零侵入)', () => {
    const { container } = render(<EntityDanmaku />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('entity-danmaku')).toBeNull()
  })

  it('单个新节点出现时渲染卡片 + label', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '宁德时代', type: 'COMPANY' } as GraphNodeData,
      ],
    })
    render(<EntityDanmaku />)
    expect(screen.getByTestId('entity-danmaku')).toBeInTheDocument()
    expect(screen.getByText('宁德时代')).toBeInTheDocument()
  })

  it('卡片显示 type tag', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '王传福', type: 'PERSON' } as GraphNodeData,
      ],
    })
    render(<EntityDanmaku />)
    expect(screen.getByText('PERSON')).toBeInTheDocument()
  })

  it('3s 后自动消失', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '宁德时代', type: 'COMPANY' } as GraphNodeData,
      ],
    })
    render(<EntityDanmaku />)
    expect(screen.getByTestId('entity-danmaku-item')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(screen.queryByTestId('entity-danmaku-item')).toBeNull()
  })

  it('同 id 在 250ms 节流窗口内不重复出现', () => {
    const { rerender } = render(<EntityDanmaku />)
    // 第一次出现
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '宁德时代', type: 'COMPANY' } as GraphNodeData,
      ],
    })
    rerender(<EntityDanmaku />)
    expect(screen.getAllByTestId('entity-danmaku-item').length).toBe(1)
    // 立刻把同一 id 注入 store (重复)
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '宁德时代', type: 'COMPANY' } as GraphNodeData,
      ],
    })
    rerender(<EntityDanmaku />)
    // 仍然只有 1 张
    expect(screen.getAllByTestId('entity-danmaku-item').length).toBe(1)
  })

  it('点击关闭按钮立即消失', () => {
    usePipelineStore.setState({
      graphNodes: [
        { id: 'e1', label: '宁德时代', type: 'COMPANY' } as GraphNodeData,
      ],
    })
    render(<EntityDanmaku />)
    expect(screen.getByTestId('entity-danmaku-item')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('entity-danmaku-dismiss'))
    expect(screen.queryByTestId('entity-danmaku-item')).toBeNull()
  })

  it('超过 MAX_VISIBLE (5) 张时, 最早一张被踢出', () => {
    // 一次注入 6 个不同 id
    const nodes: GraphNodeData[] = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      label: `实体 ${i}`,
      type: 'COMPANY',
    })) as GraphNodeData[]
    usePipelineStore.setState({ graphNodes: nodes })
    render(<EntityDanmaku />)
    const visible = screen.getAllByTestId('entity-danmaku-item')
    expect(visible.length).toBeLessThanOrEqual(5)
    // 最早加入 (e0) 应被踢出
    expect(screen.queryByText('实体 0')).toBeNull()
    // 最新加入 (e5) 应保留
    expect(screen.getByText('实体 5')).toBeInTheDocument()
  })
})
