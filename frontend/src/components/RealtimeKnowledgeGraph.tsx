/**
 * RealtimeKnowledgeGraph - MiroFish 风格的实时增长知识图谱。
 *
 * 数据源（FE3 P3-C：统一 EventSource 入口）：
 *   1. Store selector: useGraphNodes() / useGraphEdges() / useGraphPhase()
 *      （由 store 内的唯一 EventSource 解析 graph_progress 后写入，组件不再自建 SSE）
 *   2. REST: /api/pipeline/<run_id>/graph-snapshot（启动时一次性拉全量，seedGraph 写入 store）
 *   3. Store 派生 status / currentStage（决定 building 状态）
 *
 * 动效：
 *   - 新节点：opacity 0→1 + scale 0.3→1（"破壳"）
 *   - 新边：stroke-dasharray 由 0→长度（"绘制"）
 *   - 已有节点/边保留位置（基于 ID 复用）
 *
 * 配色：12 种实体类型固定调色板（参考 MiroFish GraphPanel.vue）
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Network, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Loader2,
  Maximize2, Minimize2, X, Hash,
} from 'lucide-react'
import api from '../services/api'
import {
  useGraphNodes,
  useGraphEdges,
  useGraphPhase,
  useStage,
  useStatus,
  usePipelineStore,
  type GraphNodeLive,
  type GraphEdgeLive,
} from '../store/pipeline'

// 12 色调色板（与 MiroFish GraphPanel 保持一致）
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

interface GraphNode extends GraphNodeLive {}
interface GraphEdge extends GraphEdgeLive {}

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  birth: number  // 0-1, 0=未出现, 1=已稳态
  isNew: boolean
  // 覆盖 optional 字段为必填（buildGraphPositions / seedNodes 一定设置）
  label: string
  type: string
}

export interface SimEdge extends GraphEdge {
  drawProgress: number
  isNew: boolean
  type: string
}

interface Props {
  runId?: string | null
  live?: boolean
  height?: number
  title?: string
  fallback?: { nodes: any[]; edges: any[] } | null
  /**
   * MiroFish 旧版 SSE 兜底轮询: 当 SSE 断线时, 每 N ms 重拉一次 graph-snapshot
   * 重新 seedGraph 进 store. 默认 0 = 关闭.
   * - 0: 不轮询 (仅靠 store SSE 增量推送)
   * - > 0: 每 N ms 调一次 /api/pipeline/<runId>/graph-snapshot
   */
  refreshIntervalMs?: number
}

