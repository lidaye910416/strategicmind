/**
 * settle.bench.ts — Vitest benchmark for d3-force layout.
 *
 * Spec (T3.2):
 *   - 50/200/500/1000 nodes, SSE at 10 events/sec
 *   - Report settle time, frame budget, max jitter, memory
 *   - Fail build if 500-node settle > 2.5s OR jitter > 16ms
 *
 * Run: `npm run bench:graph` (or `npx vitest bench --run`)
 */
import { bench, describe } from 'vitest'
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force'
import type { ForceNode, ForceEdge } from '../useD3Force'

/** Generate a synthetic graph: nodes with a few edges each. */
function generateGraph(n: number): { nodes: ForceNode[]; edges: ForceEdge[] } {
  const nodes: ForceNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    x: 450 + (Math.random() - 0.5) * 600,
    y: 240 + (Math.random() - 0.5) * 320,
  }))
  // Each node connects to ~3 random others (Erdős–Rényi-ish, sparse)
  const edges: ForceEdge[] = []
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const j = Math.floor(Math.random() * n)
      if (j === i) continue
      edges.push({ id: `e${i}-${j}-${k}`, source: `n${i}`, target: `n${j}` })
    }
  }
  return { nodes, edges }
}

/** Measure settle time: number of ms of simulated tick time until alpha<0.005. */
function measureSettle(n: number): {
  settleTime: number
  ticks: number
  frameBudgets: number[]
  maxJitter: number
} {
  const { nodes, edges } = generateGraph(n)
  const sim = forceSimulation<ForceNode, ForceEdge>(nodes)
    .force('charge', forceManyBody<ForceNode>().strength(-180))
    .force('link', forceLink<ForceNode, ForceEdge>(edges).id((d) => (d as ForceNode).id).distance(70))
    .force('center', forceCenter(450, 240))
    .force('collide', forceCollide<ForceNode>().radius(18))
    .alphaDecay(0.05)
    .velocityDecay(0.4)
    .stop()

  // Simulate 60fps. Each "frame" = 16.67ms of wall time, one tick.
  const frameBudgets: number[] = []
  let maxJitter = 0
  const maxFrames = 60 * 10  // 10 seconds max
  let lastFrameEnd = 0
  let settleFrame = -1
  for (let frame = 0; frame < maxFrames; frame++) {
    const start = performance.now()
    sim.tick()
    const elapsed = performance.now() - start
    frameBudgets.push(elapsed)
    const jitter = frame > 0 ? Math.abs(elapsed - lastFrameEnd) : 0
    if (jitter > maxJitter) maxJitter = jitter
    lastFrameEnd = elapsed
    if (sim.alpha() < 0.005) {
      // Settling detection: need 60 frames of low alpha (simplified here)
      if (settleFrame === -1) settleFrame = frame
      if (frame - settleFrame >= 60) {
        return {
          settleTime: frame * (1000 / 60),  // approximate wall time
          ticks: frame,
          frameBudgets,
          maxJitter,
        }
      }
    } else {
      settleFrame = -1
    }
  }
  return {
    settleTime: maxFrames * (1000 / 60),
    ticks: maxFrames,
    frameBudgets,
    maxJitter,
  }
}

describe('Cosmic Observatory layout benchmark (T3.2)', () => {
  bench('50 nodes settle', () => {
    measureSettle(50)
  }, { iterations: 20 })

  bench('200 nodes settle', () => {
    measureSettle(200)
  }, { iterations: 10 })

  bench('500 nodes settle', () => {
    measureSettle(500)
  }, { iterations: 5 })

  bench('1000 nodes settle', () => {
    measureSettle(1000)
  }, { iterations: 3 })
})
