/**
 * EdgePath.test.ts — Pure-function tests for quadratic Bezier fan-curvature.
 *
 * Spec (T3.6):
 *   - 3 edges between A and B -> 3 distinct Q curves with different control points
 */
import { describe, it, expect } from 'vitest'
import { computeEdgeCurvature, buildEdgePath } from '../EdgePath'
import type { ForceEdge, ForceNode } from '../useD3Force'

const a: ForceNode = { id: 'A', x: 0, y: 0 }
const b: ForceNode = { id: 'B', x: 100, y: 0 }
void a; void b  // referenced in test names

const mk = (id: string, source: string, target: string): ForceEdge =>
  ({ id, source, target }) as ForceEdge

describe('EdgePath — fan-curvature (T3.6)', () => {
  it('single edge between A and B has offset=0 (straight line)', () => {
    const edges = [mk('e1', 'A', 'B')]
    const { offset } = computeEdgeCurvature(edges[0], edges)
    expect(offset).toBe(0)
    const d = buildEdgePath(0, 0, 100, 0, 0)
    expect(d).toBe('M 0 0 L 100 0')
  })

  it('3 edges between A and B -> 3 distinct Q curves with different control points', () => {
    const edges = [
      mk('e1', 'A', 'B'),
      mk('e2', 'A', 'B'),
      mk('e3', 'A', 'B'),
    ]
    const curves = edges.map((e) => {
      const { offset } = computeEdgeCurvature(e, edges)
      return { offset, d: buildEdgePath(0, 0, 100, 0, offset) }
    })
    // First edge: straight line (offset 0)
    expect(curves[0].offset).toBe(0)
    expect(curves[0].d).toBe('M 0 0 L 100 0')
    // Second and third: curved with distinct control points
    expect(curves[1].offset).not.toBe(0)
    expect(curves[2].offset).not.toBe(0)
    expect(curves[1].offset).not.toBe(curves[2].offset)  // symmetric fan
    expect(Math.abs(curves[1].offset)).toBe(Math.abs(curves[2].offset))  // equal magnitude
    // Control points are distinct (one y>0, one y<0)
    const m1 = curves[1].d.match(/Q (\S+) (\S+)/)!
    const m2 = curves[2].d.match(/Q (\S+) (\S+)/)!
    expect(`${m1[1]},${m1[2]}`).not.toBe(`${m2[1]},${m2[2]}`)
  })

  it('edges in different groups are independent (curvature does not cross groups)', () => {
    const c: ForceNode = { id: 'C', x: 200, y: 0 }
    void c
    const edges = [
      mk('e1', 'A', 'B'),
      mk('e2', 'A', 'B'),
      mk('e3', 'A', 'C'),
    ]
    const e3 = computeEdgeCurvature(edges[2], edges)
    // Edge 3 is the only one in the A-C group, so offset = 0
    expect(e3.offset).toBe(0)
  })

  it('handles self-loops without breaking fan-curvature', () => {
    const edges = [
      mk('e1', 'A', 'A'),  // self-loop
      mk('e2', 'A', 'B'),
      mk('e3', 'A', 'B'),
    ]
    const e2 = computeEdgeCurvature(edges[1], edges)
    const e3 = computeEdgeCurvature(edges[2], edges)
    // e2 and e3 are in the A-B group (the self-loop is excluded)
    // Since there are 2 edges in the A-B group, e2 is idx 0 (offset 0) and e3 is idx 1 (offset 28)
    expect(e2.offset).toBe(0)
    expect(e3.offset).not.toBe(0)
  })
})
