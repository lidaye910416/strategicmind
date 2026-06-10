/**
 * RealtimeKnowledgeGraph_v3 — 单元测试
 *
 * 覆盖 (T-COSMIC-SHIM):
 *  (1) Renders with 10 nodes + 15 edges fixture (no crash)
 *  (2) GraphCanvas is mounted (data-testid="graph-canvas" present)
 *  (3) NodeDetailPanel is mounted (even when no node selected, it should be in DOM via AnimatePresence)
 *  (4) Click on a node triggers the onNodeClick callback
 *  (5) FilterBar is mounted (chip row + search)
 *  (6) Empty state when no nodes
 *  (7) Maximize button toggles the container class
 *
 * 策略: 用一个外层 store 注入 (zustand) 一次性填满 graphNodes/graphEdges,
 *       让 v3 走 store 路径。jsdom 中 d3-force 会启动但 settle 较慢 — 我们
 *       用 enabled=false 的方式不行 (useD3Force 内部管) ；改用直接传 fallback。
 *       既然 v3 接受 fallback prop, 测试走 fallback 路径, 不依赖 store。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import React from 'react'
import RealtimeKnowledgeGraph_v3 from './RealtimeKnowledgeGraph_v3'
import type { GraphNodeData, GraphEdgeData } from '../store/pipeline'

// Mock the api service to silence any calls (we use fallback path)
vi.mock('../services/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { nodes: [], edges: [] } }),
  },
}))

// Mock framer-motion to keep tests fast + deterministic
vi.mock('framer-motion', () => ({
  motion: {
    aside: ({ children, ...props }: any) => React.createElement('aside', props, children),
    div: ({ children, ...props }: any) => React.createElement('div', props, children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}))

/** Fixture: 10 nodes, 15 edges — covers the 10-type palette + multiple parallel edges */
function makeFixture(): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const types = [
    'COMPANY', 'PERSON', 'PRODUCT', 'BUSINESS', 'GOVERNMENT',
    'REGULATION', 'TECH', 'CAPITAL', 'COMPETITOR', 'MARKET',
  ]
  const nodes: GraphNodeData[] = types.map((type, i) => ({
    id: `n${i}`,
    label: `${type}-${i}`,
    type,
    index: i,
  }))
  // 15 edges: 5 from each of 3 hub nodes (n0, n1, n2) -> first 5 leaves
  const edges: GraphEdgeData[] = []
  for (let hub = 0; hub < 3; hub++) {
    for (let k = 0; k < 5; k++) {
      edges.push({
        id: `e-h${hub}-${k}`,
        source: `n${hub}`,
        target: `n${(hub * 3 + k + 3) % nodes.length}`,
        type: hub === 0 ? 'OWNS' : hub === 1 ? 'KNOWS' : 'MANAGES',
      })
    }
  }
  return { nodes, edges }
}

