/**
 * Graph layout helpers — 把 store 内的 Map 切片转成渲染用的位置状态。
 *
 * 设计原则：
 *   - 纯函数：相同输入永远返回相同初始位置
 *   - 已有 (x,y) 的节点保留位置（基于 id）
 *   - 新节点按出现顺序在剩余空白区播种
 *   - 力模拟步进由组件 useEffect 驱动
 */

import type { GraphNodeData, GraphEdgeData } from '../store/pipeline'

export interface PositionedNode {
  id: string
  label: string
  type: string
  influence: number
  index: number
  x: number
  y: number
  vx: number
  vy: number
  isNew: boolean
  source?: string
  round?: number
  birth: number
}

export interface PositionedEdge {
  id: string
  source: string
  target: string
  type: string
  index: number
  drawProgress: number
  isNew: boolean
}

const NODE_COLORS: Record<string, string> = {
  COMPANY: '#FF6B35',
  PERSON: '#E91E63',
  PRODUCT: '#7B2D8E',
  BUSINESS: '#004E89',
  GOVERNMENT: '#C5283D',
  REGULATION: '#64748B',
  TECH: '#06B6D4',
  CAPITAL: '#1A936F',
  COMPETITOR: '#E9724C',
  CUSTOMER: '#6C5CE7',
  MARKET: '#2D3436',
  DEFAULT: '#94A3B8',
}

export function nodeColor(type: string): string {
  return NODE_COLORS[type] || NODE_COLORS.DEFAULT
}

export function nodeSize(type: string, influence?: number): number {
  const base = type === 'PERSON' ? 16 : 12
  if (typeof influence === 'number') {
    return Math.max(8, Math.min(20, base + influence * 6))
  }
  return base
}

/**
 * 把 store 内的 nodes/edges Maps 投射为渲染用结构。
 * 入参 prevPos 用于"已有节点保留位置"（按 id）。
 */
export function buildGraphPositions(
  nodes: Iterable<GraphNodeData>,
  edges: Iterable<GraphEdgeData>,
  prevPos: Map<string, { x: number; y: number }>,
  width: number,
  height: number,
): { nodes: PositionedNode[]; edges: PositionedEdge[] } {
  const nodeArr = Array.from(nodes)
  const edgeArr = Array.from(edges)
  const cx = width / 2
  const cy = height / 2

  const positioned: PositionedNode[] = nodeArr.map((n, i) => {
    const reused = prevPos.get(n.id)
    const angle = (i / Math.max(1, nodeArr.length)) * Math.PI * 2 - Math.PI / 2
    const radius = Math.min(width, height) * 0.32 * (0.6 + ((i * 7) % 5) * 0.1)
    const baseX = reused?.x ?? cx + Math.cos(angle) * radius + ((i * 31) % 13) - 6
    const baseY = reused?.y ?? cy + Math.sin(angle) * radius + ((i * 17) % 11) - 5
    return {
      id: n.id,
      label: n.label ?? n.name ?? n.id,
      type: n.type ?? n.entity_type ?? 'UNKNOWN',
      influence: typeof n.influence === 'number' ? n.influence : 0.5,
      index: i,
      x: clamp(baseX, 30, width - 30),
      y: clamp(baseY, 30, height - 30),
      vx: 0,
      vy: 0,
      isNew: !reused,
      source: n.source,
      round: n.round,
      birth: reused ? 1 : 0,
    }
  })

  const posMap = new Map(positioned.map((n) => [n.id, n]))
  const positionedEdges: PositionedEdge[] = edgeArr
    .filter((e) => posMap.has(e.source) && posMap.has(e.target))
    .map((e, i) => ({
      id: e.id ?? `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: e.type ?? 'RELATED_TO',
      index: i,
      drawProgress: 0,
      isNew: true,
    }))

  return { nodes: positioned, edges: positionedEdges }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 单步力模拟（无依赖：组件 useEffect + requestAnimationFrame 调用）。
 * 返回新的 positioned nodes（保留 x/y/vx/vy）。
 */
export function stepForceLayout(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  dragging: string | null,
  width: number,
  height: number,
  iterations: number,
): PositionedNode[] {
  if (nodes.length === 0) return nodes
  const next = nodes.map((n) => ({ ...n }))
  const byId = new Map(next.map((n) => [n.id, n]))
  const cx = width / 2
  const cy = height / 2

  for (let step = 0; step < iterations; step++) {
    // 节点-节点排斥
    for (let i = 0; i < next.length; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const a = next[i]
        const b = next[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = 9000 / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (a.id !== dragging) {
          a.vx -= fx
          a.vy -= fy
        }
        if (b.id !== dragging) {
          b.vx += fx
          b.vy += fy
        }
      }
    }

    // 边-弹簧
    for (const e of edges) {
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const target = 140
      const diff = (dist - target) * 0.018
      const fx = (dx / dist) * diff
      const fy = (dy / dist) * diff
      if (a.id !== dragging) {
        a.vx += fx
        a.vy += fy
      }
      if (b.id !== dragging) {
        b.vx -= fx
        b.vy -= fy
      }
    }

    // 中心引力 + 阻尼
    for (const n of next) {
      n.vx += (cx - n.x) * 0.004
      n.vy += (cy - n.y) * 0.004
      if (n.id !== dragging) {
        n.vx *= 0.78
        n.vy *= 0.78
        n.x += n.vx
        n.y += n.vy
        n.x = clamp(n.x, 30, width - 30)
        n.y = clamp(n.y, 30, height - 30)
      }
    }
  }
  return next
}

/**
 * "破壳"动效步进：把新节点的 birth 从 0→1，新边的 drawProgress 0→1。
 */
export function stepAppearance(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
): { nodes: PositionedNode[]; edges: PositionedEdge[]; done: boolean } {
  let dirty = false
  const nNodes = nodes.map((n) => {
    if (n.birth < 1) {
      dirty = true
      return { ...n, birth: Math.min(1, n.birth + 0.06) }
    }
    return n
  })
  const nEdges = edges.map((e) => {
    if (e.drawProgress < 1) {
      dirty = true
      return { ...e, drawProgress: Math.min(1, e.drawProgress + 0.05) }
    }
    return e
  })
  return { nodes: nNodes, edges: nEdges, done: !dirty }
}
