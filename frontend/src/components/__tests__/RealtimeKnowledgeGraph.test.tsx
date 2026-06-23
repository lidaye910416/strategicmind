/**
 * RealtimeKnowledgeGraph — 单元测试
 *
 * 覆盖 (self-loop 自环范式):
 *  (1) 自环边 (edge.source === edge.target) 渲染为 <circle> 而非 <line>
 *  (2) 普通边 (source !== target) 渲染为 <line>
 *  (3) countSelfLoops: 3+ 自环时返回 3
 *  (4) countSelfLoops: 无自环时返回 0
 *  (5) renderSelfLoopBadge: 1+ 时返回 <g> 含 #E91E63 圆 + 数字
 *  (6) renderSelfLoopBadge: count=0 时返回 null
 *  (7) 混合场景: countSelfLoops 在多节点 + 多自环下正确聚合
 *
 * 策略: 测试纯函数 (renderEdge / countSelfLoops / renderSelfLoopBadge),
 *       避免 rAF force-simulation 触发 hang。完整组件 render 在 jsdom 中过重。
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { renderEdge, countSelfLoops, renderSelfLoopBadge } from '../graph/RealtimeGraph'
import type { SimNode, SimEdge } from '../graph/RealtimeGraph'

// 测试用最小节点 / 边
function makeNode(id: string, x = 100, y = 100, size = 12): SimNode {
  return {
    id, label: id, type: 'COMPANY', index: 0,
    x, y, vx: 0, vy: 0, color: '#000', size, birth: 1, isNew: false,
  }
}
function makeEdge(id: string, source: string, target: string, type = 'RELATED_TO'): SimEdge {
  return { id, source, target, type, index: 0, drawProgress: 1, isNew: false }
}

// 用一个外层 <svg> 容器, 让渲染的 <g>/<circle>/<line> 都有合法父节点
const wrapSvg = (children: React.ReactNode) => (
  <svg data-testid="wrap">{children}</svg>
)

describe('RealtimeKnowledgeGraph — Self-Loop (self-loop)', () => {
  describe('renderEdge', () => {
    it('自环边 (source === target) 渲染为 <circle>, 不渲染 <line>', () => {
      const node = makeNode('n1', 100, 100)
      const edge = makeEdge('e1', 'n1', 'n1', 'SELF')
      const { container } = render(
        wrapSvg(renderEdge(edge, node, node, null, true)),
      )
      // 应该有 1 个 <circle> (r=10 自环)
      const circles = container.querySelectorAll('circle')
      expect(circles.length).toBe(1)
      const circle = circles[0]
      expect(circle.getAttribute('r')).toBe('10')
      // fill="none", stroke 灰色 (未 hover)
      expect(circle.getAttribute('fill')).toBe('none')
      expect(circle.getAttribute('stroke')).toBe('#94A3B8')
      // 关键: 不应该有 <line>
      expect(container.querySelector('line')).toBeNull()
    })

    it('hover 时自环变粉色 (#E91E63)', () => {
      const node = makeNode('n1', 100, 100)
      const edge = makeEdge('e1', 'n1', 'n1', 'SELF')
      const { container } = render(
        wrapSvg(renderEdge(edge, node, node, 'n1', true)),
      )
      const circle = container.querySelector('circle')!
      expect(circle.getAttribute('stroke')).toBe('#E91E63')
      expect(circle.getAttribute('stroke-width')).toBe('2')
    })

    it('普通边 (source !== target) 渲染为 <line>, 不渲染 <circle>', () => {
      const a = makeNode('n1', 50, 50)
      const b = makeNode('n2', 200, 200)
      const edge = makeEdge('e1', 'n1', 'n2', 'OWNS')
      const { container } = render(
        wrapSvg(renderEdge(edge, a, b, null, true)),
      )
      const lines = container.querySelectorAll('line')
      expect(lines.length).toBe(1)
      const line = lines[0]
      // line x1/y1 = a, x2/y2 = b
      expect(line.getAttribute('x1')).toBe('50')
      expect(line.getAttribute('y1')).toBe('50')
      expect(line.getAttribute('x2')).toBe('200')
      expect(line.getAttribute('y2')).toBe('200')
      // 不应该有 <circle>
      expect(container.querySelector('circle')).toBeNull()
    })
  })

  describe('countSelfLoops', () => {
    it('3+ 自环时返回 3', () => {
      const edges = [
        { source: 'n1', target: 'n1' },
        { source: 'n1', target: 'n1' },
        { source: 'n1', target: 'n1' },
      ]
      expect(countSelfLoops(edges, 'n1')).toBe(3)
    })

    it('无自环时返回 0', () => {
      const edges = [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
      ]
      expect(countSelfLoops(edges, 'n1')).toBe(0)
    })

    it('只算 source === target 的边, 不算单向', () => {
      // 注: 在有向图中, source→target 跟 target→source 是不同边
      const edges = [
        { source: 'n1', target: 'n2' },  // 普通
        { source: 'n2', target: 'n1' },  // 反向普通
        { source: 'n1', target: 'n1' },  // 自环
      ]
      expect(countSelfLoops(edges, 'n1')).toBe(1)
    })

    it('多节点场景: 每个节点独立计数', () => {
      const edges = [
        { source: 'n1', target: 'n1' },
        { source: 'n1', target: 'n1' },
        { source: 'n2', target: 'n2' },
        { source: 'n1', target: 'n2' },
      ]
      expect(countSelfLoops(edges, 'n1')).toBe(2)
      expect(countSelfLoops(edges, 'n2')).toBe(1)
      expect(countSelfLoops(edges, 'n3')).toBe(0)
    })
  })

  describe('renderSelfLoopBadge', () => {
    it('count >= 1 时返回 <g> 含 #E91E63 圆 + 数字文本', () => {
      const { getByTestId } = render(
        <svg>{renderSelfLoopBadge(12, 3)!}</svg>,
      )
      const badge = getByTestId('self-loop-badge')
      expect(badge).toBeTruthy()
      const dot = getByTestId('self-loop-badge-dot')
      expect(dot.getAttribute('r')).toBe('6')
      expect(dot.getAttribute('fill')).toBe('#E91E63')
      const text = getByTestId('self-loop-badge-text')
      expect(text.textContent).toBe('3')
      // fill-white class
      expect(text.getAttribute('class')).toContain('fill-white')
    })

    it('count = 0 时返回 null (不渲染 badge)', () => {
      const { container: badgeContainer } = render(
        <svg>{renderSelfLoopBadge(12, 0)}</svg>,
      )
      // 不应有 self-loop-badge testid
      expect(badgeContainer.querySelector('[data-testid="self-loop-badge"]')).toBeNull()
      expect(badgeContainer.querySelector('[data-testid="self-loop-badge-dot"]')).toBeNull()
    })

    it('count = 5 时文本显示 5', () => {
      const { getByTestId } = render(
        <svg>{renderSelfLoopBadge(12, 5)!}</svg>,
      )
      expect(getByTestId('self-loop-badge-text').textContent).toBe('5')
    })
  })

  describe('Integration: 混合场景', () => {
    it('节点 n1 有 2 个自环 + 普通边 e1, 渲染时 n1 badge=2', () => {
      const edges = [
        { id: 's1', source: 'n1', target: 'n1', type: 'SELF1' },
        { id: 's2', source: 'n1', target: 'n1', type: 'SELF2' },
        { id: 'e1', source: 'n1', target: 'n2', type: 'OWNS' },
      ]
      // countSelfLoops for n1
      expect(countSelfLoops(edges, 'n1')).toBe(2)
      expect(countSelfLoops(edges, 'n2')).toBe(0)
      // 渲染: 2 个自环 + 1 条 line
      const n1 = makeNode('n1', 100, 100)
      const n2 = makeNode('n2', 200, 200)
      const { container } = render(
        wrapSvg(
          <>
            {renderEdge(edges[0] as SimEdge, n1, n1, null, true)}
            {renderEdge(edges[1] as SimEdge, n1, n1, null, true)}
            {renderEdge(edges[2] as SimEdge, n1, n2, null, true)}
          </>,
        ),
      )
      // 2 个自环 (circle r=10) + 1 个 line
      expect(container.querySelectorAll('circle').length).toBe(2)
      expect(container.querySelectorAll('line').length).toBe(1)
    })
  })
})
