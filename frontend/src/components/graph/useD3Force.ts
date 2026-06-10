/**
 * useD3Force — d3-forceSimulation hook with settle detection and freeze toggle.
 *
 * Why d3-force instead of the hand-rolled rAF loop:
 *   - d3-force has measured, predictable convergence (alphaDecay)
 *   - We get proper many-body + link forces, not O(n²) repulsion in component code
 *   - 500 nodes settle in <= 2s on a mid-tier laptop
 *
 * Spec (T3.1):
 *   - Replace hand-rolled rAF loop with d3-forceSimulation
 *   - Wrap tick in requestAnimationFrame (so React doesn't block)
 *   - `freezeLayout=true` -> simulation.alphaTarget(0) (layout paused)
 *   - Settling detection: alpha < 0.005 for 60 consecutive frames -> stop rAF
 *   - On new node add, restart simulation
 *   - 500 nodes settle <= 2s; after settle rAF stops; freezeLayout prevents re-settle
 *
 * Usage:
 *   const { simulationRef, restart, freeze, settled, alphaRef } = useD3Force({
 *     nodes, edges, width, height, onTick: () => requestRender(),
 *   })
 *
 * Refs are used so the simulation is NOT recreated on every render.
 */
import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'

/** A node with d3 simulation fields + our render fields. */
export interface ForceNode extends SimulationNodeDatum {
  id: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  [k: string]: unknown
}

export interface ForceEdge extends SimulationLinkDatum<ForceNode> {
  id: string
  source: string | ForceNode
  target: string | ForceNode
  [k: string]: unknown
}

export interface UseD3ForceOptions {
  /** Layout area width in viewBox units (e.g. 900) */
  width: number
  /** Layout area height in viewBox units (e.g. 480) */
  height: number
  /**
   * When true, simulation.alphaTarget(0) — layout is frozen.
   * Use for: user wants to keep current positions; new nodes don't re-settle.
   */
  freezeLayout?: boolean
  /** Charge strength (default -180). Negative = repel. */
  chargeStrength?: number
  /** Link distance target in px (default 70). */
  linkDistance?: number
  /** Collide radius padding (default 18). */
  collidePadding?: number
  /** When true, simulation will run (default true). */
  enabled?: boolean
  /**
   * Tick callback. d3 will call this on every internal step; we wrap it
   * in requestAnimationFrame internally before invoking onTick, so onTick
   * fires once per animation frame at most.
   */
  onTick?: () => void
}

export interface UseD3ForceResult {
  /** The d3 simulation instance — stable across renders. */
  simulationRef: React.MutableRefObject<Simulation<ForceNode, ForceEdge> | null>
  /** Reheat the simulation (e.g. when new nodes arrive). */
  restart: () => void
  /** Pause the simulation immediately. */
  freeze: () => void
  /** Resume the simulation (alpha + alphaTarget). */
  unfreeze: () => void
  /** Whether layout has settled (alpha<0.005 for 60 frames). */
  settled: boolean
  /** Current alpha (for diagnostics). */
  alphaRef: React.MutableRefObject<number>
}

/**
 * useD3Force — manages a d3-forceSimulation in a stable ref.
 *
 * IMPORTANT: The simulation is created ONCE on mount. Nodes/edges are mutated
 * via simulation.nodes()/simulation.force('link').links() in effects when the
 * references change. d3 mutates the node objects in-place to add x/y/vx/vy.
 */