export default function RealtimeKnowledgeGraph({
  runId, live = true, height = 480, title = '实时知识图谱', fallback = null,
  refreshIntervalMs = 0,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [edges, setEdges] = useState<SimEdge[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [tick, setTick] = useState(0)
  const [maximized, setMaximized] = useState(false)
  const [stageLabel, setStageLabel] = useState<string>('等待图谱数据…')
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null)

  // ---- FE3 P3-C：store selector 替代自建 SSE ----
  const storeGraphNodes = useGraphNodes()
  const storeGraphEdges = useGraphEdges()
  const graphPhase = useGraphPhase()
  const currentStage = useStage()
  const status = useStatus()
  const seedGraphAction = usePipelineStore((s) => s.seedGraph)

  // building flag 派生自 store phase + currentStage
  const building = graphPhase === 'building' || currentStage === 'GRAPH_BUILDING'
  const stats = { nodeCount: storeGraphNodes.length, edgeCount: storeGraphEdges.length }

  const W = 900
  const H = height

  // 把 store 实时数据同步进本地 SimNode/SimEdge 状态（保留动画）
  useEffect(() => {
    if (!live) return
    setNodes((prev) => syncNodesToStore(prev, storeGraphNodes))
    setEdges((prev) => syncEdgesToStore(prev, storeGraphEdges))
    if (graphPhase === 'completed') {
      setStageLabel('图谱构建完成')
    } else if (storeGraphNodes.length > 0 || storeGraphEdges.length > 0) {
      setStageLabel(`图谱构建中 · 节点 ${storeGraphNodes.length} · 关系 ${storeGraphEdges.length}`)
    }
  }, [storeGraphNodes, storeGraphEdges, graphPhase, live])

  // 终态/未运行时不显示"构建中"
  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setStageLabel(storeGraphNodes.length > 0 ? '图谱就绪' : '暂无图谱数据')
    }
  }, [status, storeGraphNodes.length])

  // 启动时拉一次全量（seed 进 store + 本地）
  useEffect(() => {
    if (!runId) {
      if (fallback) hydrateFromFallback(fallback)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/pipeline/${runId}/graph-snapshot`)
        if (cancelled) return
        const data = r.data
        const rawNodes: GraphNode[] = data.nodes || []
        const rawEdges: GraphEdge[] = data.edges || []
        // seed 进 store（供其他组件订阅）
        seedGraphAction(rawNodes, rawEdges)
        hydrateFromSnapshot(data)
      } catch {/* ignore */}
    })()
    return () => { cancelled = true }
  }, [runId, seedGraphAction])

  // ---- MiroFish SSE 兜底轮询: refreshIntervalMs > 0 时, 周期性重新 seedGraph ----
  // 适用场景: SSE 断线/重连中, 仍想拿到最新图谱. 不阻塞正常 SSE 增量推送.
  // - 只在 runId 存在 + 间隔 > 0 时启动
  // - 卸载/间隔变化时严格 clearInterval
  // - 用 ref 缓存最新 seedGraphAction, 避免 effect 频繁重起
  const seedGraphRef = useRef(seedGraphAction)
  useEffect(() => { seedGraphRef.current = seedGraphAction }, [seedGraphAction])

  useEffect(() => {
    if (!runId) return
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      ;(async () => {
        try {
          const r = await api.get(`/pipeline/${runId}/graph-snapshot`)
          if (cancelled) return
          const data = r.data
          const rawNodes: GraphNode[] = data.nodes || []
          const rawEdges: GraphEdge[] = data.edges || []
          // store: 让其他订阅者看到最新图谱
          seedGraphRef.current(rawNodes, rawEdges)
          // 本地: 重 seed SimNode 列表 (保留位置由 syncNodesToStore 处理, 这里直接重置)
          setNodes(seedNodes(rawNodes))
          setEdges(seedEdges(rawEdges))
          setStageLabel(rawNodes.length > 0 ? '图谱就绪' : '等待图谱数据…')
        } catch {/* ignore polling errors silently */}
      })()
    }
    const id = setInterval(tick, refreshIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [runId, refreshIntervalMs])

  const hydrateFromSnapshot = (data: any) => {
    const rawNodes: GraphNode[] = data.nodes || []
    const rawEdges: GraphEdge[] = data.edges || []
    setNodes(seedNodes(rawNodes))
    setEdges(seedEdges(rawEdges))
    if (data.stage === 'GRAPH_BUILDING') {
      setStageLabel('图谱构建中')
    } else {
      setStageLabel(rawNodes.length > 0 ? '图谱就绪' : '等待图谱数据…')
    }
  }

  const hydrateFromFallback = (data: { nodes: any[]; edges: any[] }) => {
    const mappedNodes: GraphNode[] = (data.nodes || []).map((n: any, i: number) => ({
      id: n.id, label: n.label || n.name || '未命名',
      type: n.type || n.entity_type || 'DEFAULT', index: i,
    }))
    const mappedEdges: GraphEdge[] = (data.edges || []).map((e: any, i: number) => ({
      id: `e${i}`, source: e.source, target: e.target,
      type: e.type || 'RELATED_TO', index: i,
    }))
    setNodes(seedNodes(mappedNodes))
    setEdges(seedEdges(mappedEdges))
    setStageLabel('演示数据 · 启动推演后开始增长')
  }

  // 力模拟
  useEffect(() => {
    if (nodes.length === 0) return
    let raf: number
    let iter = 0
    const maxIter = 300
    const step = () => {
      setNodes((prev) => {
        const next = prev.map((n) => ({ ...n }))
        const cx = W / 2, cy = H / 2
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const dx = next[j].x - next[i].x
            const dy = next[j].y - next[i].y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = 8000 / (dist * dist)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            if (next[i].id !== dragging) { next[i].vx -= fx; next[i].vy -= fy }
            if (next[j].id !== dragging) { next[j].vx += fx; next[j].vy += fy }
          }
        }
        for (const edge of edges) {
          const a = next.find((n) => n.id === edge.source)
          const b = next.find((n) => n.id === edge.target)
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const target = 140
          const diff = (dist - target) * 0.018
          const fx = (dx / dist) * diff
          const fy = (dy / dist) * diff
          if (a.id !== dragging) { a.vx += fx; a.vy += fy }
          if (b.id !== dragging) { b.vx -= fx; b.vy -= fy }
        }
        for (const n of next) {
          n.vx += (cx - n.x) * 0.004
          n.vy += (cy - n.y) * 0.004
        }
        for (const n of next) {
          if (n.id === dragging) continue
          n.vx *= 0.78
          n.vy *= 0.78
          n.x += n.vx
          n.y += n.vy
          n.x = Math.max(35, Math.min(W - 35, n.x))
          n.y = Math.max(35, Math.min(H - 35, n.y))
        }
        return next
      })
      iter++
      if (iter < maxIter) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [edges.length, dragging, height, tick, nodes.length > 0])

  // "破壳" 动效
  useEffect(() => {
    if (nodes.length === 0) return
    let raf: number
    const step = () => {
      setNodes((prev) => prev.map((n) => {
        if (n.birth < 1) return { ...n, birth: Math.min(1, n.birth + 0.06) }
        return n
      }))
      setEdges((prev) => prev.map((e) => {
        if (e.drawProgress < 1) return { ...e, drawProgress: Math.min(1, e.drawProgress + 0.05) }
        return e
      }))
      if (nodes.some((n) => n.birth < 1) || edges.some((e) => e.drawProgress < 1)) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [nodes.length, edges.length])

  const onPointerDown = (id: string, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H
    setNodes((prev) => prev.map((n) => (n.id === dragging ? { ...n, x, y, vx: 0, vy: 0 } : n)))
  }
  const onPointerUp = () => setDragging(null)

  const typeCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const n of nodes) m[n.type] = (m[n.type] || 0) + 1
    return m
  }, [nodes])

  const containerCls = maximized
    ? 'fixed inset-4 z-50 card p-4 flex flex-col bg-white dark:bg-ink-900 shadow-2xl'
    : 'card p-4 flex flex-col'

  return (
    <div className={containerCls} style={maximized ? {} : { minHeight: height + 80 }}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
            <Network size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {title}
            </div>
            <div className="text-xs text-ink-700 dark:text-ink-300 truncate flex items-center gap-1.5">
              {building && <Loader2 size={10} className="animate-spin text-brand-500" />}
              <span className="truncate">{stageLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-mono text-ink-500 hidden sm:flex items-center gap-1">
            <Hash size={10} />
            {stats.nodeCount} 节点 / {stats.edgeCount} 边
          </span>
          <div className="flex gap-1">
            <button className="btn-ghost h-7 w-7 p-0" onClick={() => setShowLabels((v) => !v)} title="标签">
              {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button className="btn-ghost h-7 w-7 p-0" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}>
              <ZoomIn size={12} />
            </button>
            <button className="btn-ghost h-7 w-7 p-0" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
              <ZoomOut size={12} />
            </button>
            <button className="btn-ghost h-7 w-7 p-0" onClick={() => setTick((t) => t + 1)} title="重布局">
              <RotateCcw size={12} />
            </button>
            <button className="btn-ghost h-7 w-7 p-0" onClick={() => setMaximized((v) => !v)} title="最大化">
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </div>
        </div>
      </div>

      <div
        className="relative rounded-xl bg-gradient-to-br from-ink-50/30 to-ink-100/30 dark:from-ink-900/30 dark:to-ink-800/30 overflow-hidden border border-ink-200/40 flex-1"
        style={{ minHeight: height }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full"
          style={{ cursor: dragging ? 'grabbing' : 'default' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <defs>
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <radialGradient key={type} id={`grad-${type}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={color} stopOpacity="1" />
                <stop offset="100%" stopColor={color} stopOpacity="0.6" />
              </radialGradient>
            ))}
          </defs>
          <g transform={`translate(${W/2} ${H/2}) scale(${zoom}) translate(${-W/2} ${-H/2})`}>
            {edges.map((edge) => {
              const a = nodes.find((n) => n.id === edge.source)
              const b = nodes.find((n) => n.id === edge.target)
              if (!a || !b) return null
              return renderEdge(edge, a, b, hovered, showLabels)
            })}

            {nodes.map((node) => {
              const isHighlighted = hovered === node.id
              const color = NODE_COLORS[node.type] || NODE_COLORS.DEFAULT
              const r = node.size * node.birth
              // self-loop 数 (MiroFish v-bind badge)
              const selfLoopCount = countSelfLoops(edges, node.id)
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  style={{ opacity: node.birth, cursor: 'pointer' }}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onPointerDown={(e) => onPointerDown(node.id, e)}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(node) }}
                >
                  {node.isNew && node.birth < 0.9 && (
                    <circle r={r + 8} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5 * (1 - node.birth)} />
                  )}
                  <circle
                    r={r}
                    fill={`url(#grad-${node.type in NODE_COLORS ? node.type : 'DEFAULT'})`}
                    stroke={isHighlighted ? '#E91E63' : '#fff'}
                    strokeWidth={isHighlighted ? 3 : 2}
                  />
                  {/* mirofish-tier: self-loop 数 badge (节点右上角) */}
                  {renderSelfLoopBadge(r, selfLoopCount)}
                  {showLabels && (
                    <text
                      x={r + 4} y={4}
                      className="fill-ink-800 dark:fill-ink-100"
                      style={{
                        fontSize: 10, fontWeight: 500, pointerEvents: 'none',
                        textShadow: '0 0 3px #fff, 0 0 3px #fff',
                      }}
                    >
                      {node.label.length > 8 ? node.label.slice(0, 8) + '…' : node.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-400">
            <Network size={36} className="mb-2 opacity-30" />
            <div className="text-xs">{building ? '等待节点涌现…' : '暂无图谱数据'}</div>
          </div>
        )}

        <AnimatePresence>
          {building && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/95 text-white text-[11px] font-semibold shadow-soft"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              实时更新中…
            </motion.div>
          )}
        </AnimatePresence>

        {nodes.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5 pointer-events-none">
            {Object.entries(typeCount).slice(0, 8).map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/80 dark:bg-ink-900/80 backdrop-blur-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: NODE_COLORS[type] || NODE_COLORS.DEFAULT }} />
                <span className="text-ink-700 dark:text-ink-200">{type}</span>
                <span className="text-ink-500 font-mono">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedNode && !maximized && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="absolute top-12 right-4 w-64 card p-3 shadow-soft z-10"
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-white"
                style={{ background: NODE_COLORS[selectedNode.type] || NODE_COLORS.DEFAULT }}
              >
                {selectedNode.type}
              </span>
              <button onClick={() => setSelectedNode(null)} className="text-ink-400 hover:text-ink-700">
                <X size={14} />
              </button>
            </div>
            <div className="text-sm font-semibold text-ink-900 dark:text-white">{selectedNode.label}</div>
            <div className="text-[10px] text-ink-500 font-mono mt-1 break-all">ID: {selectedNode.id}</div>
            <div className="text-[10px] text-ink-500 mt-1">
              Index #{selectedNode.index} · 影响权重 {selectedNode.size.toFixed(0)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * 纯函数: 渲染单条边 (MiroFish v-bind 范式)
 *  - self-loop (source === target) → 节点上方圆环
 *  - 普通边 → 直线
 * 导出供测试直接调用, 避免触发 rAF force-simulation
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
      <g key={edge.id} opacity={edge.drawProgress}>
        <circle
          cx={a.x} cy={a.y - (a.size + r + 2)}
          r={r}
          fill="none"
          stroke={isHighlighted ? '#E91E63' : '#94A3B8'}
          strokeWidth={isHighlighted ? 2 : 1.2}
          strokeOpacity={0.85}
          strokeDasharray={edge.isNew ? `${2 * Math.PI * r * edge.drawProgress} ${2 * Math.PI * r}` : undefined}
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
    <g key={edge.id} opacity={edge.drawProgress}>
      <line
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={isHighlighted ? '#E91E63' : '#94A3B8'}
        strokeWidth={isHighlighted ? 2 : 1.2}
        strokeOpacity={hovered && !isHighlighted ? 0.12 : 0.65}
        strokeDasharray={edge.isNew ? `${len * edge.drawProgress} ${len}` : undefined}
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

