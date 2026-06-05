/**
 * 知识图谱可视化 - 力导向图（参考 MiroFish GraphPanel）
 *
 * 展示图谱中的实体（节点）和关系（边），原生 SVG 实现力模拟。
 * 
 * Implements: US-221 知识图谱可视化
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Network, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff } from 'lucide-react'

interface GraphNode {
  id: string
  label: string
  type: string
  summary?: string
}

interface GraphEdge {
  source: string
  target: string
  type: string
}

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  height?: number
  onNodeClick?: (node: GraphNode) => void
}

const NODE_COLORS: Record<string, string> = {
  COMPANY: '#3b82f6',     // blue
  PERSON: '#ec4899',      // pink
  PRODUCT: '#8b5cf6',     // violet
  BUSINESS: '#f59e0b',    // amber
  GOVERNMENT: '#ef4444',  // red
  REGULATION: '#64748b',  // slate
  TECH: '#06b6d4',        // cyan
  CAPITAL: '#10b981',     // emerald
  DEFAULT: '#94a3b8',     // gray
}

interface SimNode {
  id: string
  label: string
  type: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
}

export default function KnowledgeGraph({
  nodes,
  edges,
  height = 480,
  onNodeClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [simNodes, setSimNodes] = useState<SimNode[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [tick, setTick] = useState(0)

  // 初始化节点
  useEffect(() => {
    if (!nodes || nodes.length === 0) return
    const w = 800
    const cx = w / 2
    const cy = height / 2
    const radius = Math.min(w, height) * 0.3
    const n = nodes.length

    const initial: SimNode[] = nodes.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      // PERSON 节点稍大（人物更显眼）
      const isPerson = node.type === 'PERSON'
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        x: cx + Math.cos(angle) * radius * (0.6 + Math.random() * 0.4),
        y: cy + Math.sin(angle) * radius * (0.6 + Math.random() * 0.4),
        vx: 0,
        vy: 0,
        color: NODE_COLORS[node.type] || NODE_COLORS.DEFAULT,
        size: isPerson ? 22 : 16,
      }
    })
    setSimNodes(initial)
  }, [nodes, height])

  // 力模拟
  useEffect(() => {
    if (simNodes.length === 0) return
    let raf: number
    let iter = 0
    const maxIter = 250

    const step = () => {
      setSimNodes((prev) => {
        const next = prev.map((n) => ({ ...n }))
        const w = 800
        const h = height
        const cx = w / 2
        const cy = h / 2

        // 库仑斥力
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const dx = next[j].x - next[i].x
            const dy = next[j].y - next[i].y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = 5000 / (dist * dist)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            if (next[i].id !== dragging) { next[i].vx -= fx; next[i].vy -= fy }
            if (next[j].id !== dragging) { next[j].vx += fx; next[j].vy += fy }
          }
        }

        // 弹簧（连接的节点）
        for (const edge of edges) {
          const a = next.find((n) => n.id === edge.source)
          const b = next.find((n) => n.id === edge.target)
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const targetDist = 130
          const diff = (dist - targetDist) * 0.02
          const fx = (dx / dist) * diff
          const fy = (dy / dist) * diff
          if (a.id !== dragging) { a.vx += fx; a.vy += fy }
          if (b.id !== dragging) { b.vx -= fx; b.vy -= fy }
        }

        // 中心引力
        for (const n of next) {
          n.vx += (cx - n.x) * 0.005
          n.vy += (cy - n.y) * 0.005
        }

        // 应用速度（带阻尼）
        for (const n of next) {
          if (n.id === dragging) continue
          n.vx *= 0.7
          n.vy *= 0.7
          n.x += n.vx
          n.y += n.vy
          n.x = Math.max(30, Math.min(w - 30, n.x))
          n.y = Math.max(30, Math.min(h - 30, n.y))
        }

        return next
      })

      iter++
      if (iter < maxIter) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [edges.length, dragging, height, tick])

  // 拖拽支持
  const onPointerDown = (id: string, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 800
    const y = ((e.clientY - rect.top) / rect.height) * height
    setSimNodes((prev) =>
      prev.map((n) => (n.id === dragging ? { ...n, x, y, vx: 0, vy: 0 } : n))
    )
  }

  const onPointerUp = () => {
    setDragging(null)
  }

  const hoveredNode = hovered ? simNodes.find((n) => n.id === hovered) : null
  const hoveredNodeData = hovered ? nodes.find((n) => n.id === hovered) : null

  // 统计
  const typeCount: Record<string, number> = {}
  for (const n of nodes) {
    typeCount[n.type] = (typeCount[n.type] || 0) + 1
  }

  if (nodes.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Network size={32} className="mx-auto text-ink-300 mb-2" />
        <div className="text-sm text-ink-500">暂无图谱数据</div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
            <Network size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              知识图谱
            </div>
            <div className="text-xs text-ink-700 dark:text-ink-300">
              {nodes.length} 节点 · {edges.length} 关系
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            className="btn-ghost h-7 w-7 p-0"
            onClick={() => setShowLabels((v) => !v)}
            title={showLabels ? '隐藏标签' : '显示标签'}
          >
            {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            className="btn-ghost h-7 w-7 p-0"
            onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
            title="放大"
          >
            <ZoomIn size={12} />
          </button>
          <button
            className="btn-ghost h-7 w-7 p-0"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
            title="缩小"
          >
            <ZoomOut size={12} />
          </button>
          <button
            className="btn-ghost h-7 w-7 p-0"
            onClick={() => setTick((t) => t + 1)}
            title="重置布局"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      <div className="relative rounded-xl bg-gradient-to-br from-ink-50/30 to-ink-100/30 dark:from-ink-900/30 dark:to-ink-800/30 overflow-hidden border border-ink-200/40">
        <svg
          ref={svgRef}
          viewBox={`0 0 800 ${height}`}
          className="w-full"
          style={{ height, cursor: dragging ? 'grabbing' : 'default' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <g transform={`scale(${zoom})`}>
            {/* 边 */}
            {edges.map((edge, i) => {
              const a = simNodes.find((n) => n.id === edge.source)
              const b = simNodes.find((n) => n.id === edge.target)
              if (!a || !b) return null
              const isHighlighted = hovered === edge.source || hovered === edge.target
              return (
                <g key={i} opacity={hovered && !isHighlighted ? 0.15 : 0.7}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#94a3b8"
                    strokeWidth={isHighlighted ? 2 : 1}
                  />
                  {isHighlighted && showLabels && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 4}
                      textAnchor="middle"
                      className="fill-ink-700 dark:fill-ink-200"
                      style={{ fontSize: 9, fontWeight: 600 }}
                    >
                      {edge.type}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 节点 */}
            {simNodes.map((node) => {
              const isHovered = hovered === node.id
              return (
                <g
                  key={node.id}
                  onPointerDown={(e) => onPointerDown(node.id, e)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onNodeClick?.(nodes.find((n) => n.id === node.id)!)}
                  style={{ cursor: 'grab' }}
                >
                  {/* 阴影圈 */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.size + 4}
                    fill="none"
                    stroke={node.color}
                    strokeWidth={isHovered ? 2.5 : 1}
                    opacity={isHovered ? 0.6 : 0.2}
                  />
                  {/* 节点主体 */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.size}
                    fill={node.color}
                    opacity={0.85}
                  />
                  {/* 节点类型缩写 */}
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    className="fill-white font-bold"
                    style={{ fontSize: 10 }}
                  >
                    {node.type.slice(0, 3)}
                  </text>
                  {/* 节点标签 */}
                  {(showLabels || isHovered) && (
                    <text
                      x={node.x}
                      y={node.y + node.size + 14}
                      textAnchor="middle"
                      className="fill-ink-700 dark:fill-ink-200"
                      style={{ fontSize: 10, fontWeight: 500 }}
                    >
                      {node.label.length > 10 ? node.label.slice(0, 9) + '…' : node.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* 详情弹层 */}
        {hoveredNode && hoveredNodeData && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-3 left-3 right-3 p-3 rounded-lg bg-white/95 dark:bg-ink-900/95 backdrop-blur border border-ink-200/60 dark:border-ink-700/60 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: hoveredNode.color }}
              />
              <div className="text-sm font-semibold text-ink-900 dark:text-white truncate">
                {hoveredNodeData.label}
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 font-semibold ml-auto">
                {hoveredNodeData.type}
              </span>
            </div>
            {hoveredNodeData.summary && (
              <div className="text-[10px] text-ink-500 mt-1 line-clamp-2">
                {hoveredNodeData.summary}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* 图例 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
        {Object.entries(typeCount).map(([type, count]) => (
          <span
            key={type}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink-50 dark:bg-ink-900/50"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: NODE_COLORS[type] || NODE_COLORS.DEFAULT }}
            />
            <span className="text-ink-600 dark:text-ink-300">{type}</span>
            <span className="text-ink-400">×{count}</span>
          </span>
        ))}
        <span className="ml-auto text-ink-400">提示：拖拽节点、点击查看详情</span>
      </div>
    </div>
  )
}
