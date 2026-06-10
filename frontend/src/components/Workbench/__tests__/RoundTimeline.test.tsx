/**
 * RoundTimeline — Workbench redesign (T2.3) test
 *
 * Coverage per spec:
 *   - 12 cards render (with explicit totalRounds=12)
 *   - Current round (4) has glowing class (data-current="true" + magenta ring)
 *   - Click on round 7 fires the right callback with the right runId
 *   - No runId → empty placeholder state
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Stub EventSource (the store opens one)
class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

const { usePipelineStore } = await import('../../../store/pipeline')
const { default: RoundTimeline } = await import('../RoundTimeline')

describe('Workbench/RoundTimeline (T2.3)', () => {
  beforeEach(() => {
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('renders 12 cards when totalRounds=12', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RoundTimeline totalRounds={12} />)
    for (let n = 1; n <= 12; n++) {
      expect(screen.getByTestId(`wb-round-card-${n}`)).toBeTruthy()
    }
  })

  it('current round (4) has the glowing data-current attribute', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RoundTimeline totalRounds={12} currentRound={4} />)
    const current = screen.getByTestId('wb-round-card-4')
    expect(current.getAttribute('data-current')).toBe('true')
    // Magenta ring is applied via inline style (box-shadow with #E879F9)
    const style = current.getAttribute('style') ?? ''
    expect(style).toContain('#E879F9')
  })

  it('click on round 7 fires the right callback with the right runId', () => {
    usePipelineStore.setState({ runId: 'run_xyz', status: 'running' })
    const onSelect = vi.fn()
    render(
      <RoundTimeline totalRounds={12} onRoundSelect={onSelect} />,
    )
    const card7 = screen.getByTestId('wb-round-card-7')
    fireEvent.click(card7)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('run_xyz', 7)
  })

  it('shows the empty placeholder when there is no runId', () => {
    usePipelineStore.setState({ runId: null })
    render(<RoundTimeline totalRounds={12} />)
    const root = screen.getByTestId('wb-round-timeline')
    expect(root.getAttribute('data-state')).toBe('empty')
  })

  it('non-current cards do not have the glowing class', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RoundTimeline totalRounds={12} currentRound={4} />)
    const card3 = screen.getByTestId('wb-round-card-3')
    expect(card3.getAttribute('data-current')).toBe('false')
  })
})
