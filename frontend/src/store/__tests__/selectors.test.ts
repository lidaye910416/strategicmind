/**
 * Loop engine v2 — T0.2 acceptance test for the influence / weight selectors.
 *
 * Fixture: 5 nodes + 6 edges (as called for in the plan), with known
 * degrees, emergence rounds, and a known reference (maxDegree / maxCount).
 * We then assert the formula at rounds 0 / 5 / 10 to lock in the decay
 * behaviour.
 *
 * Formulas (per docs/superpowers/specs/loop-engine-v2-implementation.md §T0.2):
 *   influence = clamp01(0.4·normDeg + 0.3·recency + 0.3·(prop ?? 0.4))
 *   weight    = clamp01(0.5·normCount + 0.5·exp(-0.15·age))
 */
import { describe, it, expect } from 'vitest'
import {
  selectInfluence,
  selectWeight,
  clamp01,
  normalize,
  recencyScore,
  type GraphNodeData,
  type GraphEdgeData,
} from '../pipeline'

// ---------------------------------------------------------------------------
// Fixtures — exactly the 5 nodes + 6 edges from the spec
// ---------------------------------------------------------------------------

const nodes: GraphNodeData[] = [
  { id: 'a', label: 'A', type: 'PERSON',  round: 0, properties: { influence: 0.9 } },
  { id: 'b', label: 'B', type: 'COMPANY', round: 1, properties: { influence: 0.6 } },
  { id: 'c', label: 'C', type: 'PRODUCT', round: 2 },
  { id: 'd', label: 'D', type: 'MARKET'  },
  { id: 'e', label: 'E', type: 'RISK',    round: 3 },
]

// Edges — degrees for each node:
//   a: (a-b), (a-c)        → 2
//   b: (a-b), (b-d)        → 2
//   c: (a-c), (c-d)        → 2
//   d: (b-d), (c-d), (d-e) → 3
//   e: (d-e)               → 1
const edges: GraphEdgeData[] = [
  { id: 'e1', source: 'a', target: 'b', round: 0, weight: 1 },
  { id: 'e2', source: 'a', target: 'c', round: 1, weight: 1 },
  { id: 'e3', source: 'b', target: 'd', round: 2, weight: 2 },
  { id: 'e4', source: 'c', target: 'd', round: 3, weight: 1 },
  { id: 'e5', source: 'd', target: 'e', round: 4, weight: 1 },
  { id: 'e6', source: 'b', target: 'c', round: 5, weight: 3 },
]

const DEGREE: Record<string, number> = { a: 2, b: 3, c: 3, d: 3, e: 1 }
const MAX_DEGREE = 3

const COUNT: Record<string, number> = {
  e1: 1, e2: 1, e3: 2, e4: 1, e5: 1, e6: 3,
}
const MAX_COUNT = 3

// ---------------------------------------------------------------------------
// helper maths (used by the spec assertions, kept here for readability)
// ---------------------------------------------------------------------------

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const norm = (x: number, ref: number) => (ref > 0 ? x / ref : 0)
const rec = (round: number | undefined, currentRound: number) =>
  typeof round !== 'number'
    ? 0.5
    : currentRound <= round
    ? 1
    : 1 / (1 + (currentRound - round))

// ---------------------------------------------------------------------------
// clamp01 / normalize / recencyScore — small, focused regression tests
// ---------------------------------------------------------------------------

describe('clamp01', () => {
  it('clamps negatives to 0', () => expect(clamp01(-0.5)).toBe(0))
  it('clamps > 1 to 1', () => expect(clamp01(1.5)).toBe(1))
  it('passes values in [0,1] through', () => expect(clamp01(0.42)).toBeCloseTo(0.42))
  it('returns 0 for NaN / Infinity', () => {
    expect(clamp01(NaN)).toBe(0)
    expect(clamp01(Infinity)).toBe(0)
    expect(clamp01(-Infinity)).toBe(0)
  })
})

describe('normalize', () => {
  it('divides by reference', () => expect(normalize(2, 4)).toBeCloseTo(0.5))
  it('returns 0 when reference is 0 or negative', () => {
    expect(normalize(2, 0)).toBe(0)
    expect(normalize(2, -1)).toBe(0)
  })
  it('returns 0 when value is non-finite', () => {
    expect(normalize(NaN, 1)).toBe(0)
    expect(normalize(Infinity, 1)).toBe(0)
  })
})

describe('recencyScore', () => {
  it('returns 0.5 (neutral) when round is unknown', () =>
    expect(recencyScore(undefined, 5)).toBe(0.5))
  it('returns 1 when the node emerged at or after the current round', () => {
    expect(recencyScore(3, 0)).toBe(1)
    expect(recencyScore(3, 3)).toBe(1)
  })
  it('decays with round distance', () => {
    expect(recencyScore(2, 3)).toBeCloseTo(0.5) // 1 / (1 + 1)
    expect(recencyScore(0, 10)).toBeCloseTo(1 / 11)
  })
})

// ---------------------------------------------------------------------------
// selectInfluence — the spec formula
// ---------------------------------------------------------------------------

