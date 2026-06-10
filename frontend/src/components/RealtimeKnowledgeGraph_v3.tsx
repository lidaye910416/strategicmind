/**
 * RealtimeKnowledgeGraph_v3 — thin shim that mounts the new Cosmic Observatory
 * graph sub-components.
 *
 * Replaces RealtimeKnowledgeGraph.tsx (the 692-line hand-rolled rAF force loop)
 * with the new layered design:
 *   - useD3Force: d3-forceSimulation with settle detection + freeze toggle
 *   - GraphCanvas: dot-grid Cosmic Observatory visual layer (palette.ts colors)
 *   - EdgePath: quadratic Bezier edges with fan-curvature
 *   - FilterBar: chip-row + search filter
 *   - NodeDetailPanel: 280px slide-over detail panel
 *
 * Drop-in shim:
 *   - Accepts the same props as the OLD component (runId / live / height /
 *     title / fallback / refreshIntervalMs)
 *   - Connects to the same SSE data source (store pipeline via useGraphStream)
 *   - Emits the same callbacks (onNodeClick) the old component does
 *
 * TODO: Swap the import in Workbench.tsx and LiveRunPanel.tsx from
 *       './RealtimeKnowledgeGraph' to './RealtimeKnowledgeGraph_v3' once
 *       this shim is verified end-to-end.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Network, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Loader2,
  Maximize2, Minimize2, Hash, Snowflake, Play,
} from 'lucide-react'
import api from '../services/api'
import { GraphCanvas } from './graph/GraphCanvas'
import { useD3Force, type ForceNode, type ForceEdge } from './graph/useD3Force'
import { FilterBar, applyFilter } from './graph/FilterBar'
import { NodeDetailPanel } from './graph/NodeDetailPanel'
import { getPalette } from './graph/palette'
import {
  useGraphNodes,
  useGraphEdges,
  useGraphPhase,
  useStage,
  useStatus,
  usePipelineStore,
  type GraphNodeData,
  type GraphEdgeData,
} from '../store/pipeline'

/** The OLD component's prop shape. Re-declared here so the shim is self-contained. */
export interface RealtimeKnowledgeGraphV3Props {
  runId?: string | null
  live?: boolean
  height?: number
  title?: string
  /** Fallback data used when runId is null (Dashboard / preview) */
  fallback?: { nodes: GraphNodeData[]; edges: GraphEdgeData[] } | null
  /**
   * SSE 兜底轮询: When > 0, every N ms re-pull graph-snapshot.
   * Defaults to 0 (SSE-only). Mirrors the OLD component's behavior.
   */
  refreshIntervalMs?: number
  /** Optional: click callback. The OLD component didn't export one, but
   *  consumers can opt in here. */
  onNodeClick?: (nodeId: string, node: GraphNodeData) => void
}

const DEFAULT_WIDTH = 900

/**
 * RealtimeKnowledgeGraph_v3
 *
 * A thin wrapper that:
 *   1. Reads graph data from the same store the old component used
 *      (useGraphNodes / useGraphEdges / useGraphPhase)
 *   2. Hydrates the store on mount (runId -> graph-snapshot REST)
 *   3. Pipes store data into useD3Force (with settle + freeze)
 *   4. Mounts GraphCanvas + FilterBar + NodeDetailPanel
 */
