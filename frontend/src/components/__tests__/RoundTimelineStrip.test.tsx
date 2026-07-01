/**
 * RoundTimelineStrip - 顶部 round pill 列表 (MiroFish-style 时间轴).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoundTimelineStrip } from '../RoundTimelineStrip'

describe('RoundTimelineStrip', () => {
  const labels12 = Array.from({length: 12}, (_, i) => `Month ${i + 1}`)

  it('renders N pills for N rounds', () => {
    render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={0}
        deltas={{}}
        simulatedLabels={labels12}
      />
    )
    const pills = screen.getAllByText(/^R\d+$/)
    expect(pills).toHaveLength(12)
  })

  it('highlights current round with animate-pulse class', () => {
    const { container } = render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={3}
        deltas={{3: {nodes: 5, edges: 7}}}
        simulatedLabels={labels12}
      />
    )
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('shows node delta badge for rounds with nodes_added > 0', () => {
    render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={3}
        deltas={{2: {nodes: 5, edges: 0}}}
        simulatedLabels={labels12}
      />
    )
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('shows edge delta badge for rounds with edges_added > 0', () => {
    render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={3}
        deltas={{2: {nodes: 0, edges: 7}}}
        simulatedLabels={labels12}
      />
    )
    expect(screen.getByText('+7')).toBeInTheDocument()
  })

  it('does not render delta badges when deltas empty', () => {
    render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={0}
        deltas={{}}
        simulatedLabels={labels12}
      />
    )
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument()
  })

  it('renders simulated label inside pill', () => {
    render(
      <RoundTimelineStrip
        totalRounds={3}
        currentRound={0}
        deltas={{}}
        simulatedLabels={['Month 1', 'Month 2', 'Day 90']}
      />
    )
    expect(screen.getByText('Day 90')).toBeInTheDocument()
  })
})