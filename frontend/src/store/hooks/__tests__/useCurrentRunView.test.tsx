/**
 * useCurrentRunView - Bug #3 修复测试。
 *
 * 覆盖:
 *   - useCurrentGraph live 路径: store 有数据时 source='live'
 *   - useCurrentGraph fallback 路径: runId=null 时 queryFn 触发 /pipeline/runs
 *     + /graph-snapshot, setGraphSnapshot 写回 store
 *   - useCurrentGraph empty 路径: 都没有时 source='empty'
 *   - useCurrentAgents 派生自 graph nodes (PERSON 类型过滤)
 *   - useCurrentTimeline 派生自 simRounds
 *
 * N7 验证: REST fallback 不在 useGraphStream 内部, 而在 useCurrentGraph。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  usePipelineStore,
  type GraphNodeData,
  type GraphEdgeData,
} from '../../pipeline'
import {
  useCurrentGraph,
  useCurrentAgents,
  useCurrentTimeline,
  _resetFallbackCacheForTests,
} from '../useCurrentRunView'
import http from '../../../services/http'

vi.mock('../../../services/http', () => ({
  default: { get: vi.fn() },
}))

beforeEach(() => {
  usePipelineStore.setState({
    runId: null,
    graphNodes: [],
    graphEdges: [],
    graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
    simRounds: [],
  })
  vi.clearAllMocks()
  ;(http.get as any).mockReset()
  _resetFallbackCacheForTests()
})

describe('useCurrentGraph', () => {
  it('returns source=live when store has nodes + runId', () => {
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [{ id: 'n1' } as GraphNodeData],
      graphEdges: [{ id: 'e1', source: 'a', target: 'b' } as GraphEdgeData],
      graphProgress: { phase: 'completed', nodes: 1, edges: 1 },
    })
    const { result } = renderHook(() => useCurrentGraph())
    expect(result.current.source).toBe('live')
    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toHaveLength(1)
  })

  it('returns source=empty when both runId and store are empty', () => {
    usePipelineStore.setState({
      runId: null,
      graphNodes: [],
      graphEdges: [],
    })
    const { result } = renderHook(() => useCurrentGraph())
    // runId=null 时触发 fetchFallback, 没 mock → 走 catch → fallback.data=null
    // → state.fallback 保持 null → source='empty'
    expect(result.current.source).toBe('empty')
  })

  it('returns source=snapshot with mock /pipeline/runs + graph-snapshot (N7)', async () => {
    ;(http.get as any)
      .mockResolvedValueOnce({
        data: {
          runs: [
            { run_id: 'r_done_1', status: 'completed', updated_at: 500 },
            { run_id: 'r_done_2', status: 'completed', updated_at: 1000 },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          nodes: [
            { id: 'n1', type: 'PERSON', label: 'A' },
            { id: 'n2', type: 'COMPANY', label: 'B' },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        },
      })

    usePipelineStore.setState({ runId: null, graphNodes: [], graphEdges: [] })
    const { result } = renderHook(() => useCurrentGraph())

    await waitFor(() => {
      expect(result.current.source).toBe('snapshot')
    })
    expect(result.current.nodes).toHaveLength(2)
    expect(result.current.edges).toHaveLength(1)
  })

  it('returns source=empty when /pipeline/runs returns no completed', async () => {
    ;(http.get as any).mockResolvedValueOnce({
      data: { runs: [] },
    })
    usePipelineStore.setState({ runId: null, graphNodes: [], graphEdges: [] })
    const { result } = renderHook(() => useCurrentGraph())
    await waitFor(() => {
      expect(result.current.source).toBe('empty')
    })
  })
})

describe('useCurrentAgents', () => {
  it('derives agents from PERSON-type nodes', () => {
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [
        { id: 'p1', type: 'PERSON', label: 'Alice', influence: 0.7 } as GraphNodeData,
        { id: 'p2', type: 'PERSON', label: 'Bob', influence: 0.4 } as GraphNodeData,
        { id: 'c1', type: 'COMPANY', label: 'Acme' } as GraphNodeData,
      ],
      graphEdges: [],
      graphProgress: { phase: 'completed', nodes: 3, edges: 0 },
    })
    const { result } = renderHook(() => useCurrentAgents())
    expect(result.current).toHaveLength(2)
    expect(result.current[0].name).toBe('Alice')
    expect(result.current[1].name).toBe('Bob')
  })
})

describe('useCurrentTimeline', () => {
  it('derives timeline from simRounds', () => {
    usePipelineStore.setState({
      simRounds: [
        { round: 1, ts: 100, actions_count: 3, belief_updates_count: 2 } as any,
        { round: 2, ts: 200, actions_count: 5, belief_updates_count: 4 } as any,
      ],
    })
    const { result } = renderHook(() => useCurrentTimeline())
    expect(result.current).toHaveLength(2)
    expect(result.current[0].round).toBe(1)
    expect(result.current[1].round).toBe(2)
    expect(result.current[0].summary).toContain('Round 1')
  })
})

describe('useCurrentGraph — Rules of Hooks invariant', () => {
  /**
   * Regression: a prior implementation of `useCurrentGraph()` had
   *   `if (liveSlice) return liveSlice`
   * followed by `useState` + `useRef` + `useEffect`. When SSE pushed a
   * first graph node mid-session, React saw a smaller hook count and
   * threw "Rendered fewer hooks than expected.", blanking the Workbench.
   *
   * This test walks the three source states in sequence and asserts no
   * React-hook-related console error escapes.
   */
  it('keeps hook count invariant across empty → live → empty transitions', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result, rerender } = renderHook(() => useCurrentGraph())
    expect(result.current.source).toBe('empty')

    // Live data arrives via store mutation (simulates SSE push).
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [{ id: 'n1' } as GraphNodeData],
      graphEdges: [{ id: 'e1', source: 'a', target: 'b' } as GraphEdgeData],
    })
    rerender()
    expect(result.current.source).toBe('live')
    expect(result.current.nodes).toHaveLength(1)

    // Live data clears again — null runId + empty lists.
    usePipelineStore.setState({ graphNodes: [], graphEdges: [], runId: null })
    rerender()
    expect(result.current.source).toBe('empty')

    const offenders = consoleErrorSpy.mock.calls.filter((args) => {
      const msg = args.map(String).join(' ')
      return /Rendered (?:fewer|more) hooks|accidental early return|Rules of Hooks/.test(msg)
    })
    expect(offenders).toEqual([])
    consoleErrorSpy.mockRestore()
  })
})
