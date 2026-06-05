/**
 * 部门关系图 - 力导向图（D3-style）
 *
 * 参考 MiroFish GraphPanel.vue 1423 行的设计，
 * 展示公司内部部门节点、决策权大小、部门间关系（协作/冲突）。
 *
 * 实现：原生 SVG + 力模拟（不依赖 d3）
 *   - 力导向布局：库仑斥力 + 弹簧连接 + 中心引力
 *   - 节点颜色基于部门类型
 *   - 节点大小基于决策权
 *   - 边颜色基于关系（绿=协作，红=冲突）
 *   - 支持拖拽节点
 *   - 点击节点显示详情
 *
 * Implements: US-211 部门关系可视化
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import type { CompanyContext, DepartmentAgent } from '../services/companyApi'

interface Props {
  company: CompanyContext
  height?: number
}

// 节点颜色（基于部门类型）
const DEPT_COLORS: Record<string, string> = {
  PRODUCT: '#3b82f6',     // blue
  SALES: '#f59e0b',       // amber
  TECH: '#8b5cf6',        // violet
  FINANCE: '#10b981',     // emerald
  HR: '#ec4899',          // pink
  LEGAL: '#64748b',       // slate
  OPERATIONS: '#06b6d4',  // cyan
  STRATEGY: '#f43f5e',    // rose
  MARKETING: '#f97316',   // orange
  CUSTOMER_SUCCESS: '#22c55e', // green
}

interface Node {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  dept: DepartmentAgent
  color: string
}

interface Edge {
  source: string
  target: string
  weight: number  // -1 to 1
  color: string
}

export default function DepartmentGraph({ company, height = 480 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tick, setTick] = useState(0)

  // 初始化节点和边
  useEffect(() => {
    if (!company) return
    const w = 800
    const h = height
    const cx = w / 2
    const cy = h / 2
    const n = company.departments.length
    const radius = Math.min(w, h) * 0.32

    const initialNodes: Node[] = company.departments.map((dept, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      return {
        id: dept.agent_id,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        dept,
        color: DEPT_COLORS[dept.department_type || ''] || '#94a3b8',
      }
    })

    // 部门间关系 → 边
    const initialEdges: Edge[] = []
    const seen = new Set<string>()
    for (const dept of company.departments) {
      for (const [otherId, weight] of Object.entries(dept.dept_relationships || {})) {
        const key = [dept.agent_id, otherId].sort().join('-')
        if (seen.has(key)) continue
        seen.add(key)
        const w = Number(weight)
        initialEdges.push({
          source: dept.agent_id,
          target: otherId,
          weight: w,
          color: w > 0.1 ? '#10b981' : w < -0.1 ? '#f43f5e' : '#94a3b8',
        })
      }
    }

    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [company, height])

  // 力模拟（每帧迭代）
  useEffect(() => {
    if (nodes.length === 0) return
    let raf: number
    let iter = 0
    const maxIter = 300

    const step = () => {
      setNodes((prev) => {
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
            const force = 6000 / (dist * dist)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            if (next[i].id !== dragging) {
              next[i].vx -= fx
              next[i].vy -= fy
            }
            if (next[j].id !== dragging) {
              next[j].vx += fx
              next[j].vy += fy
            }
          }
        }

        // 弹簧连接（有边的节点相互吸引）
        for (const edge of edges) {
          const a = next.find((n) => n.id === edge.source)
          const b = next.find((n) => n.id === edge.target)
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const targetDist = 180 - edge.weight * 50  // 协作拉近，对抗推远
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
          // 边界约束
          n.x = Math.max(40, Math.min(w - 40, n.x))
          n.y = Math.max(40, Math.min(h - 40, n.y))
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
    setDragging(id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 800
    const y = ((e.clientY - rect.top) / rect.height) * height
    setNodes((prev) =>
      prev.map((n) => (n.id === dragging ? { ...n, x, y, vx: 0, vy: 0 } : n))
    )
  }

  const onPointerUp = () => {
    setDragging(null)
  }

  // 节点大小基于决策权
  const nodeRadius = (dept: DepartmentAgent) => 14 + (dept.decision_power || 0.5) * 18

  const hoveredNode = hovered ? nodes.find((n) => n.id === hovered) : null

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
            <Users size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              部门关系图
            </div>
            <div className="text-xs text-ink-700 dark:text-ink-300">
              节点大小 = 决策权 · 边色 = 协作/冲突
            </div>
          </div>
        </div>
        <div className="flex gap-1">
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
            title="重置"
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
              const a = nodes.find((n) => n.id === edge.source)
              const b = nodes.find((n) => n.id === edge.target)
              if (!a || !b) return null
              const isHighlighted = hovered === edge.source || hovered === edge.target
              return (
                <g key={i} opacity={hovered && !isHighlighted ? 0.2 : 1}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={edge.color}
                    strokeWidth={Math.abs(edge.weight) * 3 + 1}
                    strokeDasharray={edge.weight > 0 ? '0' : '4 4'}
                    opacity={0.7}
                  />
                  {/* 边标签（数值） */}
                  {Math.abs(edge.weight) > 0.2 && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 4}
                      textAnchor="middle"
                      className="text-[9px] fill-ink-500"
                    >
                      {edge.weight > 0 ? '+' : ''}{edge.weight.toFixed(2)}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 节点 */}
            {nodes.map((node) => {
              const r = nodeRadius(node.dept)
              const isHovered = hovered === node.id
              return (
                <g
                  key={node.id}
                  onPointerDown={(e) => onPointerDown(node.id, e)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'grab' }}
                >
                  {/* 阴影圈 */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 4}
                    fill="none"
                    stroke={node.color}
                    strokeWidth={isHovered ? 3 : 1}
                    opacity={isHovered ? 0.6 : 0.2}
                  />
                  {/* 节点主体 */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill={node.color}
                    opacity={0.85}
                  />
                  {/* 部门类型缩写 */}
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    className="fill-white font-bold"
                    style={{ fontSize: r > 22 ? 11 : 9 }}
                  >
                    {(node.dept.department_type || '?').slice(0, 3)}
                  </text>
                  {/* 决策权数值 */}
                  <text
                    x={node.x}
                    y={node.y + r + 14}
                    textAnchor="middle"
                    className="fill-ink-700 dark:fill-ink-200"
                    style={{ fontSize: 10, fontWeight: 600 }}
                  >
                    {((node.dept.decision_power || 0.5) * 100).toFixed(0)}
                  </text>
                  {/* 部门名（悬浮时显示） */}
                  {isHovered && (
                    <text
                      x={node.x}
                      y={node.y - r - 6}
                      textAnchor="middle"
                      className="fill-ink-900 dark:fill-white"
                      style={{ fontSize: 11, fontWeight: 600 }}
                    >
                      {node.dept.name}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* 详情弹层 */}
        {hoveredNode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-3 left-3 right-3 p-3 rounded-lg bg-white/95 dark:bg-ink-900/95 backdrop-blur border border-ink-200/60 dark:border-ink-700/60 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-ink-900 dark:text-white">
                  {hoveredNode.dept.name}
                </div>
                <div className="text-[10px] text-ink-500">
                  {hoveredNode.dept.department_name_cn} · 决策权 {(hoveredNode.dept.decision_power || 0.5).toFixed(2)}
                </div>
              </div>
              <div className="text-[10px] text-ink-500">
                {hoveredNode.dept.action_repertoire?.length || 0} 个动作
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 图例 */}
      <div className="mt-3 flex items-center gap-3 text-[10px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="w-4 h-0.5 bg-emerald-500" /> 协作
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-0.5 bg-rose-500" style={{ borderTop: '1px dashed' }} /> 冲突
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-ink-400" /> 部门节点（大小=决策权）
        </span>
        <span className="ml-auto">提示：可拖拽节点</span>
      </div>
    </div>
  )
}
