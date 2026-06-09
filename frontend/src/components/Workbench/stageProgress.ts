/**
 * stageProgress — 7 步流水线状态计算工具 (P5 增强)
 *
 * 纯函数, 不依赖 React/store, 便于单元测试和复用。
 * 后端 STAGE_ORDER 在 `backend/services/pipeline_orchestrator.py` 第 81 行。
 */

export const STAGE_ORDER = [
  'SEED_PARSING',
  'GRAPH_BUILDING',
  'ENTITY_EXTRACTION',
  'PROFILE_GENERATION',
  'CONFIG_GENERATION',
  'SIMULATION_RUNNING',
  'REPORT_GENERATING',
] as const

export type StageId = typeof STAGE_ORDER[number]

export type StageStatus = 'done' | 'active' | 'pending' | 'looping-active' | 'failed' | 'cancelled'

export interface StageInfo {
  id: StageId
  index: number
  status: StageStatus
}

export interface ComputeInput {
  currentStage: string
  completedStages: string[]
  /** 跨年回环标志: orchestrator 重新跑 GRAPH/ENTITY/PROFILE 时为 true */
  isLooping?: boolean
  /** 推演整体状态: 失败/取消时 current stage 需显示对应徽章 */
  runStatus?: 'failed' | 'cancelled' | 'idle' | 'paused' | 'running' | 'completed'
}

export function computeStageStatuses(input: ComputeInput): StageInfo[] {
  const { currentStage, completedStages, isLooping, runStatus } = input
  const completedSet = new Set(completedStages)
  return STAGE_ORDER.map((id, index) => {
    let status: StageStatus
    if (completedSet.has(id) && !(isLooping && id === currentStage)) {
      status = 'done'
    } else if (id === currentStage) {
      if (runStatus === 'failed') status = 'failed'
      else if (runStatus === 'cancelled') status = 'cancelled'
      else status = isLooping ? 'looping-active' : 'active'
    } else {
      status = 'pending'
    }
    return { id, index, status }
  })
}

/** 第 6 步 SIMULATION_RUNNING 的子进度 shape */
export interface SimulationSub {
  round: number
  totalRounds: number
  activeAgents: number
}
