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
    // must-tier v2: 重置实时事件队列
    marketEvents: [],
    recentShocks: [],
    yearAdvanced: null,
    reportRisks: [],
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

  // ---- must-tier v2: 新 SSE 事件 handler 测试 ----

  it('appendMarketEvent 推入队列, 保持最新 30 条 + 倒序 (新→旧)', () => {
    const { appendMarketEvent } = usePipelineStore.getState()
    // 推 35 条
    for (let i = 0; i < 35; i++) {
      appendMarketEvent({ type: 'M', description: `e${i}`, ts: 1000 + i })
    }
    const st = usePipelineStore.getState()
    expect(st.marketEvents).toHaveLength(30)  // 截断到 30
    expect(st.marketEvents[0].description).toBe('e34')  // 最新在前
    expect(st.marketEvents[29].description).toBe('e5')   // 最旧保留
  })

  it('appendShock 推入队列, 保持最新 5 条', () => {
    const { appendShock } = usePipelineStore.getState()
    for (let i = 0; i < 8; i++) {
      appendShock({ factor_name: `shock${i}`, severity: 0.5, ts: 1000 + i })
    }
    const st = usePipelineStore.getState()
    expect(st.recentShocks).toHaveLength(5)
    expect(st.recentShocks[0].factor_name).toBe('shock7')  // 最新
  })

  it('setYearAdvanced / clearYearAdvanced banner 显隐', () => {
    const { setYearAdvanced, clearYearAdvanced } = usePipelineStore.getState()
    expect(usePipelineStore.getState().yearAdvanced).toBeNull()
    setYearAdvanced({ year: 1, rounds_added: 12, ts: 1000 })
    expect(usePipelineStore.getState().yearAdvanced).toMatchObject({ year: 1, rounds_added: 12 })
    clearYearAdvanced()
    expect(usePipelineStore.getState().yearAdvanced).toBeNull()
  })

  it('SSE 收到 market_event → appendMarketEvent 触发', () => {
    usePipelineStore.getState().setRunId('r-sse-me')
    const es: any = (usePipelineStore.getState() as any)._sseRef
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'market_event', data: { type: 'MARKET_UP', industry: 'tech', gdp_growth: 0.8, description: '上涨' } },
      }),
    })
    const evs = usePipelineStore.getState().marketEvents
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ type: 'MARKET_UP', industry: 'tech', gdp_growth: 0.8 })
  })

  it('SSE 收到 shock_injected → appendShock 触发', () => {
    usePipelineStore.getState().setRunId('r-sse-sh')
    const es: any = (usePipelineStore.getState() as any)._sseRef
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'shock_injected', data: { factor_name: '汇率', severity: 0.9 } },
      }),
    })
    const sh = usePipelineStore.getState().recentShocks
    expect(sh).toHaveLength(1)
    expect(sh[0]).toMatchObject({ factor_name: '汇率', severity: 0.9 })
  })

  it('SSE 收到 year_advanced → setYearAdvanced + status 切回 completed', () => {
    usePipelineStore.setState({ status: 'running' } as any)
    usePipelineStore.getState().setRunId('r-sse-ya')
    const es: any = (usePipelineStore.getState() as any)._sseRef
    es.onmessage({
      data: JSON.stringify({
        type: 'live_event',
        event: { type: 'year_advanced', data: { year: 2, rounds_added: 12, status: 'completed' } },
      }),
    })
    const st = usePipelineStore.getState()
    expect(st.yearAdvanced).toMatchObject({ year: 2, rounds_added: 12 })
    expect(st.status).toBe('completed')
  })

  // ---- Agent 3A v2 N1/N2 — Bug #1 KG 修复验证 ----

  it('appendGraphNode 满容量时驱逐最低 density 节点', () => {
    usePipelineStore.setState({ graphCapacity: 1000 } as any)
    const s = usePipelineStore.getState()
    for (let i = 0; i < 500; i++) s.appendGraphNode({ id: `lo-${i}`, signal_density: 0.1 } as any)
    for (let i = 0; i < 500; i++) s.appendGraphNode({ id: `mid-${i}`, signal_density: 0.5 } as any)
    for (let i = 0; i < 500; i++) s.appendGraphNode({ id: `hi-${i}`, signal_density: 0.9 } as any)
    const ids = usePipelineStore.getState().graphNodes.map((n) => n.id)
    expect(ids.filter((id: string) => id.startsWith('lo-'))).toHaveLength(0)
    expect(ids.filter((id: string) => id.startsWith('hi-'))).toHaveLength(500)
    expect((usePipelineStore.getState().graphProgress as any).evicted).toBeGreaterThan(0)
  })

  it('appendGraphNode 未满时直接插入并维持降序', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'a', signal_density: 0.3 } as any)
    s.appendGraphNode({ id: 'b', signal_density: 0.9 } as any)
    s.appendGraphNode({ id: 'c', signal_density: 0.6 } as any)
    const ids = usePipelineStore.getState().graphNodes.map((n) => n.id)
    expect(ids).toEqual(['b', 'c', 'a'])
  })

  it('appendGraphNode incoming 密度不足时 overflow++', () => {
    usePipelineStore.setState({ graphCapacity: 1000 } as any)
    const s = usePipelineStore.getState()
    for (let i = 0; i < 1000; i++) {
      s.appendGraphNode({ id: `h-${i}`, signal_density: 0.9 } as any)
    }
    s.appendGraphNode({ id: 'low', signal_density: 0.1 } as any)
    expect((usePipelineStore.getState().graphProgress as any).overflow).toBe(1)
    expect(usePipelineStore.getState().graphNodes.find((n) => n.id === 'low')).toBeUndefined()
  })

  it('setGraphSnapshot_evicts: 一次填 1500 节点 -> 截断到 cap 并按 density 排序 (N1)', () => {
    usePipelineStore.setState({ graphCapacity: 1000 } as any)
    const s = usePipelineStore.getState()
    const nodes = Array.from({ length: 1500 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: i < 500 ? 0.1 : i < 1000 ? 0.5 : 0.9,
    })) as any
    s.setGraphSnapshot(nodes, [], undefined as any)
    const state = usePipelineStore.getState()
    expect(state.graphNodes).toHaveLength(1000)
    const densities = state.graphNodes.map((n) => (n as any).signal_density ?? 0.5)
    expect(densities.every((d: number) => d >= 0.5)).toBe(true)
    expect((state.graphProgress as any).evicted).toBe(500)
  })

  it('setGraphSnapshot 不超过 cap 时全收', () => {
    const s = usePipelineStore.getState()
    const nodes = Array.from({ length: 500 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: 0.5,
    })) as any
    s.setGraphSnapshot(nodes, [], undefined as any)
    expect(usePipelineStore.getState().graphNodes).toHaveLength(500)
    expect((usePipelineStore.getState().graphProgress as any).evicted).toBe(0)
  })

  it('setGraphCapacity 收缩时按 density evict', () => {
    const s = usePipelineStore.getState()
    const nodes = Array.from({ length: 800 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: i / 1000,
    })) as any
    s.setGraphSnapshot(nodes, [], undefined as any)
    s.setGraphCapacity(200)
    const state = usePipelineStore.getState()
    expect(state.graphNodes).toHaveLength(200)
    const minDensity = Math.min(...state.graphNodes.map((n) => (n as any).signal_density ?? 0))
    expect(minDensity).toBeGreaterThanOrEqual(0.6)
  })
})
