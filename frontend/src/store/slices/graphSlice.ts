/**
 * graphSlice — knowledge-graph + progress state + actions.
 *
 * One of the 4 typed slices composing the pipeline store (G8).
 * Owns: graphNodes, graphEdges, graphProgress, graphSnapshots,
 *       graphCapacity, plus all graph_* actions.
 *
 * Composition: every slice creator has shape
 *     (set, get) => Partial<PipelineState>
 * so the composite usePipelineStore can simply spread the four
 * partial objects into the initial state and into the actions dict.
 */
import type {
  GraphNodeData,
  GraphEdgeData,
  GraphProgress,
} from '../pipeline'
import { MAX_GRAPH_NODES } from '../pipeline'

export interface GraphSliceState {
  // 字段
  graphNodes: GraphNodeData[]
  graphEdges: GraphEdgeData[]
  graphProgress: GraphProgress
  graphSnapshots: Record<number, { nodes: GraphNodeData[]; edges: GraphEdgeData[] }>
  /** 驱逐环容量上限 (slider 入口) */
  graphCapacity: number

  // actions
  seedGraph: (nodes: GraphNodeData[], edges: GraphEdgeData[]) => void
  setGraphSnapshot: (nodes: GraphNodeData[], edges: GraphEdgeData[], progress?: GraphProgress) => void
  appendGraphNode: (node: GraphNodeData) => void
  appendGraphEdge: (edge: GraphEdgeData) => void
  setGraphProgress: (progress: GraphProgress) => void
  setGraphCapacity: (n: number) => void
  resetGraphStream: () => void
  snapshotGraphAtRound: (round: number) => void
}

/** Internal helper shared by seedGraph / setGraphSnapshot / setGraphCapacity. */
export function _applyEviction(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  cap: number,
): {
  acceptedNodes: GraphNodeData[]
  acceptedEdges: GraphEdgeData[]
  evicted: number
  droppedEdges: number
} {
  // 1. 过滤 nullish id 节点
  const validNodes = nodes.filter((n) => n.id != null && n.id !== '')

  // 2. 按 signal_density 降序排序, 截断到 cap
  let acceptedNodes = validNodes
  let evicted = 0
  if (validNodes.length > cap) {
    acceptedNodes = [...validNodes]
      .sort(
        (a, b) =>
          ((b as any).signal_density ?? 0.5) -
          ((a as any).signal_density ?? 0.5),
      )
      .slice(0, cap)
    evicted = validNodes.length - acceptedNodes.length
  }

  // 3. 构造 accepted id 集合
  const acceptedIds = new Set(acceptedNodes.map((n) => String(n.id)))

  // 4. filter edges: source AND target 都要在 acceptedIds
  const acceptedEdges = edges.filter((e) => {
    const src = (e as any).source
    const tgt = (e as any).target
    if (src == null || tgt == null || src === '' || tgt === '') return false
    return acceptedIds.has(String(src)) && acceptedIds.has(String(tgt))
  })
  const droppedEdges = edges.length - acceptedEdges.length

  return { acceptedNodes, acceptedEdges, evicted, droppedEdges }
}

export const MAX_GRAPH_SNAPSHOTS = 12

export type GraphSliceCreator = (
  set: (partial: any) => void,
  get: () => any,
) => GraphSliceState

