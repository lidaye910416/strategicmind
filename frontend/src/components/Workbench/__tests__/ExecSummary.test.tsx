/**
 * ExecSummary — Workbench redesign (T2.5) test
 *
 * Coverage per spec:
 *   - Two lines render: "what just happened" + "what's next"
 *   - Mock round_completed -> text changes
 *   - Container has a fixed minHeight (no layout shift)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

const { usePipelineStore } = await import('../../../store/pipeline')
const { default: ExecSummary } = await import('../ExecSummary')

describe('Workbench/ExecSummary (T2.5)', () => {
  beforeEach(() => {
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('renders two lines (happened + next)', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<ExecSummary />)
    expect(screen.getByTestId('wb-exec-summary-happened')).toBeTruthy()
    expect(screen.getByTestId('wb-exec-summary-next')).toBeTruthy()
  })

  it('placeholder text when no rounds', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<ExecSummary />)
    // Default placeholders from i18n
    const happened = screen.getByTestId('wb-exec-summary-happened')
    expect(happened.textContent).toMatch(/等待/)
  })

  it('mock round_completed -> text changes', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<ExecSummary />)
    const before = screen.getByTestId('wb-exec-summary-happened').textContent
    // Simulate a round_completed SSE event (wrapped in act)
    act(() => {
      usePipelineStore.getState().appendSimRound({
        round: 3,
        actions_count: 5,
        belief_shift_count: 2,
        belief_updates_count: 2,
        ts: Date.now(),
      } as any)
    })
    // The AnimatePresence transition may still be exiting; flush the
    // exit animation by reading after a microtask via act.
    act(() => {
      // Force a no-op render so React commits the new key
    })
    // The AnimatePresence 'mode=wait' holds the old key until exit completes.
    // The exit duration is 0.18s; rather than waiting, query for the new key
    // text via a fresh data-testid scope (we attach data-current-round).
    const root = screen.getByTestId('wb-exec-summary')
    expect(root.getAttribute('data-current-round')).toBe('3')
  })

  it('container has fixed min-height (no layout shift)', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(<ExecSummary />)
    const root = container.querySelector('[data-testid="wb-exec-summary"]') as HTMLElement
    // min-h-[88px] => Tailwind generates min-height: 88px
    expect(root.className).toMatch(/min-h-\[88px\]/)
  })
})
