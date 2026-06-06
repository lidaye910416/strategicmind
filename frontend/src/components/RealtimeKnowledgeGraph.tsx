/**
 * RealtimeKnowledgeGraph - MiroFish 风格的实时增长知识图谱。
 *
 * 数据源：
 *   1. SSE: /api/pipeline/<run_id>/events 中的 live_event { type: graph_progress }
 *   2. REST: /api/pipeline/<run_id>/graph-snapshot（启动时一次性拉全量）
 *
 * 动效：
 *   - 新节点：opacity 0→1 + scale 0.3→1（"破壳"）
 *   - 新边：stroke-dasharray 由 0→长度（"绘制"）
 *   - 已有节点/边保留位置（基于 ID 复用）
 *
 * 配色：12 种实体类型固定调色板（参考 MiroFish GraphPanel.vue）
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Network, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Loader2,
  Maximize2, Minimize2, X, Hash,
} from 'lucide-react'
import api from '../services/api'

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

interface GraphNode {
  id: string
  label: string
  type: string
  index: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  index: number
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  birth: number  // 0-1, 0=未出现, 1=已稳态
  isNew: boolean
}

interface SimEdge extends GraphEdge {
  drawProgress: number
  isNew: boolean
}

interface Props {
  runId?: string | null
  live?: boolean
  height?: number
  title?: string
  fallback?: { nodes: any[]; edges: any[] } | null
}

export default function RealtimeKnowledgeGraph({
  runId, live = true, height = 480, title = '实时知识图谱', fallback = null,
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
  const [building, setBuilding] = useState(false)
  const [stageLabel, setStageLabel] = useState<string>('等待图谱数据…')
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null)
  const [stats, setStats] = useState<{ nodeCount: number; edgeCount: number }>({
    nodeCount: 0, edgeCount: 0,
  })

  const W = 900
  const H = height

  // 启动 SSE
  useEffect(() => {
    if (!runId || !live) return
    const url = `/api/pipeline/${runId}/events`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'live_event' && data.event) {
          handleLiveEvent(data.event)
        } else if (data.current_stage === 'GRAPH_BUILDING') {
          setBuilding(true)
          setStageLabel('图谱构建中 · 节点持续涌现')
        } else if (data.current_stage && data.current_stage !== 'GRAPH_BUILDING') {
          setBuilding(false)
        }
      } catch {/* ignore */}
    }
    es.onerror = () => {/* EventSource auto-retry */}
    return () => es.close()
  }, [runId, live])

  // 启动时拉一次全量
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
        hydrateFromSnapshot(r.data)
      } catch {/* ignore */}
    })()
    return () => { cancelled = true }
  }, [runId])

  const handleLiveEvent = useCallback((evt: any) => {
    const t = evt?.type
    if (t === 'graph_progress') {
      setBuilding(evt.data?.phase !== 'completed')
      if (evt.data?.phase === 'completed') {
        setStageLabel('图谱构建完成')
      } else {
        setStageLabel(`图谱构建中 · 节点 ${evt.data?.nodes ?? 0} · 关系 ${evt.data?.edges ?? 0}`)
      }
      setNodes((prev) => growNodes(prev, evt.data?.nodes ?? prev.length))
      setEdges((prev) => growEdges(prev, evt.data?.edges ?? prev.length))
      setStats((s) => ({
        ...s,
        nodeCount: evt.data?.nodes ?? s.nodeCount,
        edgeCount: evt.data?.edges ?? s.edgeCount,
      }))
    }
  }, [])

  const hydrateFromSnapshot = (data: any) => {
    const rawNodes: GraphNode[] = data.nodes || []
    const rawEdges: GraphEdge[] = data.edges || []
    setNodes(seedNodes(rawNodes))
    setEdges(seedEdges(rawEdges))
    setStats({ nodeCount: rawNodes.length, edgeCount: rawEdges.length })
    if (data.stage === 'GRAPH_BUILDING') {
      setBuilding(true)
      setStageLabel('图谱构建中')
    } else {
      setBuilding(false)
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
    setStats({ nodeCount: mappedNodes.length, edgeCount: mappedEdges.length })
    setStageLabel('演示数据 · 启动推演后开始增长')
    setBuilding(false)
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
              const isHighlighted = hovered === edge.source || hovered === edge.target
              const dx = b.x - a.x, dy = b.y - a.y
              const len = Math.sqrt(dx*dx + dy*dy)
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
            })}

            {nodes.map((node) => {
              const isHighlighted = hovered === node.id
              const color = NODE_COLORS[node.type] || NODE_COLORS.DEFAULT
              const r = node.size * node.birth
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

function seedNodes(raw: GraphNode[]): SimNode[] {
  const cx = 450, cy = 240
  const n = raw.length
  return raw.map((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2
    const radius = 180 * (0.6 + ((i * 7) % 5) * 0.1)
    return {
      ...node,
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 30,
      vx: 0, vy: 0,
      color: NODE_COLORS[node.type] || NODE_COLORS.DEFAULT,
      size: node.type === 'PERSON' ? 16 : 12,
      birth: 0, isNew: true,
    }
  })
}

function seedEdges(raw: GraphEdge[]): SimEdge[] {
  return raw.map((e) => ({ ...e, drawProgress: 0, isNew: true }))
}

function growNodes(prev: SimNode[], target: number): SimNode[] {
  if (target <= prev.length) {
    return prev.map((n) => ({ ...n, isNew: false }))
  }
  const out = prev.map((n) => ({ ...n, isNew: false }))
  const cx = 450, cy = 240
  for (let i = prev.length; i < target; i++) {
    const angle = (i / target) * Math.PI * 2
    const radius = 60 + (i % 6) * 35
    out.push({
      id: `n${i}`,
      label: `Entity ${i + 1}`,
      type: ['COMPANY', 'PERSON', 'PRODUCT', 'BUSINESS', 'GOVERNMENT', 'REGULATION'][i % 6],
      index: i,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0, vy: 0,
      color: NODE_COLORS.DEFAULT,
      size: 12,
      birth: 0, isNew: true,
    })
  }
  return out
}

function growEdges(prev: SimEdge[], target: number): SimEdge[] {
  if (target <= prev.length) {
    return prev.map((e) => ({ ...e, isNew: false }))
  }
  const out = prev.map((e) => ({ ...e, isNew: false }))
  for (let i = prev.length; i < target; i++) {
    out.push({
      id: `e${i}`,
      source: `n${i % Math.max(1, prev.length || 1)}`,
      target: `n${(i * 7 + 1) % Math.max(1, prev.length || 1)}`,
      type: ['OWNS', 'MANAGES', 'INFLUENCES', 'DEPENDS_ON', 'REGULATED_BY'][i % 5],
      index: i,
      drawProgress: 0, isNew: true,
    })
  }
  return out
}