export const graphSlice: GraphSliceCreator = (set, _get) => ({
  graphNodes: [],
  graphEdges: [],
  graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
  graphCapacity: MAX_GRAPH_NODES,
  graphSnapshots: {},

  seedGraph: (nodes, edges) => {
    set((s: any) => {
      const cap = s.graphCapacity ?? MAX_GRAPH_NODES
      const { acceptedNodes, acceptedEdges, evicted, droppedEdges } = _applyEviction(
        nodes,
        edges,
        cap,
      )
      return {
        graphNodes: acceptedNodes,
        graphEdges: acceptedEdges,
        graphProgress: {
          ...s.graphProgress,
          phase: 'completed',
          nodes: acceptedNodes.length,
          edges: acceptedEdges.length,
          evicted: ((s.graphProgress as any).evicted ?? 0) + evicted,
          dropped_edges: ((s.graphProgress as any).dropped_edges ?? 0) + droppedEdges,
        },
      }
    })
  },

  setGraphSnapshot: (nodes, edges, progress) => {
    set((s: any) => {
      const cap = s.graphCapacity ?? MAX_GRAPH_NODES
      const { acceptedNodes, acceptedEdges, evicted, droppedEdges } = _applyEviction(
        nodes,
        edges,
        cap,
      )
      return {
        graphNodes: acceptedNodes,
        graphEdges: acceptedEdges,
        graphProgress: {
          ...s.graphProgress,
          ...(progress ?? {}),
          evicted: ((s.graphProgress as any).evicted ?? 0) + evicted,
          dropped_edges: ((s.graphProgress as any).dropped_edges ?? 0) + droppedEdges,
          nodes: acceptedNodes.length,
        },
      }
    })
  },

  appendGraphNode: (node) => {
    if (node.id == null || node.id === '') return
    const id = String(node.id)
    set((s: any) => {
      if (s.graphNodes.some((n: GraphNodeData) => String(n.id) === id)) return s
      const incomingDensity = (node as any).signal_density ?? 0.5
      const cap = s.graphCapacity ?? MAX_GRAPH_NODES

      if (s.graphNodes.length < cap) {
        const next = [...s.graphNodes, node].sort(
          (a, b) => ((b as any).signal_density ?? 0.5) - ((a as any).signal_density ?? 0.5),
        )
        return {
          graphNodes: next,
          graphProgress: { ...s.graphProgress, nodes: next.length },
        }
      }

      // 已满, 找最低 density 节点
      let minIdx = 0
      let minDensity = (s.graphNodes[0] as any).signal_density ?? 0.5
      for (let i = 1; i < s.graphNodes.length; i++) {
        const d = (s.graphNodes[i] as any).signal_density ?? 0.5
        if (d < minDensity) {
          minDensity = d
          minIdx = i
        }
      }
      if (incomingDensity > minDensity) {
        const next = [...s.graphNodes]
        next[minIdx] = node
        next.sort(
          (a, b) => ((b as any).signal_density ?? 0.5) - ((a as any).signal_density ?? 0.5),
        )
        const evictedId = String((s.graphNodes[minIdx] as any).id)
        const keptEdges = s.graphEdges.filter(
          (e: GraphEdgeData) =>
            String((e as any).source) !== evictedId &&
            String((e as any).target) !== evictedId,
        )
        const droppedEdges = s.graphEdges.length - keptEdges.length
        return {
          graphNodes: next,
          graphEdges: keptEdges,
          graphProgress: {
            ...s.graphProgress,
            evicted: ((s.graphProgress as any).evicted ?? 0) + 1,
            dropped_edges: ((s.graphProgress as any).dropped_edges ?? 0) + droppedEdges,
            nodes: next.length,
          },
        }
      }
      return {
        graphProgress: {
          ...s.graphProgress,
          overflow: ((s.graphProgress as any).overflow ?? 0) + 1,
        },
      }
    })
  },

  appendGraphEdge: (edge) => {
    const src = (edge as any).source
    const tgt = (edge as any).target
    if (src == null || tgt == null || src === '' || tgt === '') return
    const id = String(edge.id ?? `${src}->${tgt}`)
    set((s: any) => {
      if (s.graphEdges.some((e: GraphEdgeData) =>
        String(e.id ?? `${e.source}->${e.target}`) === id,
      )) return s
      const hasSrc = s.graphNodes.some((n: GraphNodeData) => String(n.id) === String(src))
      const hasTgt = s.graphNodes.some((n: GraphNodeData) => String(n.id) === String(tgt))
      if (!hasSrc || !hasTgt) {
        return {
          graphProgress: {
            ...s.graphProgress,
            dropped_edges: ((s.graphProgress as any).dropped_edges ?? 0) + 1,
          },
        }
      }
      const next = [...s.graphEdges, edge]
      return { graphEdges: next, graphProgress: { ...s.graphProgress, edges: next.length } }
    })
  },

  setGraphProgress: (progress) => {
    set((s: any) => ({ graphProgress: { ...s.graphProgress, ...progress } }))
  },

  setGraphCapacity: (n) => {
    const cap = Math.max(50, Math.min(2000, Math.floor(n)))
    set((s: any) => {
      const { acceptedNodes, acceptedEdges, evicted, droppedEdges } = _applyEviction(
        s.graphNodes,
        s.graphEdges,
        cap,
      )
      return {
        graphCapacity: cap,
        graphNodes: acceptedNodes,
        graphEdges: acceptedEdges,
        graphProgress: {
          ...s.graphProgress,
          evicted: ((s.graphProgress as any).evicted ?? 0) + evicted,
          dropped_edges: ((s.graphProgress as any).dropped_edges ?? 0) + droppedEdges,
          nodes: acceptedNodes.length,
        },
      }
    })
  },

  resetGraphStream: () => {
    set({
      graphNodes: [],
      graphEdges: [],
      graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
      graphSnapshots: {},
    })
  },

  snapshotGraphAtRound: (round) => {
    set((s: any) => {
      if (s.graphSnapshots[round]) return s
      let next = {
        ...s.graphSnapshots,
        [round]: { nodes: [...s.graphNodes], edges: [...s.graphEdges] },
      }
      const keys = Object.keys(next).map(Number).sort((a, b) => a - b)
      while (keys.length > MAX_GRAPH_SNAPSHOTS) {
        const oldKey = keys.shift()!
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [oldKey]: _dropped, ...rest } = next
        next = rest
      }
      return { graphSnapshots: next }
    })
  },
})