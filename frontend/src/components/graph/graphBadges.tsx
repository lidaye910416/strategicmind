/**
 * graphBadges.ts — small helpers extracted from RealtimeKnowledgeGraph
 * so they can be reused by GraphCanvas and the new layout.
 *
 * Re-exports countSelfLoops / renderSelfLoopBadge, kept here so the canvas
 * doesn't need to import the full RealtimeKnowledgeGraph (which has heavy deps).
 */
import type { JSX } from 'react'

export function countSelfLoops(edges: { source: unknown; target: unknown }[], nodeId: string): number {
  return edges.filter((e) => e.source === nodeId && e.target === nodeId).length
}

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
