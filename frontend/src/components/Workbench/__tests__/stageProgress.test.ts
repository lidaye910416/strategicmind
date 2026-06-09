import { describe, it, expect } from 'vitest'
import { STAGE_ORDER, computeStageStatuses } from '../stageProgress'

describe('stageProgress', () => {
  it('STAGE_ORDER has exactly 7 stages in canonical order', () => {
    expect(STAGE_ORDER).toEqual([
      'SEED_PARSING',
      'GRAPH_BUILDING',
      'ENTITY_EXTRACTION',
      'PROFILE_GENERATION',
      'CONFIG_GENERATION',
      'SIMULATION_RUNNING',
      'REPORT_GENERATING',
    ])
  })

  it('marks all 7 stages as pending when nothing is done and no current', () => {
    const result = computeStageStatuses({
      currentStage: 'IDLE',
      completedStages: [],
    })
    expect(result.map((s) => s.status)).toEqual([
      'pending', 'pending', 'pending', 'pending',
      'pending', 'pending', 'pending',
    ])
  })

  it('marks stages <= current as done and current as active', () => {
    const result = computeStageStatuses({
      currentStage: 'ENTITY_EXTRACTION',
      completedStages: ['SEED_PARSING', 'GRAPH_BUILDING'],
    })
    expect(result.find((s) => s.id === 'SEED_PARSING')?.status).toBe('done')
    expect(result.find((s) => s.id === 'GRAPH_BUILDING')?.status).toBe('done')
    expect(result.find((s) => s.id === 'ENTITY_EXTRACTION')?.status).toBe('active')
    expect(result.find((s) => s.id === 'PROFILE_GENERATION')?.status).toBe('pending')
  })

  it('marks SIMULATION_RUNNING as active (not pending) when current', () => {
    const result = computeStageStatuses({
      currentStage: 'SIMULATION_RUNNING',
      completedStages: [
        'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
        'PROFILE_GENERATION', 'CONFIG_GENERATION',
      ],
    })
    expect(result.find((s) => s.id === 'SIMULATION_RUNNING')?.status).toBe('active')
  })

  it('marks looped-back stages as looping-active when isLooping=true', () => {
    const result = computeStageStatuses({
      currentStage: 'GRAPH_BUILDING',
      completedStages: [
        'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
        'PROFILE_GENERATION', 'CONFIG_GENERATION', 'SIMULATION_RUNNING',
      ],
      isLooping: true,
    })
    expect(result.find((s) => s.id === 'GRAPH_BUILDING')?.status).toBe('looping-active')
  })

  it('returns 7 entries even when currentStage is unknown (e.g. IDLE)', () => {
    const result = computeStageStatuses({
      currentStage: 'WHATEVER',
      completedStages: [],
    })
    expect(result).toHaveLength(7)
  })

  it('marks current stage as failed when runStatus=failed', () => {
    const result = computeStageStatuses({
      currentStage: 'GRAPH_BUILDING',
      completedStages: ['SEED_PARSING'],
      runStatus: 'failed',
    })
    expect(result.find((s) => s.id === 'GRAPH_BUILDING')?.status).toBe('failed')
  })

  it('marks current stage as cancelled when runStatus=cancelled', () => {
    const result = computeStageStatuses({
      currentStage: 'SIMULATION_RUNNING',
      completedStages: ['SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION', 'CONFIG_GENERATION'],
      runStatus: 'cancelled',
    })
    expect(result.find((s) => s.id === 'SIMULATION_RUNNING')?.status).toBe('cancelled')
  })
})
