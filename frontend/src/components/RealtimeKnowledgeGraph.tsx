/**
 * RealtimeKnowledgeGraph - 实时增长知识图谱。
 *
 * 数据源（P3-B 修复后）：
 *   1. store 内 graphNodes / graphEdges（来自 SSE live_event 增量 + graph-snapshot 补底）
 *      - 通过 useGraphStream(runId) 统一获取
 *   2. 不再自开 EventSource；事件分发统一由 store 的 _openSSE 完成
 *
 * 动效：
 *   - 新节点：opacity 0→1 + scale 0→1（"破壳"）
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
import { useGraphStream } from '../store/hooks/useGraphStream'
import {
  buildGraphPositions,
  stepForceLayout,
  stepAppearance,
  nodeColor,
  nodeSize,
  type PositionedNode,
  type PositionedEdge,
} from '../utils/graphLayout'
import type { GraphNodeData, GraphEdgeData } from '../store/pipeline'

interface Props {
  runId?: string | null
  live?: boolean
  height?: number
  title?: string
  fallback?: { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null
}

const W = 900

export default function RealtimeKnowledgeGraph({
  runId, live: _live = true, height = 480, title = '实时知识图谱', fallback = null,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { nodes: rawNodes, edges: rawEdges, progress, source, totalNodes, totalEdges } = useGraphStream(
    runId,
    { fallback: fallback as { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null },
  )
  const [renderedNodes, setRenderedNodes] = useState<PositionedNode[]>([])
  const [renderedEdges, setRenderedEdges] = useState<PositionedEdge[]>([])
  const posCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [stageLabel, setStageLabel] = useState<string>('等待图谱数据…')
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null)
  const [tick, setTick] = useState(0)

  // 每次 rawNodes/edges 变化 → 重建位置（保留已有节点的 x/y）
  useEffect(() => {
    if (source === 'empty') {
      setRenderedNodes([])
      setRenderedEdges([])
      return
    }
    const { nodes, edges } = buildGraphPositions(
      rawNodes,
      rawEdges,
      posCacheRef.current,
      W,
      height,
    )
    setRenderedNodes(nodes)
    setRenderedEdges(edges)
    // 同步 posCache
    const next = new Map<string, { x: number; y: number }>()
    for (const n of nodes) next.set(n.id, { x: n.x, y: n.y })
    posCacheRef.current = next
  }, [rawNodes, rawEdges, source, height])

  // 更新 stageLabel
  useEffect(() => {
    if (source === 'empty') {
      setStageLabel('等待图谱数据…')
      return
    }
    if (progress?.phase === 'completed') {
      setStageLabel('图谱构建完成 · 持续接收新增实体')
    } else if (progress?.phase === 'growing' || progress?.phase === 'started') {
      setStageLabel(`图谱构建中 · 节点 ${progress.nodes} · 关系 ${progress.edges}`)
    } else {
      setStageLabel(totalNodes > 0 ? `图谱就绪 · ${totalNodes} 节点 / ${totalEdges} 关系` : '图谱构建中…')
    }
  }, [progress, source, totalNodes, totalEdges])

  // 力模拟（仅节点数变化时跑一次稳定布局）
  useEffect(() => {
    if (renderedNodes.length === 0) return
    let raf: number
    let iter = 0
    const maxIter = 200
    const step = () => {
      setRenderedNodes((prev) => {
        if (prev.length === 0) return prev
        const next = stepForceLayout(prev, renderedEdges, dragging, W, height, 1)
        // 同步 posCache
        for (const n of next) posCacheRef.current.set(n.id, { x: n.x, y: n.y })
        return next
      })
      iter++
      if (iter < maxIter) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedNodes.length, renderedEdges.length, dragging, tick])

  // 破壳动效
  useEffect(() => {
    if (renderedNodes.length === 0) return
    let raf: number
    const step = () => {
      let done = true
      setRenderedNodes((ns) => {
        setRenderedEdges((es) => {
          const r = stepAppearance(ns, es)
          done = r.done
          return r.edges
        })
        return ns
      })
      if (!done) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [renderedNodes.length, renderedEdges.length])

  const onPointerDown = useCallback((id: string, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * height
    setRenderedNodes((prev) => prev.map((n) => (n.id === dragging ? { ...n, x, y, vx: 0, vy: 0 } : n)))
    posCacheRef.current.set(dragging, { x, y })
  }, [dragging, height])
  const onPointerUp = useCallback(() => setDragging(null), [])

  const typeCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const n of renderedNodes) m[n.type] = (m[n.type] || 0) + 1
    return m
  }, [renderedNodes])

  const containerCls = maximized
    ? 'fixed inset-4 z-50 card p-4 flex flex-col bg-white dark:bg-ink-900 shadow-2xl'
    : 'card p-4 flex flex-col'

  const building = progress?.phase === 'started' || progress?.phase === 'growing'

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
            {totalNodes} 节点 / {totalEdges} 边
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
          viewBox={`0 0 ${W} ${height}`}
          className="w-full h-full"
          style={{ cursor: dragging ? 'grabbing' : 'default' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <defs>
            {Array.from(new Set(['DEFAULT', ...renderedNodes.map((n) => n.type)])).map((type) => {
              const color = nodeColor(type)
              return (
                <radialGradient key={type} id={`grad-${type}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={color} stopOpacity="1" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.6" />
                </radialGradient>
              )
            })}
          </defs>
          <g transform={`translate(${W/2} ${height/2}) scale(${zoom}) translate(${-W/2} ${-height/2})`}>
            {renderedEdges.map((edge) => {
              const a = renderedNodes.find((n) => n.id === edge.source)
              const b = renderedNodes.find((n) => n.id === edge.target)
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

            {renderedNodes.map((node) => {
              const isHighlighted = hovered === node.id
              const color = nodeColor(node.type)
              const r = nodeSize(node.type, node.influence) * node.birth
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
                    fill={`url(#grad-${node.type})`}
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

        {renderedNodes.length === 0 && (
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

        {renderedNodes.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5 pointer-events-none">
            {Object.entries(typeCount).slice(0, 8).map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/80 dark:bg-ink-900/80 backdrop-blur-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: nodeColor(type) }} />
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
                style={{ background: nodeColor(selectedNode.type) }}
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
              {selectedNode.source && (
                <span>来源 · {selectedNode.source} · </span>
              )}
              {selectedNode.round != null && <span>R{selectedNode.round} · </span>}
              影响权重 {selectedNode.influence.toFixed(2)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