export function useD3Force(
  nodes: ForceNode[],
  edges: ForceEdge[],
  options: UseD3ForceOptions,
): UseD3ForceResult {
  const {
    width, height, freezeLayout = false,
    chargeStrength = -180, linkDistance = 70, collidePadding = 18,
    enabled = true, onTick,
  } = options

  const simulationRef = useRef<Simulation<ForceNode, ForceEdge> | null>(null)
  const alphaRef = useRef<number>(1)
  const lowAlphaFramesRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const stopRequestedRef = useRef<boolean>(false)
  const onTickRef = useRef<(() => void) | null>(null)
  if (onTick) onTickRef.current = onTick

  const [settled, setSettled] = useState(false)

  // -- Create simulation exactly once (refs, not state) --
  useEffect(() => {
    if (!enabled) return
    const sim = forceSimulation<ForceNode, ForceEdge>([])
      .force('charge', forceManyBody<ForceNode>().strength(chargeStrength))
      .force('link', forceLink<ForceNode, ForceEdge>([]).id((d) => (d as ForceNode).id).distance(linkDistance))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<ForceNode>().radius(collidePadding))
      .alphaDecay(0.05)  // settle a bit faster than default 0.0228
      .velocityDecay(0.4)
      .stop()  // we'll start manually

    simulationRef.current = sim
    setSettled(false)
    lowAlphaFramesRef.current = 0
    stopRequestedRef.current = false

    return () => {
      sim.stop()
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      simulationRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // -- Stable id signatures for the effect dep array --
  // We key off the *set* of ids, not the array reference, so a re-render with
  // a new `nodes` ref but identical ids doesn't re-run the effect and restart
  // the simulation.
  const nodeIdKey = useMemo(
    () => nodes.map((n) => n.id).join('|'),
    [nodes],
  )
  const edgeIdKey = useMemo(
    () => edges.map((e) => e.id).join('|'),
    [edges],
  )

  // -- Set of ids we already know about (for diff) --
  const prevNodeIdsRef = useRef<Set<string>>(new Set())

  // -- Sync nodes/edges into the simulation when they change --
  useEffect(() => {
    const sim = simulationRef.current
    if (!sim || !enabled) return

    const newNodeIds = new Set(nodes.map((n) => n.id))
    const addedIds: string[] = []
    for (const n of nodes) {
      if (!prevNodeIdsRef.current.has(n.id)) addedIds.push(n.id)
    }

    // Seed x/y for any genuinely new nodes (or all nodes on first mount) so
    // they don't stack at 0,0. Only mutate the new ones.
    for (const n of nodes) {
      if (
        addedIds.length > 0 &&
        (addedIds.includes(n.id) || prevNodeIdsRef.current.size === 0) &&
        (typeof n.x !== 'number' || typeof n.y !== 'number')
      ) {
        n.x = width / 2 + (Math.random() - 0.5) * 80
        n.y = height / 2 + (Math.random() - 0.5) * 80
      }
    }

    // Always sync the full nodes/edges arrays — d3 will preserve x/y/vx/vy
    // on objects it already knows about.
    sim.nodes(nodes as ForceNode[])
    const linkForce = sim.force('link') as
      | ReturnType<typeof forceLink<ForceNode, ForceEdge>>
      | undefined
    if (linkForce) linkForce.links(edges as ForceEdge[])

    // Only restart + reset settle detector when the id set actually changed.
    if (addedIds.length > 0) {
      sim.alpha(0.6).restart()
      setSettled(false)
      lowAlphaFramesRef.current = 0
      stopRequestedRef.current = false
    }

    prevNodeIdsRef.current = newNodeIds
  }, [nodeIdKey, edgeIdKey, width, height, enabled])

  // -- rAF tick driver + settle detection --
  useEffect(() => {
    if (!enabled) return
    const sim = simulationRef.current
    if (!sim) return

    let running = true
    const loop = () => {
      if (!running) return
      if (stopRequestedRef.current) {
        rafRef.current = null
        return
      }
      // Single tick
      sim.tick()
      alphaRef.current = sim.alpha()
      // Settle detection: alpha < 0.005 for 60 consecutive frames
      if (alphaRef.current < 0.005) {
        lowAlphaFramesRef.current += 1
        if (lowAlphaFramesRef.current >= 60) {
          setSettled(true)
          stopRequestedRef.current = true
          rafRef.current = null
          // Notify one last tick so render sees final positions
          if (onTickRef.current) onTickRef.current()
          return
        }
      } else {
        lowAlphaFramesRef.current = 0
      }
      // Notify render
      if (onTickRef.current) onTickRef.current()
      rafRef.current = requestAnimationFrame(loop)
    }
    // Start
    setSettled(false)
    lowAlphaFramesRef.current = 0
    stopRequestedRef.current = false
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      running = false
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled])  // intentionally only on mount/unmount; restart() handles node changes

  // -- freezeLayout toggle --
  useEffect(() => {
    const sim = simulationRef.current
    if (!sim) return
    if (freezeLayout) {
      sim.alphaTarget(0)
      sim.stop()
      stopRequestedRef.current = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    } else {
      sim.alphaTarget(null as unknown as number)  // d3's "no target"
      sim.alpha(0.3).restart()
      stopRequestedRef.current = false
      setSettled(false)
      lowAlphaFramesRef.current = 0
    }
  }, [freezeLayout])

  const restart = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    stopRequestedRef.current = false
    setSettled(false)
    lowAlphaFramesRef.current = 0
    sim.alpha(0.6).restart()
  }, [])

  const freeze = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    sim.alphaTarget(0)
    sim.stop()
    stopRequestedRef.current = true
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const unfreeze = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    sim.alphaTarget(null as unknown as number)
    sim.alpha(0.3).restart()
    stopRequestedRef.current = false
    setSettled(false)
    lowAlphaFramesRef.current = 0
  }, [])

  return {
    simulationRef,
    restart,
    freeze,
    unfreeze,
    settled,
    alphaRef,
  }
}
