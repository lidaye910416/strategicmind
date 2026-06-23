/**
 * useGraphStream - N7 简化测试。
 *
 * 覆盖:
 *   - 不再调 /graph-snapshot (REST 兜底迁到 useCurrentGraph)
 *   - 不再调 /pipeline/runs
 *   - 不再 return source 字段 (replaced by useCurrentGraph().source)
 *   - 仍订阅 store.graphNodes / graphEdges (SSE 写 store)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGraphStream } from '../useGraphStream'
import { usePipelineStore, type GraphNodeData } from '../../pipeline'
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
  })
  vi.clearAllMocks()
})

describe('useGraphStream (N7 simplified)', () => {
  it('does NOT call /graph-snapshot on mount', () => {
    renderHook(() => useGraphStream('r_test_001'))
    expect(http.get).not.toHaveBeenCalledWith(
      expect.stringContaining('graph-snapshot'),
    )
  })

  it('does NOT call /graph-snapshot when graphProgress.phase changes', () => {
    renderHook(() => useGraphStream('r_test_001'))
    usePipelineStore.setState({
      graphProgress: { phase: 'graph_building', nodes: 0, edges: 0 },
    })
    usePipelineStore.setState({
      graphProgress: { phase: 'completed', nodes: 1, edges: 0 },
    })
    expect(http.get).not.toHaveBeenCalledWith(
      expect.stringContaining('graph-snapshot'),
    )
  })

  it('does NOT call /pipeline/runs either', () => {
    renderHook(() => useGraphStream('r_test_001'))
    expect(http.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/pipeline/runs'),
    )
  })

  it('source field is deprecated (undefined)', () => {
    const { result } = renderHook(() => useGraphStream('r1'))
    expect(result.current.source).toBeUndefined()
  })

  it('still subscribes to store.graphNodes/graphEdges', () => {
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [{ id: 'n1' } as GraphNodeData, { id: 'n2' } as GraphNodeData],
      graphEdges: [],
    })
    const { result } = renderHook(() => useGraphStream('r1'))
    expect(result.current.nodes).toHaveLength(2)
    expect(result.current.totalNodes).toBe(2)
  })
})
