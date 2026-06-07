/**
 * 实时知识图谱显示功能测试 (G2 + G3 集成)
 *
 * 验证：启动推演后, 前端 store 能在 graph-snapshot 返回真实数据时被填充,
 * useGraphStream / useRoundStream 读 store 后能正确显示节点和边。
 *
 * 端到端 backend 测试在 backend/tests/integration/test_realtime_graph.py
 * (依赖 LLM, 慢 5+ 分钟)。本测试纯前端, mock http, 100ms 跑完。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock services/http
const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('../../services/http', () => ({
  default: {
    get: mockGet,
    post: mockPost,
  },
}))

// 动态 import 以确保 mock 先生效
const { usePipelineStore } = await import('../pipeline')
import { act } from 'react'

// 由于 vitest 无 @testing-library/react, 我们直接调 store action, 不通过 hook
// (hook 内部也直接调 store action, 行为一致)

describe('实时知识图谱 - 前端集成', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()  // 清 graphNodes/Edges/simRounds, 防测试间污染
  })

  it('启动推演 → store.runId 设置 → graphNodes/Edges 初始 [] (等待 hydrate)', async () => {
    mockPost.mockResolvedValueOnce({ data: { run_id: 'r-test-001' } })
    await act(async () => {
      const id = await usePipelineStore.getState().startPipeline({
        simulation_hours: 24,
        user_params: { years: 1, time_step: 'month' },
      } as any)
      expect(id).toBe('r-test-001')
    })

    const s = usePipelineStore.getState()
    expect(s.runId).toBe('r-test-001')
    expect(s.graphNodes).toEqual([])  // 初始空
  })

  it('hydrateFromRunId 拉 graph-snapshot → store.graphNodes 填满真实节点', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/pipeline/r-graph-1') {
        return Promise.resolve({
          data: {
            run_id: 'r-graph-1',
            status: 'completed',
            current_stage: 'REPORT_GENERATING',
            progress: 1.0,
          },
        })
      }
      if (url === '/pipeline/r-graph-1/graph-snapshot') {
        return Promise.resolve({
          data: {
            current_stage: 'COMPLETED',
            counts: { nodes: 3, edges: 2 },
            nodes: [
              { id: 'co_001', label: '湖北省数产集团', type: 'COMPANY' },
              { id: 'prod_001', label: '数字城市平台', type: 'PRODUCT' },
              { id: 'dept_001', label: '销售部', type: 'DEPARTMENT' },
            ],
            edges: [
              { id: 'e1', source: 'co_001', target: 'prod_001', type: 'OWNS' },
              { id: 'e2', source: 'co_001', target: 'dept_001', type: 'EMPLOYS' },
            ],
          },
        })
      }
      if (url === '/pipeline/r-graph-1/network-frames') {
        return Promise.resolve({
          data: { total_rounds: 12, current_round: 12, frames: [] },
        })
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    const ok = await usePipelineStore.getState().hydrateFromRunId('r-graph-1')
    expect(ok).toBe(true)

    const s = usePipelineStore.getState()
    expect(s.runId).toBe('r-graph-1')
    expect(s.graphNodes).toHaveLength(3)         // 关键: 3 个真实节点
    expect(s.graphEdges).toHaveLength(2)         // 2 条边
    expect(s.simRounds).toEqual([])              // frames 空, simRounds 不塞
    expect(s.graphProgress.nodes).toBe(3)
    expect(s.graphProgress.edges).toBe(2)
    expect(s.graphNodes[0].label).toBe('湖北省数产集团')
  })

  it('setGraphSnapshot 整批替换 (REST 补底用)', () => {
    // 模拟 store 已有旧数据
    usePipelineStore.setState({
      graphNodes: [{ id: 'old', label: 'Old' }] as any,
      graphEdges: [{ id: 'e' }] as any,
    })
    usePipelineStore.getState().setGraphSnapshot(
      [{ id: 'new1', label: 'New1' }, { id: 'new2', label: 'New2' }],
      [{ id: 'ne1', source: 'new1', target: 'new2' }],
      { phase: 'completed', nodes: 2, edges: 1 },
    )
    const s = usePipelineStore.getState()
    expect(s.graphNodes).toHaveLength(2)
    expect(s.graphNodes[0].id).toBe('new1')
    expect(s.graphEdges[0].source).toBe('new1')
    expect(s.graphProgress.phase).toBe('completed')
  })

  it('SSE live_event round_completed → simRounds 追加 (RealtimeNetworkGraph 渲染用)', () => {
    usePipelineStore.getState().setRunId('r-sse')
    const es: any = (usePipelineStore.getState() as any)._sseRef
    expect(es).toBeTruthy()

    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'round_completed', data: { round: 1, actions_count: 7, total_rounds: 12 } },
      }),
    })
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'round_completed', data: { round: 2, actions_count: 9, total_rounds: 12 } },
      }),
    })

    const rounds = usePipelineStore.getState().simRounds
    expect(rounds).toHaveLength(2)
    expect(rounds[0].round).toBe(1)
    expect(rounds[0].actions_count).toBe(7)
    expect(rounds[1].round).toBe(2)
  })

  it('同 round 重复 emit → simRounds 去重 (前端不会被 SSE 重放干扰)', () => {
    usePipelineStore.getState().setRunId('r-dup')
    const es: any = (usePipelineStore.getState() as any)._sseRef

    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'round_completed', data: { round: 1, actions_count: 5 } },
      }),
    })
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'round_completed', data: { round: 1, actions_count: 7 } },  // 同 round 重复
      }),
    })

    const rounds = usePipelineStore.getState().simRounds
    expect(rounds).toHaveLength(1)
    expect(rounds[0].actions_count).toBe(5)  // 保留先来的
  })

  it('resetGraphStream 清空 (切 run 时重置)', () => {
    usePipelineStore.setState({
      graphNodes: [{ id: 'a' }] as any,
      graphEdges: [{ id: 'e' }] as any,
      simRounds: [{ round: 1 }] as any,
    })
    usePipelineStore.getState().resetGraphStream()
    const s = usePipelineStore.getState()
    expect(s.graphNodes).toEqual([])
    expect(s.graphEdges).toEqual([])
    expect(s.simRounds).toEqual([])
  })

  it('startPipeline 重置上一 run 的图数据 (避免残留)', async () => {
    usePipelineStore.setState({
      runId: 'r-old',
      graphNodes: [{ id: 'old' }] as any,
      graphEdges: [{ id: 'e' }] as any,
      simRounds: [{ round: 1 }] as any,
    })

    mockPost.mockResolvedValueOnce({ data: { run_id: 'r-new' } })
    await act(async () => {
      await usePipelineStore.getState().startPipeline({ simulation_hours: 24 } as any)
    })

    const s = usePipelineStore.getState()
    expect(s.runId).toBe('r-new')
    expect(s.graphNodes).toEqual([])
    expect(s.graphEdges).toEqual([])
    expect(s.simRounds).toEqual([])
  })
})
