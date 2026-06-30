/**
 * useRoundStream - 从 worldState 派生 RoundStreamSnapshot.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePipelineStore } from '../../pipeline'
import { useRoundStream } from '../useRoundStream'

describe('useRoundStream', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      worldState: null,
    } as any)
  })

  it('returns default snapshot when worldState is null', () => {
    const { result } = renderHook(() => useRoundStream())
    expect(result.current).toEqual({
      currentRound: 0,
      totalRounds: 12,
      simulatedHours: 0,
      simulatedLabel: '',
      actionsThisRound: 0,
      nodesAddedThisRound: 0,
      edgesAddedThisRound: 0,
    })
  })

  it('returns snapshot from worldState when set', () => {
    usePipelineStore.setState({
      worldState: {
        round_num: 3,
        total_rounds: 12,
        simulated_hours_elapsed: 2160,
        simulated_label: 'Month 3',
        actions_this_round: 4,
        nodes_added: 5,
        edges_added: 7,
      },
    } as any)

    const { result } = renderHook(() => useRoundStream())
    expect(result.current.currentRound).toBe(3)
    expect(result.current.simulatedLabel).toBe('Month 3')
    expect(result.current.nodesAddedThisRound).toBe(5)
    expect(result.current.simulatedHours).toBe(2160)
  })

  it('falls back to 0 when new fields missing (backward compat)', () => {
    usePipelineStore.setState({
      worldState: {
        round_num: 2,
        total_rounds: 10,
        // 老 run 没新字段
      },
    } as any)

    const { result } = renderHook(() => useRoundStream())
    expect(result.current.simulatedLabel).toBe('')
    expect(result.current.nodesAddedThisRound).toBe(0)
    expect(result.current.edgesAddedThisRound).toBe(0)
  })
})