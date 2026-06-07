/**
 * pipeline store 单元测试
 *
 * 覆盖：
 *   - startPipeline 首行 set isStarting=true（P0-9 反馈）
 *   - appendGraphNode / appendSimRound 按 id/round 去重
 *   - setGraphSnapshot 整批替换
 *   - resetGraphStream 清空
 *   - advanceYear dispatch POST /advance-year
 *   - hydrateFromRunId 拉图谱 + 推演回合
 *   - SSE onmessage 直接派发 round_completed live_event
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock http 模块（store 内部用）
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

function reset() {
  usePipelineStore.setState({
    runId: null,
    status: 'idle',
    currentStage: 'IDLE',
    progress: 0,
    error: null,
    snapshot: null,
    isStarting: false,
    lastEventAt: 0,
    lastRunConfig: null,
    graphNodes: [],
    graphEdges: [],
    graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
    simRounds: [],
    _sseRef: null,
    _sseCloseTimer: null,
  } as any)
  mockGet.mockReset()
  mockPost.mockReset()
}

describe('usePipelineStore', () => {
  beforeEach(() => {
    reset()
  })

  it('startPipeline 首行就 set isStarting=true（P0-9 反馈）', async () => {
    // 让 http.post 永远 pending，以观察首行 setState
    let resolvePost!: (v: any) => void
    mockPost.mockImplementationOnce(
      () => new Promise((res) => { resolvePost = res }),
    )
    const p = usePipelineStore.getState().startPipeline({ foo: 1 })
    // 等待 microtask 让同步 setState 完成
    await Promise.resolve()
    expect(usePipelineStore.getState().isStarting).toBe(true)
    expect(usePipelineStore.getState().status).toBe('running')
    expect(usePipelineStore.getState().currentStage).toBe('SEED_PARSING')
    // 收尾：resolve post
    resolvePost({ data: { run_id: 'r1' } })
    await p
  })

  it('appendGraphNode 同 id 节点去重', () => {
    const { appendGraphNode } = usePipelineStore.getState()
    appendGraphNode({ id: 'n1', label: 'A' })
    appendGraphNode({ id: 'n1', label: 'A-dup' })  // 同 id
    appendGraphNode({ id: 'n2', label: 'B' })
    const nodes = usePipelineStore.getState().graphNodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0].label).toBe('A')  // 保留先来位置
  })

  it('appendSimRound 同 round 去重', () => {
    const { appendSimRound } = usePipelineStore.getState()
    appendSimRound({ round: 1, actions_count: 5 })
    appendSimRound({ round: 1, actions_count: 99 })  // 同 round
    appendSimRound({ round: 2, actions_count: 3 })
    const rs = usePipelineStore.getState().simRounds
    expect(rs).toHaveLength(2)
    expect(rs[0].actions_count).toBe(5)  // 保留先来
    expect(rs.map((r) => r.round).sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('setGraphSnapshot 整批 seed → 完全替换 graphNodes/Edges', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'old' })
    s.appendGraphEdge({ source: 'a', target: 'b' })

    s.setGraphSnapshot(
      [{ id: 'n1' }, { id: 'n2' }],
      [{ id: 'e1', source: 'n1', target: 'n2' }],
      { phase: 'completed', nodes: 2, edges: 1 },
    )
    const st = usePipelineStore.getState()
    expect(st.graphNodes).toHaveLength(2)
    expect(st.graphEdges).toHaveLength(1)
    expect(st.graphNodes.map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('resetGraphStream 清空 graphNodes/Edges/simRounds', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'n1' })
    s.appendSimRound({ round: 1 })
    s.resetGraphStream()
    const st = usePipelineStore.getState()
    expect(st.graphNodes).toEqual([])
    expect(st.graphEdges).toEqual([])
    expect(st.simRounds).toEqual([])
    expect(st.graphProgress.phase).toBe('idle')
  })

  it('advanceYear(1) → http.post 收到 /advance-year', async () => {
    usePipelineStore.setState({ runId: 'r-1' } as any)
    mockPost.mockResolvedValueOnce({
      data: { run_id: 'r-1', year_offset: 1, rounds_to_run: 12, status: 'running' },
    })
    const r = await usePipelineStore.getState().advanceYear(1)
    expect(mockPost).toHaveBeenCalledWith('/pipeline/r-1/advance-year', { year_offset: 1 })
    expect(r).toMatchObject({ year_offset: 1, rounds_to_run: 12 })
  })

  it('hydrateFromRunId 拉 snapshot + graph-snapshot + network-frames，填满 store', async () => {
    // 1) /pipeline/<id>
    mockGet.mockImplementation((url: string) => {
      if (url === '/pipeline/r-7') {
        return Promise.resolve({ data: { run_id: 'r-7', status: 'running', current_stage: 'SIMULATION_RUNNING', progress: 0.4 } })
      }
      if (url === '/pipeline/r-7/graph-snapshot') {
        return Promise.resolve({ data: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1', source: 'a', target: 'b' }] } })
      }
      if (url === '/pipeline/r-7/network-frames') {
        return Promise.resolve({ data: { total_rounds: 2, frames: [{ round_num: 1, actions_count: 3 }, { round_num: 2, actions_count: 4 }] } })
      }
      return Promise.reject(new Error('unexpected url ' + url))
    })
    const ok = await usePipelineStore.getState().hydrateFromRunId('r-7')
    expect(ok).toBe(true)
    const st = usePipelineStore.getState()
    expect(st.runId).toBe('r-7')
    expect(st.status).toBe('running')
    expect(st.graphNodes).toHaveLength(2)
    expect(st.graphEdges).toHaveLength(1)
    expect(st.simRounds).toHaveLength(2)
    expect(mockGet).toHaveBeenCalledTimes(3)
  })

  it('SSE onmessage 收到 live_event round_completed → simRounds 增加', () => {
    // 直接 new EventSource 拿 onmessage 句柄派发事件
    // (test-setup.ts 已经把 EventSource mock 成一个可手动触发的类)
    usePipelineStore.getState().setRunId('r-sse')
    const es: any = (usePipelineStore.getState() as any)._sseRef
    expect(es).toBeTruthy()
    // 派发 live_event
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'round_completed', data: { round: 1, actions_count: 7 } },
      }),
    })
    const rounds = usePipelineStore.getState().simRounds
    expect(rounds).toHaveLength(1)
    expect(rounds[0].round).toBe(1)
    expect(rounds[0].actions_count).toBe(7)
  })
})
