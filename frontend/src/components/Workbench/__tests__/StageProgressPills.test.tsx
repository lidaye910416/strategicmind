import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StageProgressPills from '../StageProgressPills'
import type { StageInfo } from '../stageProgress'

function makeStages(overrides: Partial<Record<string, StageInfo['status']>> = {}): StageInfo[] {
  const ids = [
    'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION',
    'CONFIG_GENERATION', 'SIMULATION_RUNNING', 'REPORT_GENERATING',
  ] as const
  return ids.map((id, index) => ({ id, index, status: overrides[id] ?? 'pending' }))
}

describe('StageProgressPills', () => {
  it('renders 7 pill segments', () => {
    const { container } = render(<StageProgressPills stages={makeStages()} />)
    const pills = container.querySelectorAll('[data-testid^="wb-pill-"]')
    expect(pills).toHaveLength(7)
  })

  it('shows round sub-progress in pill 6 when sub provided', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'done', ENTITY_EXTRACTION: 'done',
      PROFILE_GENERATION: 'done', CONFIG_GENERATION: 'done',
      SIMULATION_RUNNING: 'active',
    })
    render(
      <StageProgressPills
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SIMULATION_RUNNING"
      />,
    )
    const pill6 = screen.getByTestId('wb-pill-SIMULATION_RUNNING')
    expect(pill6.textContent).toContain('R5/12')
  })

  it('marks done pills with checkmark visual (data-status="done")', () => {
    const stages = makeStages({ SEED_PARSING: 'done' })
    const { container } = render(<StageProgressPills stages={stages} />)
    const p = container.querySelector('[data-testid="wb-pill-SEED_PARSING"]')
    expect(p?.getAttribute('data-status')).toBe('done')
  })
})
