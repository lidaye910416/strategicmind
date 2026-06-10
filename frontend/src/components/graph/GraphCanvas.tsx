/**
 * GraphCanvas.tsx — Cosmic Observatory visual layer.
 *
 * Spec (T3.3):
 *   - Dot-grid background pattern
 *   - Dark base #0B1020
 *   - 10-type palette with halo-stroke labels
 *   - Skip: compass-rose empty state, ghost pills, custom SVG (per scope cut)
 *
 * This component is purely the visual layer. It does NOT manage state.
 * It takes nodes/edges/hovered/selected and renders.
 */
import { useMemo, type CSSProperties } from 'react'
import {
  COSMIC_BASE, COSMIC_GRID, HIGHLIGHT, LABEL_HALO_STYLE, getPalette, gradientId,
} from './palette'
import { EdgePath, SelfLoopEdge } from './EdgePath'
import type { ForceNode, ForceEdge } from './useD3Force'
import { renderSelfLoopBadge } from './graphBadges'

export interface GraphCanvasProps {
  nodes: ForceNode[]
  edges: ForceEdge[]
  width: number
  height: number
  hovered: string | null
  selected: string | null
  showLabels: boolean
  zoom: number
  building?: boolean
  onPointerEnter?: (id: string) => void
  onPointerLeave?: () => void
  onPointerDown?: (id: string, e: React.PointerEvent) => void
  onClick?: (id: string) => void
  onDoubleClick?: (id: string) => void
}

const svgStyle: CSSProperties = { background: COSMIC_BASE }

/**
 * GraphCanvas — renders the cosmic observatory: dot grid, typed nodes, curved edges.
 */