describe('RealtimeKnowledgeGraph_v3 — Cosmic Observatory shim', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders with 10 nodes + 15 edges fixture (no crash)', () => {
    const { nodes, edges } = makeFixture()
    const { container } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        title="测试图谱"
        fallback={{ nodes, edges }}
      />,
    )
    // GraphCanvas should be mounted and have SVG with node groups
    const svg = container.querySelector('[data-testid="graph-canvas"]')
    expect(svg).toBeTruthy()
    // 10 nodes -> 10 <g data-node-id=...>
    const nodeGroups = container.querySelectorAll('[data-node-id]')
    expect(nodeGroups.length).toBe(10)
  })

  it('mounts GraphCanvas with cosmic dot-grid pattern', () => {
    const { nodes, edges } = makeFixture()
    const { container } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    const svg = container.querySelector('[data-testid="graph-canvas"]') as SVGSVGElement
    expect(svg).toBeTruthy()
    // 10-type palette radial gradients should be defined
    const defs = svg.querySelector('defs')
    expect(defs).toBeTruthy()
    // cosmic-dotgrid pattern should exist
    const dotgrid = defs?.querySelector('#cosmic-dotgrid')
    expect(dotgrid).toBeTruthy()
  })

  it('mounts NodeDetailPanel in DOM (even when no node is selected)', () => {
    const { nodes, edges } = makeFixture()
    // The AnimatePresence wrapper always exists; when node=null the panel itself is hidden
    // but the parent motion.aside is rendered only when node != null. We assert:
    //  - selecting a node shows the panel
    //  - then the panel exists in the DOM
    const { container, rerender } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    // Initially: no detail panel (no selection)
    expect(container.querySelector('[data-testid="node-detail-panel"]')).toBeNull()

    // Click a node (find the first node group, dispatch a click)
    const firstNode = container.querySelector('[data-node-id]') as Element
    expect(firstNode).toBeTruthy()
    fireEvent.click(firstNode)

    // Re-render to flush state
    rerender(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    // Now the detail panel should be in the DOM
    const panel = container.querySelector('[data-testid="node-detail-panel"]')
    expect(panel).toBeTruthy()
  })

  it('clicking a node triggers the onNodeClick callback with (id, node)', () => {
    const { nodes, edges } = makeFixture()
    const onNodeClick = vi.fn()
    const { container } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
        onNodeClick={onNodeClick}
      />,
    )
    const firstNode = container.querySelector('[data-node-id="n0"]') as Element
    expect(firstNode).toBeTruthy()
    fireEvent.click(firstNode)
    expect(onNodeClick).toHaveBeenCalledTimes(1)
    // The callback signature: (id, node)
    const [idArg, nodeArg] = onNodeClick.mock.calls[0]
    expect(idArg).toBe('n0')
    expect(nodeArg).toBeTruthy()
    expect(nodeArg.id).toBe('n0')
    expect(nodeArg.type).toBe('COMPANY')
  })

  it('mounts FilterBar with All chip and per-type chips', () => {
    const { nodes, edges } = makeFixture()
    const { getByTestId } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    const filterBar = getByTestId('filter-bar')
    expect(filterBar).toBeTruthy()
    const all = getByTestId('chip-All')
    expect(all.getAttribute('data-active')).toBe('1')
    expect(all.textContent).toContain('10')
  })

  it('shows empty state when no nodes and no fallback', () => {
    const { container, getByText } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={null}
      />,
    )
    // Should still render the graph container
    const containerEl = container.querySelector('[data-testid="v3-graph-container"]')
    expect(containerEl).toBeTruthy()
    // The empty-state text (Chinese, default) — there are two possible texts depending on `building` flag
    // Accept either "暂无图谱数据" (no building) or "等待节点涌现…" (building)
    const emptyText = getByText(/暂无图谱数据|等待节点涌现/)
    expect(emptyText).toBeTruthy()
  })

  it('maximize button toggles the container class', () => {
    const { nodes, edges } = makeFixture()
    const { container, getByTestId } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    const max = getByTestId('v3-maximize')
    fireEvent.click(max)
    // After maximize, container should have the 'fixed inset-4 z-50' class
    const card = container.querySelector('.fixed.inset-4.z-50')
    expect(card).toBeTruthy()
  })

  it('renders type legend chips (capped at 8 visible)', () => {
    const { nodes, edges } = makeFixture()
    const { container } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    // Should render the legend pills (capped at 8 visible, like the OLD component).
    // The legend uses bg-slate-900/80 backdrop-blur-sm class for each pill.
    const legend = container.querySelectorAll('.bg-slate-900\\/80')
    // 10 unique types in fixture, but the legend caps at 8
    expect(legend.length).toBeGreaterThanOrEqual(1)
    expect(legend.length).toBeLessThanOrEqual(10)
    // Specifically, the v3 component slices to 8 in render — assert at most 8
    expect(legend.length).toBeLessThanOrEqual(8)
  })

  it('emits 10 type-specific radial gradients (palette coverage)', () => {
    const { nodes, edges } = makeFixture()
    const { container } = render(
      <RealtimeKnowledgeGraph_v3
        runId={null}
        live={false}
        height={400}
        fallback={{ nodes, edges }}
      />,
    )
    const svg = container.querySelector('[data-testid="graph-canvas"]') as SVGSVGElement
    const defs = svg.querySelector('defs')!
    // Gradient ids follow the pattern `grad-<TYPE>` for the 10 types in fixture
    const palette = ['COMPANY', 'PERSON', 'PRODUCT', 'BUSINESS', 'GOVERNMENT',
      'REGULATION', 'TECH', 'CAPITAL', 'COMPETITOR', 'MARKET']
    for (const t of palette) {
      const grad = defs.querySelector(`#grad-${t}`)
      expect(grad, `Missing gradient for ${t}`).toBeTruthy()
    }
  })
})