/** 纯函数: 计算某节点的自环数 (MiroFish v-bind badge) */
export function countSelfLoops(edges: { source: string; target: string }[], nodeId: string): number {
  return edges.filter((e) => e.source === nodeId && e.target === nodeId).length
}

/** 纯函数: 渲染自环数 badge (节点右上角, count=0 返回 null) */
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

function seedNodes(raw: GraphNode[]): SimNode[] {
  const cx = 450, cy = 240
  const n = raw.length
  return raw.map((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2
    const radius = 180 * (0.6 + ((i * 7) % 5) * 0.1)
    const nodeType = node.type ?? 'UNKNOWN'
    return {
      ...node,
      label: node.label ?? node.name ?? node.id,
      type: nodeType,
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 30,
      vx: 0, vy: 0,
      color: NODE_COLORS[nodeType] || NODE_COLORS.DEFAULT,
      size: nodeType === 'PERSON' ? 16 : 12,
      birth: 0, isNew: true,
    }
  })
}

function seedEdges(raw: GraphEdge[]): SimEdge[] {
  return raw.map((e) => ({ ...e, type: e.type ?? 'RELATED_TO', drawProgress: 0, isNew: true }))
}

/** 把 store 节点同步进本地 SimNode（已有节点保留位置/动画；新增节点随机散开） */
function syncNodesToStore(prev: SimNode[], next: GraphNodeLive[]): SimNode[] {
  if (next.length === 0) return prev.length > 0 ? [] : prev
  if (next.length < prev.length) {
    // 收缩：截断
    return prev.slice(0, next.length)
  }
  if (next.length === prev.length) {
    // 数量未变：仅更新 type/label（保位置）
    return prev.map((n, i) => {
      const sn = next[i]
      if (!sn) return n
      if (n.id === sn.id && n.type === sn.type && n.label === sn.label) return n
      return { ...n, type: sn.type ?? 'UNKNOWN', label: sn.label ?? sn.id }
    })
  }
  // 增长：保留旧的，追加新的（随机散布，等力模拟拉回）
  const cx = 450, cy = 240
  const out = prev.map((n) => ({ ...n, isNew: false }))
  for (let i = prev.length; i < next.length; i++) {
    const sn = next[i]
    const nodeType = sn.type ?? 'UNKNOWN'
    const nodeLabel = sn.label ?? sn.id
    const angle = (i / Math.max(1, next.length)) * Math.PI * 2
    const radius = 60 + (i % 6) * 35
    out.push({
      id: sn.id,
      label: nodeLabel,
      type: nodeType,
      index: sn.index,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0, vy: 0,
      color: NODE_COLORS[nodeType] || NODE_COLORS.DEFAULT,
      size: nodeType === 'PERSON' ? 16 : 12,
      birth: 0, isNew: true,
    })
  }
  return out
}

function syncEdgesToStore(prev: SimEdge[], next: GraphEdgeLive[]): SimEdge[] {
  if (next.length === 0) return prev.length > 0 ? [] : prev
  if (next.length < prev.length) return prev.slice(0, next.length)
  if (next.length === prev.length) {
    return prev.map((e, i) => {
      const se = next[i]
      if (!se) return e
      if (e.id === se.id && e.source === se.source && e.target === se.target) return e
      return { ...e, source: se.source, target: se.target, type: se.type ?? 'RELATED_TO' }
    })
  }
  const out = prev.map((e) => ({ ...e, isNew: false }))
  for (let i = prev.length; i < next.length; i++) {
    const se = next[i]
    out.push({
      id: se.id, source: se.source, target: se.target,
      type: se.type ?? 'RELATED_TO', index: se.index,
      drawProgress: 0, isNew: true,
    })
  }
  return out
}
