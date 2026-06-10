/**
 * EdgePath.tsx — quadratic Bezier edge with fan-curvature for parallel edges.
 *
 * Fan-curvature algorithm transcribed from GraphPanel.vue:435-447:
 *   - Group edges by unordered (source, target) pair
 *   - For each group, assign a curvature offset proportional to position
 *     in the group: 0 -> 0, 1 -> +k, 2 -> -k, 3 -> +2k, 4 -> -2k, ...
 *   - The control point is offset perpendicular to the (a->b) vector
 *
 * Halo-stroke label at midpoint.
 * Spec (T3.6): drop label rect at nodes.length > 100 (skip label rendering).
 */
import { COSMIC_LABEL_HALO, LABEL_HALO_STYLE } from './palette'
import type { ForceNode, ForceEdge } from './useD3Force'

export type { ForceNode, ForceEdge } from './useD3Force'

export interface EdgePathProps {
  edge: ForceEdge
  source: ForceNode
  target: ForceNode
  /**
   * Pre-computed fan-curvature offset for this edge within its parallel-edge
   * group. The parent (GraphCanvas) builds a Map<edgeId, number> once per
   * render so we don't iterate the full edge set on every EdgePath render.
   * Pass 0 for a single edge between a pair.
   */
  curvatureOffset: number
  hovered: string | null
  isHighlighted: boolean
  showLabels: boolean
  /** Total node count — skip label rect when > 100 */
  totalNodes: number
  drawProgress?: number  // 0..1 for the "draw-in" animation
}

/**
 * Compute fan-curvature offset for an edge within a parallel-edge group.
 * Key: unordered (min(a,b), max(a,b))
 *
 * Returns a number in the range [-maxOffset, +maxOffset] (cumulative).
 * Even-indexed edges bow one way, odd-indexed the other — gives the
 * visually distinct "fanning" look between A and B with multiple edges.
 */
export function computeEdgeCurvature(
  edge: ForceEdge,
  allEdges: ForceEdge[],
  maxOffset = 28,
): { offset: number; indexInGroup: number; groupSize: number } {
  const a = (typeof edge.source === 'object' ? (edge.source as ForceNode).id : edge.source) as string
  const b = (typeof edge.target === 'object' ? (edge.target as ForceNode).id : edge.target) as string
  const lo = a < b ? a : b
  const hi = a < b ? b : a

  // Find all edges in same group (including self-loops excluded)
  const group: ForceEdge[] = []
  for (const e of allEdges) {
    if (e === edge) continue
    const ea = (typeof e.source === 'object' ? (e.source as ForceNode).id : e.source) as string
    const eb = (typeof e.target === 'object' ? (e.target as ForceNode).id : e.target) as string
    if (ea === eb) continue  // skip self-loops
    const elo = ea < eb ? ea : eb
    const ehi = ea < eb ? eb : ea
    if (elo === lo && ehi === hi) group.push(e)
  }
  // Insert self in correct sorted order (by id for determinism)
  group.push(edge)
  group.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const idx = group.findIndex((e) => e.id === edge.id)
  // Symmetric fan: 0 -> 0, 1 -> +k, 2 -> -k, 3 -> +2k, 4 -> -2k
  const sign = idx === 0 ? 0 : (idx % 2 === 1 ? 1 : -1)
  const magnitude = Math.ceil(idx / 2)
  const offset = sign * magnitude * maxOffset
  return { offset, indexInGroup: idx, groupSize: group.length }
}

/**
 * Build the `d` attribute for a quadratic Bezier path between two points,
 * with a perpendicular control-point offset for fan-curvature.
 */
export function buildEdgePath(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature: number,
): string {
  if (curvature === 0) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  // Midpoint
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  // Perpendicular unit vector (rotated 90°)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const px = -dy / len
  const py = dx / len
  // Control point = midpoint + perpendicular * curvature
  const cx = mx + px * curvature
  const cy = my + py * curvature
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

/**
 * EdgePath — render a single edge as a <path> with halo-stroke label.
 * Pure function: takes edge + endpoints + group context, returns JSX.
 */
export function EdgePath({
  edge, source, target, curvatureOffset, hovered, isHighlighted,
  showLabels, totalNodes, drawProgress = 1,
}: EdgePathProps) {
  const a = typeof edge.source === 'object' ? (edge.source as ForceNode) : source
  const b = typeof edge.target === 'object' ? (edge.target as ForceNode) : target
  const ax = a.x ?? 0
  const ay = a.y ?? 0
  const bx = b.x ?? 0
  const by = b.y ?? 0

  // Fan-curvature (pre-computed by parent to avoid O(E²) per render).
  const offset = curvatureOffset
  const d = buildEdgePath(ax, ay, bx, by, offset)

  // Midpoint (for label)
  const midX = (ax + bx) / 2
  const midY = (ay + by) / 2
  // For curved edges, label sits on the curve at t=0.5
  let labelX = midX
  let labelY = midY
  if (offset !== 0) {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const px = -dy / len
    const py = dx / len
    labelX = midX + px * (offset * 0.5)
    labelY = midY + py * (offset * 0.5)
  }

  const stroke = isHighlighted ? '#E879F9' : 'rgba(148, 163, 184, 0.65)'
  const strokeWidth = isHighlighted ? 2 : 1.2
  const strokeOpacity = hovered && !isHighlighted ? 0.12 : 1

  return (
    <g opacity={drawProgress}>
      <path
        d={d}
        className="edge-path"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeLinecap="round"
      />
      {isHighlighted && showLabels && totalNodes <= 100 && (edge as any).type && (
        <text
          x={labelX}
          y={labelY - 4}
          textAnchor="middle"
          className="fill-slate-200"
          style={{
            fontSize: 9,
            fontWeight: 600,
            ...LABEL_HALO_STYLE,
          }}
          data-edge-label={(edge as any).type}
        >
          {(edge as any).type as string}
        </text>
      )}
    </g>
  )
}

/**
 * Self-loop edge: a small circle above the node. (Preserved from old design.)
 */
export function SelfLoopEdge({
  edge, node, hovered, showLabels, totalNodes, drawProgress = 1,
}: {
  edge: ForceEdge
  node: ForceNode
  hovered: string | null
  showLabels: boolean
  totalNodes: number
  drawProgress?: number
}) {
  const r = 10
  const isHighlighted = hovered === node.id
  return (
    <g opacity={drawProgress}>
      <circle
        cx={node.x ?? 0}
        cy={(node.y ?? 0) - (((node as any).size ?? 12) + r + 2)}
        r={r}
        fill="none"
        stroke={isHighlighted ? '#E879F9' : '#94A3B8'}
        strokeWidth={isHighlighted ? 2 : 1.2}
        strokeOpacity={0.85}
        strokeDasharray={undefined}
      />
      {isHighlighted && showLabels && totalNodes <= 100 && (edge as any).type && (
        <text
          x={node.x ?? 0}
          y={(node.y ?? 0) - (((node as any).size ?? 12) + r + 2) - 4}
          textAnchor="middle"
          className="fill-slate-200"
          style={{ fontSize: 9, fontWeight: 600, ...LABEL_HALO_STYLE }}
        >
          {(edge as any).type as string}
        </text>
      )}
    </g>
  )
}

// Re-export COSMIC_LABEL_HALO so test files don't need to dig into palette
export { COSMIC_LABEL_HALO }
