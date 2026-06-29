/**
 * RealtimeGraph perf smoke test (N2 fix 验证).
 *
 * 覆盖:
 *   - force_effect_does_not_rebind_on_tick: 30s polling tick 不再 cancel+rebuild 300 iter O(n²)
 *   - 800 节点下 rAF 回调数 ≤ 500 (N2 性能 smoke)
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import RealtimeGraph from '../RealtimeGraph'

// `global` is a Node/browser builtin; in jsdom + strict TS settings
// it is not always present in the type lib. Declare a minimal local
// alias to satisfy tsc without pulling in @types/node.
const g: any = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined)

// mock zustand store — 用一个可变对象代替真实 store
const mockState: any = {
  graphNodes: [],
  graphEdges: [],
  graphProgress: {},
  graphCapacity: 1000,
  setGraphCapacity: vi.fn(),
  seedGraph: vi.fn(),
}

vi.mock('../../../store/pipeline', () => ({
  usePipelineStore: Object.assign(
    (sel: any) => sel(mockState),
    {
      getState: () => mockState,
      setState: (u: any) =>
        Object.assign(
          mockState,
          typeof u === 'function' ? u(mockState) : u,
        ),
    },
  ),
  useGraphNodes: () => mockState.graphNodes,
  useGraphEdges: () => mockState.graphEdges,
  useGraphPhase: () => 'completed',
  useStage: () => 'COMPLETED',
  useStatus: () => 'completed',
}))

vi.mock('../../../services/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { nodes: [], edges: [] } }),
  },
}))

describe('RealtimeGraph N2 — force effect 解绑 polling tick', () => {
  let origRAF: any
  let origCAF: any
  let rafCount: number

  beforeEach(() => {
    cleanup()
    mockState.graphNodes = []
    mockState.graphEdges = []
    mockState.graphProgress = {}
    mockState.setGraphCapacity.mockClear()
    rafCount = 0
    origRAF = g.requestAnimationFrame
    origCAF = g.cancelAnimationFrame
    g.requestAnimationFrame = vi.fn(() => {
      rafCount += 1
      return rafCount
    }) as any
    g.cancelAnimationFrame = vi.fn() as any
  })

  afterEach(() => {
    g.requestAnimationFrame = origRAF
    g.cancelAnimationFrame = origCAF
  })

  test('force_effect_does_not_rebind_on_tick: 节点引用变化不会触发指数级 rAF 增长', async () => {
    render(<RealtimeGraph />)
    const initCount = rafCount
    expect(initCount).toBeGreaterThanOrEqual(0)  // mount may or may not call rAF

    // 模拟 30s polling tick 触发, 改 mockState.graphNodes 引用
    const simNodes = Array.from({ length: 100 }, (_, i) => ({
      id: `n-${i}`,
      label: `n-${i}`,
      type: 'Person',
      signal_density: 0.5,
    }))
    await act(async () => {
      mockState.graphNodes = simNodes
    })

    // 等待 200ms, rAF 不应指数级增长
    await new Promise((r) => setTimeout(r, 200))
    const finalCount = rafCount
    // d3-force alphaDecay=0.05, 100 nodes ~80 ticks 后 settle, 不应 > 300 rAF
    expect(finalCount - initCount).toBeLessThan(300)
  })

  test('800 节点 2s 内 rAF < 500 (perf smoke)', async () => {
    mockState.graphNodes = Array.from({ length: 800 }, (_, i) => ({
      id: `n-${i}`,
      label: `n-${i}`,
      type: 'Person',
      signal_density: 0.5,
    }))
    render(<RealtimeGraph />)
    await new Promise((r) => setTimeout(r, 2000))
    expect(rafCount).toBeLessThan(500)
  })
})
