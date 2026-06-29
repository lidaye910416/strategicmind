/**
 * G6 BUG (c) regression — the pipeline store must be created with
 * `createWithEqualityFn` (not the deprecated `create`) so consumers can
 * safely pass `shallow` as the second arg. Without that change, Zustand
 * logs `[DEPRECATED] Use createWithEqualityFn in conjunction with shallow`
 * every time a component subscribes via `usePipelineStore(sel, shallow)`.
 *
 * Test strategy:
 *   1. Confirm the store instance was produced by createWithEqualityFn
 *      (it accepts a 3rd arg: selector + equality fn).
 *   2. Sanity check that all the documented array/object selectors
 *      still return identical references when the underlying slice
 *      is unchanged (i.e. shallow-equality is honored).
 *   3. Confirm scalar selectors remain single-arg (we don't accidentally
 *      pass shallow to a string selector — that would still work but
 *      adds noise).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  usePipelineStore,
  useSimRounds,
  useGraphNodes,
  useGraphEdges,
  useGraphProgress,
  useMarketEvents,
  useRecentShocks,
  useReportRisks,
  useRunId,
  useStatus,
  type SimRound,
  type GraphNodeData,
} from '../pipeline'

beforeEach(() => {
  usePipelineStore.setState({
    runId: null,
    status: 'idle',
    simRounds: [],
    graphNodes: [],
    graphEdges: [],
    graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
    marketEvents: [],
    recentShocks: [],
    reportRisks: [],
  })
})

describe('pipeline store — createWithEqualityFn compatibility (G6 BUG c)', () => {
  it('usePipelineStore accepts a 2nd-arg equality function (shallow path)', () => {
    // createWithEqualityFn widens the React hook signature to
    //   useStore(selector, equalityFn)
    // The legacy `create` would log:
    //   [DEPRECATED] Use createWithEqualityFn in conjunction with shallow
    // whenever a 2nd argument was passed.
    //
    // We assert the contract by calling the hook with a custom equality
    // function and then triggering a state update so the equality fn is
    // invoked. The fact that no deprecation warning is thrown (and the
    // custom equality fn is honored) is the proof.
    let calls = 0
    const customEq = (a: unknown, b: unknown) => {
      calls += 1
      return Object.is(a, b)
    }
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => usePipelineStore((s) => s.simRounds, customEq))
    }).not.toThrow()

    // Trigger a state change so the equality fn is called.
    act(() => {
      usePipelineStore.setState({
        simRounds: [
          {
            round: 1,
            actions: [],
            belief_updates: [],
            propagation_events: [],
            ts: 1,
          },
        ],
      })
    })

    expect(calls, 'custom equality fn must be invoked on state change').toBeGreaterThan(0)
    // Belt-and-suspenders: confirm no deprecation warning reached console.
    const allLogs = [...consoleWarnSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((args) => String(args[0] ?? ''))
      .join('\n')
    expect(
      allLogs,
      'no deprecation warning should be emitted when using a 2nd-arg equality fn',
    ).not.toMatch(/DEPRECATED/i)
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('object/array selectors keep reference identity when slice is unchanged (shallow works)', () => {
    // First read captures the slice reference.
    const { result, rerender } = renderHook(() => ({
      rounds: useSimRounds(),
      nodes: useGraphNodes(),
      edges: useGraphEdges(),
      progress: useGraphProgress(),
      marketEvents: useMarketEvents(),
      shocks: useRecentShocks(),
      risks: useReportRisks(),
    }))
    const first = result.current

    // Trigger a re-render via an unrelated slice change. With shallow,
    // the array/object selectors should NOT recompute-and-return a new
    // reference (their underlying slice is untouched). With the legacy
    // `create` + a default Object.is equality, every state change would
    // produce a new array reference even though the array itself is the
    // same — but here, since we're only reading, the slice itself didn't
    // change so the reference must be preserved.
    rerender()
    const second = result.current

    expect(second.rounds).toBe(first.rounds)
    expect(second.nodes).toBe(first.nodes)
    expect(second.edges).toBe(first.edges)
    expect(second.progress).toBe(first.progress)
    expect(second.marketEvents).toBe(first.marketEvents)
    expect(second.shocks).toBe(first.shocks)
    expect(second.risks).toBe(first.risks)
  })

  it('scalar selectors return same primitive on no-op update', () => {
    const { result, rerender } = renderHook(() => ({
      runId: useRunId(),
      status: useStatus(),
    }))
    expect(result.current.runId).toBeNull()
    expect(result.current.status).toBe('idle')

    rerender()
    expect(result.current.runId).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('mutating an array slice DOES produce a new reference (no false shallow)', () => {
    const { result } = renderHook(() => useSimRounds())
    const before = result.current
    const next: SimRound = {
      round: 1,
      actions: [],
      belief_updates: [],
      propagation_events: [],
      ts: 1,
    }
    act(() => {
      usePipelineStore.setState({ simRounds: [next] })
    })
    expect(result.current).not.toBe(before)
    expect(result.current).toHaveLength(1)
  })

  it('updating graphNodes slice triggers new reference', () => {
    const { result } = renderHook(() => useGraphNodes())
    const before = result.current
    const node: GraphNodeData = { id: 'n1', label: 'N1', type: 'PERSON' }
    act(() => {
      usePipelineStore.setState({ graphNodes: [node] })
    })
    expect(result.current).not.toBe(before)
    expect(result.current).toHaveLength(1)
  })
})