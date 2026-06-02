// API Types
export type PipelineStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface PipelineStatusResponse {
  run_id: string
  current_stage: PipelineStage | string
  status: PipelineStatus | string
  progress: number
  current_round?: number
  total_rounds?: number
}

export enum PipelineStage {
  SEED_PARSING = 'SEED_PARSING',
  GRAPH_BUILDING = 'GRAPH_BUILDING',
  ENTITY_EXTRACTION = 'ENTITY_EXTRACTION',
  PROFILE_GENERATION = 'PROFILE_GENERATION',
  CONFIG_GENERATION = 'CONFIG_GENERATION',
  SIMULATION_RUNNING = 'SIMULATION_RUNNING',
  REPORT_GENERATING = 'REPORT_GENERATING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface SimulationConfig {
  simulation_hours: number
  entity_types: string[] | null
  report_style: 'executive' | 'technical' | 'narrative'
  max_rounds?: number
}

export interface Agent {
  agent_id: string
  name: string
  agent_type: string
  influence_weight: number
  beliefs?: Record<string, number>
}

export interface Stakeholder {
  stakeholder_id: string
  name: string
  stakeholder_type: string
  influence_weight: number
  relationships: Record<string, any>
}
