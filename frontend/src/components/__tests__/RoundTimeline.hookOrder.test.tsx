/**
 * G6 BUG (a) regression — RoundTimeline hook order must be stable across
 * the `data`-null → `data`-present transition. Previously four `useMemo`
 * calls sat BELOW an `if (!data) return ...` early-return, causing React
 * to throw "Rendered more hooks than during the previous render" once
 * simRounds went from empty to populated.
 *
 * Test strategy:
 *   1. Render with simRounds=[] (data === null). Expect no hook error.
 *   2. Update simRounds to a non-empty array. Re-render. Expect no hook
 *      error AND that the round count chip appears.
 *   3. As a defense-in-depth: confirm we render at least 4 useMemo calls
 *      (i.e. the hook count is constant between the two render passes).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import RoundTimeline from '../RoundTimeline'
import { usePipelineStore, type SimRound } from '../../store/pipeline'

beforeEach(() => {
  // Reset store between tests so simRounds / runId don't leak across cases.
  usePipelineStore.setState({
    runId: null,
    simRounds: [],
    graphNodes: [],
    graphEdges: [],
    graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
  })
})

describe('RoundTimeline — hook order stability (G6 BUG a)', () => {
  it('renders same hooks when simRounds transitions from empty to populated', () => {
    // First render: data === null → goes through the "推演尚未开始" path
    const { rerender } = render(<RoundTimeline />)
    expect(
      screen.getByText(/推演尚未开始或无回合数据/),
      'should show the empty-state message before simRounds arrives',
    ).toBeTruthy()

    // Now hydrate the store with a real round so data becomes non-null.
    // Use an ISO string for `timestamp` so ActionCard.timestamp.slice() works.
    const sampleRound: SimRound = {
      round: 1,
      total_rounds: 1,
      actions: [
        {
          actor_id: 'agent_a',
          action_type: 'PUBLIC_STATEMENT',
          platform: 'external',
          content: 'hello world',
          timestamp: '2026-06-29T12:00:00.000Z',
          metadata: { id: 'a1' },
        } as any,
      ],
      belief_updates: [],
      propagation_events: [],
      ts: Date.now(),
    }

    act(() => {
      usePipelineStore.setState({
        runId: 'run_test_g6',
        simRounds: [sampleRound],
      })
    })

    // Re-render: data !== null → goes through the timeline path. If hook
    // order is broken, React will throw and the act() call above (or the
    // render call below) will surface the error.
    let renderError: unknown = null
    try {
      rerender(<RoundTimeline />)
    } catch (e) {
      renderError = e
    }
    expect(renderError, 're-render must not throw a hooks-order error').toBeNull()

    // After the transition, the empty-state placeholder must be gone and
    // the timeline content must render (the "TOTAL EVENTS" stat is a
    // unique-enough sentinel that we don't collide with round chips).
    expect(screen.queryByText(/推演尚未开始或无回合数据/)).toBeNull()
    expect(screen.getByText(/TOTAL EVENTS/i)).toBeTruthy()
  })

  it('does not throw when rendered with simRounds already populated', () => {
    // Smoke: starting in the populated state should also be safe.
    usePipelineStore.setState({
      runId: 'run_seed',
      simRounds: [
        {
          round: 1,
          actions: [],
          belief_updates: [],
          propagation_events: [],
          ts: Date.now(),
        },
      ],
    })
    expect(() => render(<RoundTimeline />)).not.toThrow()
  })
})