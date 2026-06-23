/**
 * edgeHelpers — pure helpers for rendering graph edges + self-loop badges.
 *
 * Extracted from RealtimeKnowledgeGraph.tsx (v1, lines 514-603) for unit
 * testability. These functions do NOT trigger any rAF or d3-force loop —
 * they're pure JSX renderers for a given (edge, nodeA, nodeB) tuple.
 *
 * Used by RealtimeGraph.tsx after force layout resolves node positions.
 */
import React from 'react'

export interface SimNode {
  id: string
  x: number
  y: number
  size: number
  label: string
  type: string
  [k: string]: any
}

export interface SimEdge {
  id?: string
  source: string
  target: string
  type?: string
  drawProgress?: number
  isNew?: boolean
  [k: string]: any
}

/**
 * Render a single edge.
 *  - self-loop (source === target) → circle above node
 *  - normal edge → straight line
 */
export function renderEdge(
  edge: SimEdge,
  a: SimNode,
  b: SimNode,
  hovered: string | null,
  showLabels: boolean,
): JSX.Element {
  const isSelfLoop = edge.source === edge.target
  const isHighlighted = hovered === edge.source || hovered === edge.target
  if (isSelfLoop) {
    const r = 10
    return (
      <g key={edge.id} opacity={edge.drawProgress ?? 1}>
        <circle
          cx={a.x} cy={a.y - (a.size + r + 2)}
          r={r}
          fill="none"
          stroke={isHighlighted ? '#E91E63' : '#94A3B8'}
          strokeWidth={isHighlighted ? 2 : 1.2}
          strokeOpacity={0.85}
          strokeDasharray={edge.isNew ? `${2 * Math.PI * r * (edge.drawProgress ?? 0)} ${2 * Math.PI * r}` : undefined}
        />
        {isHighlighted && showLabels && (
          <text
            x={a.x} y={a.y - (a.size + r + 2) - 4}
            textAnchor="middle"
            className="fill-ink-700 dark:fill-ink-200"
            style={{ fontSize: 9, fontWeight: 600 }}
          >
            {edge.type}
          </text>
        )}
      </g>
    )
  }
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  return (
    <g key={edge.id} opacity={edge.drawProgress ?? 1}>
      <line
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={isHighlighted ? '#E91E63' : '#94A3B8'}
        strokeWidth={isHighlighted ? 2 : 1.2}
        strokeOpacity={hovered && !isHighlighted ? 0.12 : 0.65}
        strokeDasharray={edge.isNew ? `${len * (edge.drawProgress ?? 0)} ${len}` : undefined}
      />
      {isHighlighted && showLabels && (
        <text
          x={(a.x + b.x) / 2}
          y={(a.y + b.y) / 2 - 6}
          textAnchor="middle"
          className="fill-ink-700 dark:fill-ink-200"
          style={{ fontSize: 10, fontWeight: 600 }}
        >
          {edge.type}
        </text>
      )}
    </g>
  )
}

/** Count how many self-loops a node has. */
export function countSelfLoops(edges: { source: string; target: string }[], nodeId: string): number {
  return edges.filter((e) => e.source === nodeId && e.target === nodeId).length
}

/** Render a self-loop count badge in the upper-right of a node. Returns null when count=0. */
export function renderSelfLoopBadge(r: number, selfLoopCount: number): JSX.Element | null {
  if (selfLoopCount <= 0) return null
  return (
    <g transform={`translate(${r - 4} ${-r - 2})`} data-testid="self-loop-badge">
      <circle r={6} fill="#E91E63" data-testid="self-loop-badge-dot" />
      <text
        x={0} y={3}
        textAnchor="middle"
        className="fill-white"
        style={{ fontSize: 8, fontWeight: 700, pointerEvents: 'none' }}
        data-testid="self-loop-badge-text"
      >
        {selfLoopCount}
      </text>
    </g>
  )
}
