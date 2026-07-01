/**
 * useRoundStream - 从 worldState 派生 RoundStreamSnapshot.
 *
 * 数据源: usePipelineStore.worldState (LoopEngine emit 的 round_completed event 写入).
 * 向后兼容: worldState 缺新字段时返回 0 / '' 默认值.
 */
import { shallow } from 'zustand/shallow'
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
  return usePipelineStore(
    (s) => ({
      currentRound: s.worldState?.round_num ?? 0,
      totalRounds: s.worldState?.total_rounds ?? 12,
      simulatedHours: s.worldState?.simulated_hours_elapsed ?? 0,
      simulatedLabel: s.worldState?.simulated_label ?? '',
      actionsThisRound: s.worldState?.actions_this_round ?? 0,
      nodesAddedThisRound: s.worldState?.nodes_added ?? 0,
      edgesAddedThisRound: s.worldState?.edges_added ?? 0,
    }),
    shallow,
  )
}