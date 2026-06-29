/**
 * RealtimeGraph — 工作台风格的实时增长知识图谱 (canonical merged implementation).
 *
 * 数据源（FE3 P3-C：统一 EventSource 入口）：
 *   1. Store selector: useGraphNodes() / useGraphEdges() / useGraphPhase()
 *   2. REST: /api/pipeline/<run_id>/graph-snapshot（启动时一次性拉全量，seedGraph 写入 store）
 *   3. Store 派生 status / currentStage（决定 building 状态）
 *
 * Agent 3A v2 修复:
 *   - d3-force simulation 替代 v1 手写 rAF O(n²) 循环（useD3Force hook）
 *   - 包含 v1 提取的 edgeHelpers (renderEdge, countSelfLoops, renderSelfLoopBadge)
 *   - N2 fix: force effect 解绑 polling tick, simulation 持久化, nodes/edges 变化
 *     只触发 simulation.nodes() + alpha(0.3).restart(), 不再每 30s 重建 O(n²)
 *   - N1: 配合 store 的 setGraphSnapshot cap, 整体上限 = graphCapacity
 *
 * 动效：
 *   - 新节点：opacity 0→1 + scale 0.3→1（"破壳"）
 *   - 新边：stroke-dasharray 由 0→长度（"绘制"）
 *   - 已有节点/边保留位置（基于 ID 复用）
 *
 * 配色：12 种实体类型固定调色板
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  Network, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Loader2,
  Maximize2, Minimize2, Hash, Snowflake, Play,
} from 'lucide-react'
import api from '../../services/api'
import { useD3Force, type ForceNode, type ForceEdge } from './useD3Force'
import { FilterBar, applyFilter } from './FilterBar'
import { NodeDetailPanel } from './NodeDetailPanel'
import { GraphCanvas } from './GraphCanvas'
import { getPalette } from './palette'
import {
  useGraphNodes,
  useGraphEdges,
  useGraphPhase,
  useStage,
  useStatus,
  usePipelineStore,
  type GraphNodeData,
  type GraphEdgeData,
} from '../../store/pipeline'
import { renderEdge, countSelfLoops, renderSelfLoopBadge, type SimNode, type SimEdge } from './edgeHelpers'

const DEFAULT_WIDTH = 900

/** Props the consumers use to drop-in replace RealtimeKnowledgeGraph. */
export interface RealtimeGraphProps {
  runId?: string | null
  live?: boolean
  height?: number
  title?: string
  /** Fallback data when runId is null (Dashboard / preview) */
  fallback?: { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null
  /** SSE fallback polling: when > 0, every N ms re-pull graph-snapshot. */
  refreshIntervalMs?: number
  onNodeClick?: (nodeId: string, node: GraphNodeData) => void
}

/**
 * RealtimeGraph — merged canonical implementation (v3 d3-force + v1 edgeHelpers + N2 fix).
 */
export default function RealtimeGraph({
  runId, live = true, height = 480, title = '实时知识图谱', fallback = null,
  refreshIntervalMs = 0, onNodeClick,
}: RealtimeGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [stageLabel, setStageLabel] = useState<string>('等待图谱数据…')
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState<string>('')

  // ---- Same data source the v3 component used ----
  const storeGraphNodes = useGraphNodes()
  const storeGraphEdges = useGraphEdges()
  const graphPhase = useGraphPhase()
  const currentStage = useStage()
  const status = useStatus()
  const seedGraphAction = usePipelineStore((s) => s.seedGraph)

  const building = graphPhase === 'building' || currentStage === 'GRAPH_BUILDING'
  const W = DEFAULT_WIDTH
  const H = height

  // ---- Resolve current data: store -> fallback -> empty ----
  const rawNodes: GraphNodeData[] = useMemo(() => {
    if (storeGraphNodes.length > 0) return storeGraphNodes
    if (fallback) return fallback.nodes
    return []
  }, [storeGraphNodes, fallback])

  const rawEdges: GraphEdgeData[] = useMemo(() => {
    if (storeGraphEdges.length > 0) return storeGraphEdges
    if (fallback) return fallback.edges
    return []
  }, [storeGraphEdges, fallback])

  // ---- Position pool keyed by id ----
  const positionPoolRef = useRef<Map<string, ForceNode>>(new Map())
  const edgePoolRef = useRef<Map<string, ForceEdge>>(new Map())

  const nodeIdSignature = useMemo(
    () => rawNodes.map((n) => String(n.id)).join('|'),
    [rawNodes],
  )
  const edgeIdSignature = useMemo(
    () => rawEdges.map((e) => e.id ?? `${e.source}->${e.target}`).join('|'),
    [rawEdges],
  )

  const nodes: ForceNode[] = useMemo(() => {
    const pool = positionPoolRef.current
    const cx = W / 2
    const cy = H / 2
    const n = rawNodes.length
    return rawNodes.map((node, i) => {
      const id = String(node.id)
      const existing = pool.get(id)
      if (existing) {
        const refreshed = { ...existing, ...(node as any) } as ForceNode
        pool.set(id, refreshed)
        return refreshed
      }
      const angle = n > 0 ? (i / n) * Math.PI * 2 - Math.PI / 2 : 0
      const radius = 180 * (0.6 + ((i * 7) % 5) * 0.1)
      const fresh: ForceNode = {
        id,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        ...(node as any),
      } as ForceNode
      pool.set(id, fresh)
      return fresh
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdSignature, W, H])

  const edges: ForceEdge[] = useMemo(() => {
    const pool = edgePoolRef.current
    return rawEdges.map((e, i) => {
      const id = e.id ?? `${e.source}->${e.target}-${i}`
      const existing = pool.get(id)
      if (existing) {
        const refreshed = { ...existing, ...(e as any) } as ForceEdge
        pool.set(id, refreshed)
        return refreshed
      }
      const fresh: ForceEdge = {
        id,
        source: e.source,
        target: e.target,
        ...(e as any),
      } as ForceEdge
      pool.set(id, fresh)
      return fresh
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeIdSignature])

  // ---- Reset position pool on runId change ----
  useEffect(() => {
    positionPoolRef.current.clear()
    edgePoolRef.current.clear()
    setSelectedId(null)
    setHovered(null)
    setZoom(1)
  }, [runId])

  // ---- Filter ----
  const visibleIds = useMemo(() => applyFilter(nodes, selectedTypes, search), [nodes, selectedTypes, search])

  // ---- d3-force simulation (with settle + freeze) ----
  // N2 fix: useD3Force 内部 simulation 持久化, polling tick 不再 cancel+rebuild 300 iter O(n²)
  const [tick, setTick] = useState(0)
  const { settled, freeze, unfreeze } = useD3Force(nodes, edges, {
    width: W, height: H,
    enabled: nodes.length > 0,
    onTick: () => setTick((t) => (t + 1) % 1_000_000),
  })

  // ---- Stats & stage label ----
  useEffect(() => {
    if (graphPhase === 'completed') {
      setStageLabel('图谱构建完成')
    } else if (rawNodes.length > 0 || rawEdges.length > 0) {
      setStageLabel(`图谱构建中 · 节点 ${rawNodes.length} · 关系 ${rawEdges.length}`)
    } else if (fallback) {
      setStageLabel('演示数据 · 启动推演后开始增长')
    }
  }, [rawNodes.length, rawEdges.length, graphPhase, fallback])

  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setStageLabel(rawNodes.length > 0 ? '图谱就绪' : '暂无图谱数据')
    }
  }, [status, rawNodes.length])

  // ---- Fallback hydrate when runId=null: seed store so other consumers ----
  // ---- (e.g. NetworkPanel reading useGraphNodes()) see fallback data ----
  // ---- F8 fix: previously fallback was only consumed locally via useMemo, ----
  // ---- leaving the global store empty when runId is null. ----
  useEffect(() => {
    // Only seed from fallback when there's no live run (runId = null/undefined).
    if (runId) return
    if (!fallback) return
    // Don't re-seed if the store already has data (idempotent across remounts
    // and avoids clobbering real SSE data on subsequent runId transitions).
    const currentNodes = usePipelineStore.getState().graphNodes
    if (currentNodes.length > 0) return
    seedGraphAction(fallback.nodes, fallback.edges)
  }, [runId, fallback, seedGraphAction])

  // ---- Mount-time REST hydrate ----
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/pipeline/${runId}/graph-snapshot`)
        if (cancelled) return
        const data = r.data
        const rawNodesFromApi: GraphNodeData[] = data.nodes || []
        const rawEdgesFromApi: GraphEdgeData[] = data.edges || []
        seedGraphAction(rawNodesFromApi, rawEdgesFromApi)
      } catch {
        /* SSE will catch up */
      }
    })()
    return () => { cancelled = true }
  }, [runId, seedGraphAction])

  // ---- SSE 兜底轮询 ----
  const seedGraphRef = useRef(seedGraphAction)
  useEffect(() => { seedGraphRef.current = seedGraphAction }, [seedGraphAction])

  useEffect(() => {
    if (!runId) return
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return
    let cancelled = false
    const id = setInterval(() => {
      if (cancelled) return
      ;(async () => {
        try {
          const r = await api.get(`/pipeline/${runId}/graph-snapshot`)
          if (cancelled) return
          const data = r.data
          seedGraphRef.current(data.nodes || [], data.edges || [])
        } catch {
          /* swallow polling errors */
        }
      })()
    }, refreshIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [runId, refreshIntervalMs])

  // ---- Click handler ----
  const handleClick = useCallback((id: string) => {
    setSelectedId(id)
    if (onNodeClick) {
      const node = rawNodes.find((n) => n.id === id)
      if (node) onNodeClick(id, node)
    }
  }, [onNodeClick, rawNodes])

  // ---- Selected node ----
  const selectedNode: ForceNode | null = useMemo(() => {
    if (!selectedId) return null
    return nodes.find((n) => n.id === selectedId) ?? null
  }, [selectedId, nodes])

  const containerCls = maximized
    ? 'fixed inset-4 z-50 card p-0 flex flex-col bg-slate-950 shadow-2xl'
    : 'card p-0 flex flex-col'

  void visibleIds
  void tick

  return (
    <div className={containerCls} style={maximized ? {} : { minHeight: height + 80 }}>
      <div className="flex items-center justify-between p-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20 inline-flex items-center justify-center text-fuchsia-400">
            <Network size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              {title}
            </div>
            <div className="text-xs text-slate-200 truncate flex items-center gap-1.5">
              {building && <Loader2 size={10} className="animate-spin text-fuchsia-400" />}
              <span className="truncate">{stageLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-mono text-slate-500 hidden sm:flex items-center gap-1">
            <Hash size={10} />
            {rawNodes.length} 节点 / {rawEdges.length} 边
          </span>
          <div className="flex gap-1">
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setShowLabels((v) => !v)}
              title="标签"
              data-testid="realtime-graph-toggle-labels"
            >
              {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
              data-testid="realtime-graph-zoom-in"
            >
              <ZoomIn size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
              data-testid="realtime-graph-zoom-out"
            >
              <ZoomOut size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => (settled ? unfreeze() : freeze())}
              title={settled ? '解冻布局' : '冻结布局'}
              data-testid="realtime-graph-freeze-toggle"
            >
              {settled ? <Play size={12} /> : <Snowflake size={12} />}
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom(1)}
              title="重置"
              data-testid="realtime-graph-reset"
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setMaximized((v) => !v)}
              title="最大化"
              data-testid="realtime-graph-maximize"
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </div>
        </div>
      </div>

      <FilterBar
        nodes={nodes}
        selectedTypes={selectedTypes}
        onSelectedTypesChange={setSelectedTypes}
        search={search}
        onSearchChange={setSearch}
      />

      <div
        className="relative overflow-hidden border-t border-white/5 flex-1"
        style={{ minHeight: height, background: '#0B1020' }}
        data-testid="realtime-graph-container"
      >
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          width={W}
          height={H}
          hovered={hovered}
          selected={selectedId}
          showLabels={showLabels}
          zoom={zoom}
          building={building}
          onPointerEnter={(id) => setHovered(id)}
          onPointerLeave={() => setHovered(null)}
          onClick={handleClick}
        />

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
            <Network size={36} className="mb-2 opacity-30" />
            <div className="text-xs">{building ? '等待节点涌现…' : '暂无图谱数据'}</div>
          </div>
        )}

        {nodes.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5 pointer-events-none">
            {uniqueTypes(rawNodes).slice(0, 8).map((type) => {
              const p = getPalette(type)
              const count = rawNodes.filter((n) => (n.type ?? 'DEFAULT') === type).length
              return (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-900/80 backdrop-blur-sm"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.ring }} />
                  <span className="text-slate-200">{type}</span>
                  <span className="text-slate-400 font-mono">{count}</span>
                </span>
              )
            })}
          </div>
        )}

        <NodeDetailPanel
          node={selectedNode}
          edges={edges}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  )
}

function uniqueTypes(nodes: GraphNodeData[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of nodes) {
    const t = (n.type ?? 'DEFAULT') as string
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

// Re-export pure helpers for testability / advanced consumers
export { renderEdge, countSelfLoops, renderSelfLoopBadge }
export type { SimNode, SimEdge }