export function GraphCanvas({
  nodes, edges, width, height, hovered, selected, showLabels, zoom,
  building, onPointerEnter, onPointerLeave, onPointerDown, onClick, onDoubleClick,
}: GraphCanvasProps) {
  // Build a quick map for endpoint lookup (after d3 simulation resolves source/target)
  const nodeMap = useMemo(() => {
    const m = new Map<string, ForceNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  // Determine which node ids are highlighted via hover (neighbors too)
  const highlightSet = useMemo(() => {
    const s = new Set<string>()
    if (hovered) {
      s.add(hovered)
      for (const e of edges) {
        const sid = typeof e.source === 'object' ? (e.source as ForceNode).id : (e.source as string)
        const tid = typeof e.target === 'object' ? (e.target as ForceNode).id : (e.target as string)
        if (sid === hovered) s.add(tid)
        if (tid === hovered) s.add(sid)
      }
    }
    if (selected) s.add(selected)
    return s
  }, [hovered, selected, edges])

  // Pre-compute self-loop counts: O(E) per render, was O(N·E) per render.
  const selfLoopCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) {
      const sid = typeof e.source === 'object' ? (e.source as ForceNode).id : (e.source as string)
      const tid = typeof e.target === 'object' ? (e.target as ForceNode).id : (e.target as string)
      if (sid === tid) {
        m.set(sid, (m.get(sid) ?? 0) + 1)
      }
    }
    return m
  }, [edges])

  // Pre-compute fan-curvature offsets: O(E) per render, was O(E²) per render.
  // Groups edges by unordered (lo, hi) endpoint pair, then assigns offsets
  // 0 -> 0, 1 -> +k, 2 -> -k, 3 -> +2k, 4 -> -2k, ... (matches the prior-art).
  const edgeOffsets = useMemo(() => {
    const groups = new Map<string, ForceEdge[]>()
    for (const e of edges) {
      const sid = typeof e.source === 'object' ? (e.source as ForceNode).id : (e.source as string)
      const tid = typeof e.target === 'object' ? (e.target as ForceNode).id : (e.target as string)
      if (sid === tid) continue  // self-loops don't curve
      const lo = sid < tid ? sid : tid
      const hi = sid < tid ? tid : sid
      const key = `${lo}|${hi}`
      const arr = groups.get(key)
      if (arr) arr.push(e)
      else groups.set(key, [e])
    }
    const offsets = new Map<string, number>()
    const k = 28
    for (const arr of groups.values()) {
      arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      arr.forEach((e, idx) => {
        const sign = idx === 0 ? 0 : (idx % 2 === 1 ? 1 : -1)
        const magnitude = Math.ceil(idx / 2)
        offsets.set(e.id, sign * magnitude * k)
      })
    }
    return offsets
  }, [edges])

  const totalNodes = nodes.length

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="cosmic-observatory w-full h-full"
      style={{ ...svgStyle, cursor: 'default' }}
      data-testid="graph-canvas"
      data-building={building ? '1' : '0'}
    >
      <defs>
        {/* Dot-grid background pattern */}
        <pattern
          id="cosmic-dotgrid"
          x="0" y="0" width="24" height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="12" cy="12" r="1" fill={COSMIC_GRID} />
        </pattern>
        {/* Radial gradients per type for node fill */}
        {Object.keys({ ...getPaletteTypes() }).map((type) => {
          const p = getPalette(type)
          return (
            <radialGradient key={type} id={gradientId(type)} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={p.glow} stopOpacity="1" />
              <stop offset="100%" stopColor={p.base} stopOpacity="0.85" />
            </radialGradient>
          )
        })}
      </defs>

      {/* Dot-grid background */}
      <rect x="0" y="0" width={width} height={height} className="dot-grid" fill="url(#cosmic-dotgrid)" />

      {/* Edges (under nodes) */}
      <g transform={`translate(${width/2} ${height/2}) scale(${zoom}) translate(${-width/2} ${-height/2})`}>
        {edges.map((edge) => {
          const sid = typeof edge.source === 'object' ? (edge.source as ForceNode).id : (edge.source as string)
          const tid = typeof edge.target === 'object' ? (edge.target as ForceNode).id : (edge.target as string)
          const a = nodeMap.get(sid)
          const b = nodeMap.get(tid)
          if (!a || !b) return null
          if (a.x == null || b.x == null) return null
          const isHighlighted = highlightSet.has(sid) && highlightSet.has(tid)
          if (sid === tid) {
            return (
              <SelfLoopEdge
                key={edge.id}
                edge={edge}
                node={a}
                hovered={hovered}
                showLabels={showLabels}
                totalNodes={totalNodes}
              />
            )
          }
          return (
            <EdgePath
              key={edge.id}
              edge={edge}
              source={a}
              target={b}
              curvatureOffset={edgeOffsets.get(edge.id) ?? 0}
              hovered={hovered}
              isHighlighted={isHighlighted}
              showLabels={showLabels}
              totalNodes={totalNodes}
            />
          )
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          if (node.x == null || node.y == null) return null
          const palette = getPalette((node as any).type)
          const isHovered = hovered === node.id
          const isSelected = selected === node.id
          const isNeighbor = hovered && highlightSet.has(node.id) && !isHovered
          const r = ((node as any).size ?? 12) * ((node as any).birth ?? 1)
          const selfLoopCount = selfLoopCounts.get(node.id) ?? 0
          return (
            <g
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              style={{ opacity: (node as any).birth ?? 1, cursor: 'pointer' }}
              onPointerEnter={() => onPointerEnter?.(node.id)}
              onPointerLeave={() => onPointerLeave?.()}
              onPointerDown={(e) => onPointerDown?.(node.id, e)}
              onClick={(e) => { e.stopPropagation(); onClick?.(node.id) }}
              onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(node.id) }}
              data-node-id={node.id}
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  r={r + 6}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeDasharray="3 3"
                />
              )}
              {/* Hover ring */}
              {isHovered && (
                <circle
                  r={r + 4}
                  fill="none"
                  stroke="#F0ABFC"
                  strokeWidth={1.5}
                  opacity={0.7}
                />
              )}
              {/* Dim non-highlighted nodes when something is hovered */}
              {hovered && !isHovered && !isNeighbor && (
                <circle
                  r={r + 1}
                  fill="rgba(11, 16, 32, 0.6)"
                  stroke="none"
                />
              )}
              {/* Main node circle */}
              <circle
                r={r}
                className="entity-node"
                fill={`url(#${gradientId((node as any).type ?? 'DEFAULT')})`}
                stroke={isHovered || isSelected ? HIGHLIGHT : palette.ring}
                strokeWidth={isHovered || isSelected ? 3 : 2}
              />
              {/* Self-loop badge */}
              {renderSelfLoopBadge(r, selfLoopCount)}
              {/* Halo-stroke label */}
              {showLabels && (
                <text
                  x={r + 4}
                  y={4}
                  className="fill-slate-100"
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    pointerEvents: 'none',
                    ...LABEL_HALO_STYLE,
                  }}
                >
                  {((node as any).label ?? node.id).length > 8
                    ? ((node as any).label ?? node.id).slice(0, 8) + '…'
                    : (node as any).label ?? node.id}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** Helper to enumerate all palette keys for the defs. */
function getPaletteTypes(): Record<string, true> {
  return {
    COMPANY: true, PERSON: true, PRODUCT: true, BUSINESS: true,
    GOVERNMENT: true, REGULATION: true, TECH: true, CAPITAL: true,
    COMPETITOR: true, MARKET: true, CUSTOMER: true, DEFAULT: true,
  }
}