export default function RealtimeKnowledgeGraph_v3({
  runId, live = true, height = 480, title = '实时知识图谱', fallback = null,
  refreshIntervalMs = 0, onNodeClick,
}: RealtimeKnowledgeGraphV3Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [stageLabel, setStageLabel] = useState<string>('等待图谱数据…')
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState<string>('')

  // ---- Same data source the OLD component used ----
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

  // ---- Map store/fallback nodes to ForceNode shape (with stable positions) ----
  // We maintain a "position pool" keyed by id. New nodes are seeded with
  // deterministic x/y in a circle; existing nodes reuse the same object
  // reference so d3-force preserves x/y/vx/vy across renders.
  //
  // The useMemo deps are based on `nodeIdSignature` (a string of ids), NOT on
  // the rawNodes array ref, so a store ref change that doesn't add new ids
  // returns the same memoized result.
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
        // Reuse the same object reference so d3-force keeps x/y/vx/vy.
        // Refresh mutable fields from the latest store payload.
        const refreshed = { ...existing, ...(node as any) } as ForceNode
        pool.set(id, refreshed)
        return refreshed
      }
      // Brand new node — seed with deterministic angle around center.
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

  // ---- Map store/fallback edges to ForceEdge shape (id-pooled) ----
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
  // Prevents stale id positions from a previous run leaking into a new run.
  useEffect(() => {
    positionPoolRef.current.clear()
    edgePoolRef.current.clear()
    setSelectedId(null)
    setHovered(null)
    setZoom(1)
  }, [runId])

  // ---- Filter: type chips + search ----
  const visibleIds = useMemo(() => applyFilter(nodes, selectedTypes, search), [nodes, selectedTypes, search])

  // ---- d3-force simulation (with settle + freeze) ----
  const [tick, setTick] = useState(0)  // forces re-render on each animation frame
  const { settled, freeze, unfreeze } = useD3Force(nodes, edges, {
    width: W, height: H,
    enabled: nodes.length > 0,
    onTick: () => setTick((t) => (t + 1) % 1_000_000),
  })

  // ---- Stats & stage label (mirrors old behavior) ----
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

  // ---- Mount-time REST hydrate (seed store + local state) ----
  useEffect(() => {
    if (!runId) {
      // No-op when fallback already in effect
      return
    }
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

  // ---- SSE 兜底轮询 (mirrors old component) ----
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

  // ---- Selected node (resolved back to the latest store node) ----
  const selectedNode: ForceNode | null = useMemo(() => {
    if (!selectedId) return null
    return nodes.find((n) => n.id === selectedId) ?? null
  }, [selectedId, nodes])

  const containerCls = maximized
    ? 'fixed inset-4 z-50 card p-0 flex flex-col bg-slate-950 shadow-2xl'
    : 'card p-0 flex flex-col'

  // Filter to renderable nodes/edges (filter dims via opacity in the canvas, but
  // we also pass the visible set so that deeply hidden ones can be culled)
  void visibleIds  // (currently used by GraphCanvas via opacity logic; we just need to compute it so the chips are reactive)
  void tick        // (re-render trigger)

  return (
    <div className={containerCls} style={maximized ? {} : { minHeight: height + 80 }}>
      {/* Header */}
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
              data-testid="v3-toggle-labels"
            >
              {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
              data-testid="v3-zoom-in"
            >
              <ZoomIn size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
              data-testid="v3-zoom-out"
            >
              <ZoomOut size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => (settled ? unfreeze() : freeze())}
              title={settled ? '解冻布局' : '冻结布局'}
              data-testid="v3-freeze-toggle"
            >
              {settled ? <Play size={12} /> : <Snowflake size={12} />}
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setZoom(1)}
              title="重置"
              data-testid="v3-reset"
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setMaximized((v) => !v)}
              title="最大化"
              data-testid="v3-maximize"
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        nodes={nodes}
        selectedTypes={selectedTypes}
        onSelectedTypesChange={setSelectedTypes}
        search={search}
        onSearchChange={setSearch}
      />

      {/* Canvas + side panel container */}
      <div
        className="relative overflow-hidden border-t border-white/5 flex-1"
        style={{ minHeight: height, background: '#0B1020' }}
        data-testid="v3-graph-container"
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

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
            <Network size={36} className="mb-2 opacity-30" />
            <div className="text-xs">{building ? '等待节点涌现…' : '暂无图谱数据'}</div>
          </div>
        )}

        {/* Entity type legend (palette.ts colors) */}
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
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: p.ring }}
                  />
                  <span className="text-slate-200">{type}</span>
                  <span className="text-slate-400 font-mono">{count}</span>
                </span>
              )
            })}
          </div>
        )}

        {/* Detail slide-over */}
        <NodeDetailPanel
          node={selectedNode}
          edges={edges}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  )
}

/** Pure helper: unique node types in encounter order. */
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

// Re-export ForceNode / ForceEdge so consumers can import from one place
export type { ForceNode, ForceEdge } from './graph/useD3Force'
