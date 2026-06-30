/**
 * useRoundStream - 从 worldState 派生 RoundStreamSnapshot.
 *
 * 数据源: usePipelineStore.worldState (LoopEngine emit 的 round_completed event 写入).
 * 向后兼容: worldState 缺新字段时返回 0 / '' 默认值.
 */
import { usePipelineStore } from '../pipeline'

export interface RoundStreamSnapshot {
  currentRound: number
  totalRounds: number
  simulatedHours: number
  simulatedLabel: string
  actionsThisRound: number
  nodesAddedThisRound: number
  edgesAddedThisRound: number
}

export function useRoundStream(): RoundStreamSnapshot {
  const worldState = usePipelineStore((s: any) => s.worldState)
  return {
    currentRound: worldState?.round_num ?? 0,
    totalRounds: worldState?.total_rounds ?? 12,
    simulatedHours: worldState?.simulated_hours_elapsed ?? 0,
    simulatedLabel: worldState?.simulated_label ?? '',
    actionsThisRound: worldState?.actions_this_round ?? 0,
    nodesAddedThisRound: worldState?.nodes_added ?? 0,
    edgesAddedThisRound: worldState?.edges_added ?? 0,
  }
}