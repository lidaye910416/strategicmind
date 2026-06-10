/**
 * useD3Force.test.tsx — Hook tests for d3-force layout.
 *
 * Spec (T3.1):
 *   - 500 nodes settle <= 2s
 *   - After settle, rAF loop stops (settled=true)
 *   - freezeLayout=true prevents re-settle when new nodes arrive
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useD3Force, type ForceNode, type ForceEdge } from '../useD3Force'

function makeGraph(n: number): { nodes: ForceNode[]; edges: ForceEdge[] } {
  const nodes: ForceNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`, x: 450, y: 240,
  }))
  const edges: ForceEdge[] = []
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const j = (i + k + 1) % n
      edges.push({ id: `e${i}-${j}`, source: `n${i}`, target: `n${j}` })
    }
  }
  return { nodes, edges }
}

describe('useD3Force (T3.1)', () => {
  it('creates a simulation with the given nodes/edges', () => {
    const { nodes, edges } = makeGraph(10)
    const { result } = renderHook(() =>
      useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
    )
    const sim = result.current.simulationRef.current
    expect(sim).toBeTruthy()
    expect(sim?.nodes().length).toBe(10)
  })

  it('nodes get position hints when added (no stack at 0,0)', () => {
    const { nodes, edges } = makeGraph(5)
    // Remove x/y from nodes
    for (const n of nodes) { delete n.x; delete n.y }
    renderHook(() =>
      useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
    )
    // After the nodes/edges sync effect runs, all nodes should have numeric x/y
    for (const n of nodes) {
      expect(typeof n.x).toBe('number')
      expect(typeof n.y).toBe('number')
    }
  })

  it('restart() re-energizes the simulation', () => {
    const { nodes, edges } = makeGraph(20)
    const { result } = renderHook(() =>
      useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
    )
    const sim = result.current.simulationRef.current!
    sim.alpha(0.01)  // simulate settled
    act(() => {
      result.current.restart()
    })
    expect(sim.alpha()).toBeGreaterThan(0.01)
  })

  it('freeze() sets alphaTarget(0); unfreeze() resumes and re-energizes', () => {
    const { nodes, edges } = makeGraph(20)
    const { result } = renderHook(() =>
      useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
    )
    const sim = result.current.simulationRef.current!
    // Settle
    sim.alpha(0.01)
    act(() => {
      result.current.freeze()
    })
    expect(sim.alphaTarget()).toBe(0)
    act(() => {
      result.current.unfreeze()
    })
    // After unfreeze, alpha should be re-energized (> 0.01)
    expect(sim.alpha()).toBeGreaterThan(0.01)
  })

  it('does not crash with empty nodes', () => {
    const { result } = renderHook(() =>
      useD3Force([], [], { width: 900, height: 480, enabled: false }),
    )
    // No sim when disabled
    expect(result.current.simulationRef.current).toBeNull()
  })

  it('500 nodes settle: alpha drops below initial value', async () => {
    const { nodes, edges } = makeGraph(500)
    const { result } = renderHook(() =>
      useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
    )
    // Drive ticks manually to verify convergence happens
    const sim = result.current.simulationRef.current!
    expect(sim.alpha()).toBeGreaterThan(0)
    for (let i = 0; i < 300; i++) sim.tick()
    // After 300 ticks at alphaDecay=0.05, alpha should be tiny
    expect(sim.alpha()).toBeLessThan(0.01)
  })

  it('does NOT restart simulation when nodes ref changes but id set is identical', () => {
    const { nodes: n1, edges: e1 } = makeGraph(10)
    const { result, rerender } = renderHook(
      ({ nodes, edges }) => useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
      { initialProps: { nodes: n1, edges: e1 } },
    )
    const sim = result.current.simulationRef.current!
    // Pin alpha to a low value to simulate settled state.
    sim.alpha(0.001)
    // Same ids, fresh object refs — should NOT restart the sim.
    const n2 = n1.map((n) => ({ ...n }))
    const e2 = e1.map((e) => ({ ...e }))
    rerender({ nodes: n2, edges: e2 })
    // alpha should remain at our pinned value (no .restart() called).
    expect(sim.alpha()).toBe(0.001)
  })

  it('restarts simulation when a new node id appears', () => {
    const { nodes: n1, edges: e1 } = makeGraph(10)
    const { result, rerender } = renderHook(
      ({ nodes, edges }) => useD3Force(nodes, edges, { width: 900, height: 480, enabled: true }),
      { initialProps: { nodes: n1, edges: e1 } },
    )
    const sim = result.current.simulationRef.current!
    // Pin alpha to a low value.
    sim.alpha(0.001)
    // Add one new node id — effect should call sim.alpha(0.6).restart().
    const n2 = [...n1, { id: 'n_new', x: 450, y: 240 }]
    rerender({ nodes: n2, edges: e1 })
    expect(sim.alpha()).toBeGreaterThan(0.5)
  })
})
