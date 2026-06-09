import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StageProgressStrip from '../StageProgressStrip'
import type { StageInfo } from '../stageProgress'
import { WORKBENCH } from '../../../i18n/zh'

function makeStages(overrides: Partial<Record<string, StageInfo['status']>> = {}): StageInfo[] {
  const ids = [
    'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION',
    'CONFIG_GENERATION', 'SIMULATION_RUNNING', 'REPORT_GENERATING',
  ] as const
  return ids.map((id, index) => ({
    id,
    index,
    status: overrides[id] ?? 'pending',
  }))
}

describe('StageProgressStrip', () => {
  it('renders 7 stage segments with localized labels', () => {
    render(<StageProgressStrip stages={makeStages()} />)
    expect(screen.getByText(WORKBENCH.stageProgressTitle)).toBeTruthy()
    expect(screen.getByTestId('wb-stage-SEED_PARSING')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-REPORT_GENERATING')).toBeTruthy()
  })

  it('shows done / active / pending icons based on status', () => {
    const stages = makeStages({
      SEED_PARSING: 'done',
      GRAPH_BUILDING: 'done',
      ENTITY_EXTRACTION: 'active',
    })
    render(<StageProgressStrip stages={stages} />)
    const seg = screen.getByTestId('wb-stage-ENTITY_EXTRACTION')
    expect(seg.getAttribute('data-status')).toBe('active')
    expect(seg.getAttribute('data-current')).toBe('true')
  })

  it('renders simulation sub-progress when currentStage is SIMULATION_RUNNING', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'done', ENTITY_EXTRACTION: 'done',
      PROFILE_GENERATION: 'done', CONFIG_GENERATION: 'done',
      SIMULATION_RUNNING: 'active',
    })
    render(
      <StageProgressStrip
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SIMULATION_RUNNING"
      />,
    )
    expect(screen.getByTestId('wb-stage-sub')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-sub').textContent).toContain('R5/12')
    expect(screen.getByTestId('wb-stage-sub').textContent).toContain('9')
  })

  it('renders looping badge when isLooping=true', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'looping-active',
      ENTITY_EXTRACTION: 'done', PROFILE_GENERATION: 'done',
      CONFIG_GENERATION: 'done', SIMULATION_RUNNING: 'done',
    })
    render(<StageProgressStrip stages={stages} isLooping yearOffset={2} />)
    expect(screen.getByTestId('wb-stage-loop-badge')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-loop-badge').textContent).toContain('2')
  })

  it('does not render sub-progress when currentStage is not SIMULATION_RUNNING', () => {
    const stages = makeStages({ SEED_PARSING: 'active' })
    render(
      <StageProgressStrip
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SEED_PARSING"
      />,
    )
    expect(screen.queryByTestId('wb-stage-sub')).toBeNull()
  })
})