describe('selectInfluence', () => {
  const forNode = (id: string, currentRound: number) => {
    const node = nodes.find((n) => n.id === id)!
    return selectInfluence(node, {
      degree: DEGREE[id],
      maxDegree: MAX_DEGREE,
      currentRound,
    })
  }

  it('matches the spec formula at round 0', () => {
    // a: deg=2 → 2/3; prop=0.9; recency(0,0)=1
    //   = 0.4·(2/3) + 0.3·1 + 0.3·0.9 = 0.2667 + 0.3 + 0.27 = 0.8367
    expect(forNode('a', 0)).toBeCloseTo(0.4 * (2 / 3) + 0.3 * 1 + 0.3 * 0.9, 4)
    // d: no round, no prop → 0.5 + 0.4 default
    //   = 0.4·1 + 0.3·0.5 + 0.3·0.4 = 0.4 + 0.15 + 0.12 = 0.67
    expect(forNode('d', 0)).toBeCloseTo(0.4 * 1 + 0.3 * 0.5 + 0.3 * 0.4, 4)
    // e: deg=1, round=3 (>0 → recency=1), defaultInfluence=0.4
    //   = 0.4·(1/3) + 0.3·1 + 0.3·0.4 = 0.1333 + 0.3 + 0.12 = 0.5533
    expect(forNode('e', 0)).toBeCloseTo(0.4 * (1 / 3) + 0.3 * 1 + 0.3 * 0.4, 4)
  })

  it('decays for nodes that emerged early (round 5)', () => {
    // a: round=0, so at current=5, recency = 1/6
    //   = 0.4·(2/3) + 0.3·(1/6) + 0.3·0.9 = 0.2667 + 0.05 + 0.27 = 0.5867
    expect(forNode('a', 5)).toBeCloseTo(
      0.4 * (2 / 3) + 0.3 * (1 / 6) + 0.3 * 0.9,
      4,
    )
    // c: round=2, current=5 → recency = 1/4
    //   = 0.4·1 + 0.3·0.25 + 0.3·0.4 (default) = 0.4 + 0.075 + 0.12 = 0.595
    expect(forNode('c', 5)).toBeCloseTo(0.4 * 1 + 0.3 * 0.25 + 0.3 * 0.4, 4)
  })

  it('decays further at round 10', () => {
    // e: round=3, current=10 → recency = 1/8 = 0.125
    //   = 0.4·(1/3) + 0.3·0.125 + 0.3·0.4 = 0.1333 + 0.0375 + 0.12 = 0.2908
    expect(forNode('e', 10)).toBeCloseTo(
      0.4 * (1 / 3) + 0.3 * (1 / 8) + 0.3 * 0.4,
      4,
    )
  })

  it('returns a value in [0, 1]', () => {
    for (const id of Object.keys(DEGREE)) {
      for (const r of [0, 5, 10]) {
        const v = forNode(id, r)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('falls back to defaultInfluence=0.4 when properties.influence is missing', () => {
    const node: GraphNodeData = { id: 'x' } // no properties.influence, no round
    const v = selectInfluence(node, { degree: 0, maxDegree: 1, currentRound: 0 })
    // 0.4·0 + 0.3·0.5 + 0.3·0.4 = 0.27
    expect(v).toBeCloseTo(0.27, 4)
  })
})

// ---------------------------------------------------------------------------
// selectWeight — the spec formula
// ---------------------------------------------------------------------------

describe('selectWeight', () => {
  const forEdge = (id: string, currentRound: number) => {
    const edge = edges.find((e) => e.id === id)!
    return selectWeight(edge, currentRound, {
      count: COUNT[id],
      maxCount: MAX_COUNT,
    })
  }

  it('matches the spec formula at round 0', () => {
    // e1: count=1, round=0, age=0 → exp(0)=1
    //   = 0.5·(1/3) + 0.5·1 = 0.1667 + 0.5 = 0.6667
    expect(forEdge('e1', 0)).toBeCloseTo(0.5 * (1 / 3) + 0.5 * 1, 4)
    // e6: count=3, round=5, age=0 (current=0 ≤ round) → exp(0)=1
    //   = 0.5·1 + 0.5·1 = 1
    expect(forEdge('e6', 0)).toBeCloseTo(1.0, 4)
  })

  it('applies the 0.15 exponential decay at round 5', () => {
    // e1: round=0, age=5 → exp(-0.75) ≈ 0.4724
    //   = 0.5·(1/3) + 0.5·exp(-0.75)
    const expected = 0.5 * (1 / 3) + 0.5 * Math.exp(-0.15 * 5)
    expect(forEdge('e1', 5)).toBeCloseTo(expected, 4)
    // e5: round=4, age=1 → exp(-0.15) ≈ 0.8607
    const expected2 = 0.5 * (1 / 3) + 0.5 * Math.exp(-0.15 * 1)
    expect(forEdge('e5', 5)).toBeCloseTo(expected2, 4)
  })

  it('applies the 0.15 exponential decay at round 10', () => {
    // e1: round=0, age=10 → exp(-1.5) ≈ 0.2231
    const expected = 0.5 * (1 / 3) + 0.5 * Math.exp(-0.15 * 10)
    expect(forEdge('e1', 10)).toBeCloseTo(expected, 4)
  })

  it('returns a value in [0, 1]', () => {
    for (const id of Object.keys(COUNT)) {
      for (const r of [0, 5, 10]) {
        const v = forEdge(id, r)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('uses edge.round as the default lastTouchRound when not overridden', () => {
    const edge: GraphEdgeData = { source: 'x', target: 'y', round: 2, weight: 2 }
    const direct = selectWeight(edge, 5)
    // round=2, age=3 → exp(-0.45)
    const expected = 0.5 * 1 + 0.5 * Math.exp(-0.15 * 3) // normCount=1, decay
    expect(direct).toBeCloseTo(expected, 4)
  })

  it('treats missing edge.round as the current round (no decay)', () => {
    const edge: GraphEdgeData = { source: 'x', target: 'y' }
    const v = selectWeight(edge, 7, { count: 1, maxCount: 1 })
    // age=0 → exp(0)=1
    expect(v).toBeCloseTo(0.5 * 1 + 0.5 * 1, 4)
  })
})
