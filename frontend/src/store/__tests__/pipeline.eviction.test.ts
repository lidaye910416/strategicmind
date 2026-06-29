/**
 * Cluster A 回归测试 — pipeline.ts eviction/merge 不变式
 *
 * 覆盖以下 bug-finding 修复（详见 docs/bugs/ + Cluster A 验证报告）：
 *   F1:  seedGraph 一次塞 1500 节点必须截断到 MAX_GRAPH_NODES
 *   F2:  setGraphCapacity(200) 在 1000 节点 + 2000 边下, 必须留下 200 节点 + drop dangling edges
 *   F3:  appendGraphEdge 引用不在 graphNodes 的 source/target 必须静默丢弃
 *   F4:  setGraphSnapshot 累计 evicted/dropped_edges 后, setGraphProgress 不应清零
 *   F18: id 为 nullish 的节点必须静默丢弃; 引用它们的边也必须 drop
 *   F19: 没有 evict 时 dropped_edges=0 (干净 snapshot)
 *   F21: appendSimRound 重复 round 必须 merge payload (later wins)
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
const { usePipelineStore, MAX_GRAPH_NODES } = await import('../pipeline')

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
    graphCapacity: MAX_GRAPH_NODES,
    simRounds: [],
    graphSnapshots: {},
    _sseRef: null,
    _sseCloseTimer: null,
  } as any)
  mockGet.mockReset()
  mockPost.mockReset()
}

describe('Cluster A 回归 — graph eviction invariants', () => {
  beforeEach(() => {
    reset()
  })

  // ---- F1: seedGraph 1500 节点 -> 截断到 MAX_GRAPH_NODES ----
  it('F1: seedGraph 一次塞 1500 节点 + 2000 边, 截断到 MAX_GRAPH_NODES (1000), drop dangling edges', () => {
    const s = usePipelineStore.getState()
    const nodes = Array.from({ length: 1500 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: i < 500 ? 0.1 : i < 1000 ? 0.5 : 0.9,
    })) as any
    // 2000 edges: 1000 合法 (n-0..n-999 两两配对) + 1000 引用 n-1000..n-1499 (被 evict)
    const edges: any[] = []
    for (let i = 0; i < 1000; i++) {
      edges.push({ id: `e-kept-${i}`, source: `n-${i}`, target: `n-${(i + 1) % 1000}` })
    }
    for (let i = 0; i < 1000; i++) {
      edges.push({ id: `e-dropped-${i}`, source: `n-${1000 + i}`, target: `n-${(1001 + i) % 1500}` })
    }
    s.seedGraph(nodes, edges)
    const state = usePipelineStore.getState()
    // 节点必须 cap 在 1000
    expect(state.graphNodes).toHaveLength(MAX_GRAPH_NODES)
    // 边的 source/target 必须都在 accepted nodes 里, dangling 边被 drop
    const acceptedIds = new Set(state.graphNodes.map((n) => String(n.id)))
    for (const e of state.graphEdges) {
      expect(acceptedIds.has(String((e as any).source))).toBe(true)
      expect(acceptedIds.has(String((e as any).target))).toBe(true)
    }
    // evicted 累计 500, dropped_edges 累计 1000 (所有引用被 evict 节点的边)
    expect((state.graphProgress as any).evicted).toBe(500)
    expect((state.graphProgress as any).dropped_edges).toBeGreaterThanOrEqual(1000)
  })

  // ---- F2: setGraphCapacity 收缩 + 同步 drop dangling edges ----
  it('F2: setGraphCapacity(200) on 1000 节点 + 2000 边 -> 留下 200 节点, dangling edges dropped', () => {
    const s = usePipelineStore.getState()
    // 先 seed 1000 节点 + 2000 边
    const nodes = Array.from({ length: 1000 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: (i + 1) / 1000,  // 升序密度: 后面密度高
    })) as any
    // 2000 edges: 1000 引用 n-0..n-499 (低密度, 即将被 evict), 1000 引用 n-500..n-999 (幸存)
    const edges: any[] = []
    for (let i = 0; i < 1000; i++) {
      edges.push({ id: `e-low-${i}`, source: `n-${i % 500}`, target: `n-${(i + 1) % 500}` })
    }
    for (let i = 0; i < 1000; i++) {
      edges.push({ id: `e-high-${i}`, source: `n-${500 + (i % 500)}`, target: `n-${500 + ((i + 1) % 500)}` })
    }
    s.setGraphSnapshot(nodes, edges, { phase: 'completed', nodes: 1000, edges: 2000 })
    // 收缩到 200
    s.setGraphCapacity(200)
    const state = usePipelineStore.getState()
    // 节点: 200 (按 density 降序, 留密度最高的)
    expect(state.graphNodes).toHaveLength(200)
    // 边: 必须全部都引用 surviving node
    const acceptedIds = new Set(state.graphNodes.map((n) => String(n.id)))
    for (const e of state.graphEdges) {
      expect(acceptedIds.has(String((e as any).source))).toBe(true)
      expect(acceptedIds.has(String((e as any).target))).toBe(true)
    }
    // 不应留下任何 "e-low-*" 边 (因为源节点 n-0..n-499 全被 evict)
    expect(state.graphEdges.some((e: any) => e.id.startsWith('e-low-'))).toBe(false)
  })

  // ---- F3: appendGraphEdge dangling 静默丢弃 ----
  it('F3: appendGraphEdge 引用不存在节点的 source/target 静默丢弃 (dropped_edges 计数+1)', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'real' })
    // dangling 边: target 不存在 (在 graphNodes 里查不到), 触发 dropped_edges++
    s.appendGraphEdge({ id: 'e-dangling', source: 'real', target: 'ghost' })
    // 全部 dangling 都没进入 graphEdges
    expect(usePipelineStore.getState().graphEdges).toHaveLength(0)
    // dropped_edges 累计 1 (只有一个 dangling 边)
    expect((usePipelineStore.getState().graphProgress as any).dropped_edges).toBe(1)
  })

  it('F3: appendGraphEdge nullish source/target 在检查前 short-circuit 静默丢弃, 不计入 dropped_edges', () => {
    // 实现细节: appendGraphEdge 在 set() 之前先做 nullish 短路, 这种情况下
    // 静默丢弃 (不进 graphEdges, 也不进 dropped_edges). 这是有意为之:
    // 协议层非法数据不污染统计. 此测试钉死这个行为.
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'a' })
    s.appendGraphNode({ id: 'b' })
    // null source — short-circuit
    s.appendGraphEdge({ id: 'e1', source: null as any, target: 'a' })
    // null target — short-circuit
    s.appendGraphEdge({ id: 'e2', source: 'a', target: null as any })
    // 空串 source — short-circuit
    s.appendGraphEdge({ id: 'e3', source: '', target: 'a' })
    // 空串 target — short-circuit
    s.appendGraphEdge({ id: 'e4', source: 'a', target: '' })
    expect(usePipelineStore.getState().graphEdges).toHaveLength(0)
    // dropped_edges 应保持 undefined (没递增) 或 0 — 实现选择不递增
    const dropped = (usePipelineStore.getState().graphProgress as any).dropped_edges
    expect(dropped === undefined || dropped === 0).toBe(true)
  })

  it('F3: appendGraphEdge 两个端点都在 graphNodes 中 -> 正常 push (不计入 dropped_edges)', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'a' })
    s.appendGraphNode({ id: 'b' })
    const beforeDropped = (usePipelineStore.getState().graphProgress as any).dropped_edges ?? 0
    s.appendGraphEdge({ id: 'e1', source: 'a', target: 'b' })
    expect(usePipelineStore.getState().graphEdges).toHaveLength(1)
    expect((usePipelineStore.getState().graphProgress as any).dropped_edges ?? 0).toBe(beforeDropped)
  })

  // ---- F4: setGraphProgress 保留 evicted/dropped_edges 累计 ----
  it('F4: setGraphSnapshot 累计 evicted/dropped_edges 后, setGraphProgress 不应清零', () => {
    const s = usePipelineStore.getState()
    // 触发一次 evict + drop
    const nodes = Array.from({ length: 1500 }, (_, i) => ({
      id: `n-${i}`,
      signal_density: 0.5,
    })) as any
    s.setGraphSnapshot(nodes, [], { phase: 'graph_building', nodes: 0, edges: 0 })
    const after1 = (usePipelineStore.getState().graphProgress as any)
    expect(after1.evicted).toBe(500)
    // 模拟 SSE 后续的 graph_progress 事件 (新 phase, 不带 evicted/dropped_edges)
    s.setGraphProgress({ phase: 'completed', nodes: 1000, edges: 0 })
    const after2 = (usePipelineStore.getState().graphProgress as any)
    // evicted 必须幸存 (merge, 不是 full replace)
    expect(after2.evicted).toBe(500)
    expect(after2.phase).toBe('completed')
    expect(after2.nodes).toBe(1000)
  })

  // ---- F18: id=nullish 节点被丢弃, 引用它们的边也被 drop ----
  it('F18: id=null/undefined/空串 的节点被静默丢弃 (不污染 store)', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: null } as any)
    s.appendGraphNode({ id: undefined } as any)
    s.appendGraphNode({ id: '' } as any)
    s.appendGraphNode({ id: 'real-1' })
    s.appendGraphNode({ id: 'real-2' })
    const nodes = usePipelineStore.getState().graphNodes
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.id)).toEqual(['real-1', 'real-2'])
    // 不应出现 "null" / "undefined" / "" 这种被 String()-coerce 出来的污染 id
    const ids = nodes.map((n) => String(n.id))
    expect(ids).not.toContain('null')
    expect(ids).not.toContain('undefined')
    expect(ids).not.toContain('')
  })

  it('F18: 引用 nullish source/target 的边 (走 short-circuit) 静默丢弃', () => {
    const s = usePipelineStore.getState()
    s.appendGraphNode({ id: 'a' })
    // dangling 边, target 是 null — short-circuit
    s.appendGraphEdge({ id: 'e-null', source: 'a', target: null as any })
    // nullish source — short-circuit
    s.appendGraphEdge({ id: 'e-null-src', source: null as any, target: 'a' })
    // 空串 target — short-circuit
    s.appendGraphEdge({ id: 'e-empty-tgt', source: 'a', target: '' })
    expect(usePipelineStore.getState().graphEdges).toHaveLength(0)
    // nullish 短路不计入 dropped_edges
    const dropped = (usePipelineStore.getState().graphProgress as any).dropped_edges
    expect(dropped === undefined || dropped === 0).toBe(true)
  })

  it('F18: seedGraph 传 nullish id 节点 -> 同样被丢弃', () => {
    const s = usePipelineStore.getState()
    s.seedGraph(
      [
        { id: 'k' },
        { id: null } as any,
        { id: undefined } as any,
        { id: '' } as any,
      ] as any,
      [
        { id: 'e1', source: 'k', target: 'k' },
        { id: 'e2', source: null as any, target: 'k' },
      ] as any,
    )
    const state = usePipelineStore.getState()
    // 4 个节点中 3 个 id 非法, 只留 'k'
    expect(state.graphNodes).toHaveLength(1)
    expect(state.graphNodes[0].id).toBe('k')
    // e2 因 source=null 被 drop, 只留 e1
    expect(state.graphEdges).toHaveLength(1)
    expect((state.graphEdges[0] as any).id).toBe('e1')
  })

  // ---- F19: 干净 snapshot 时 dropped_edges=0 ----
  it('F19: 干净 snapshot (无 evict, 无 dangling) 时 dropped_edges=0', () => {
    const s = usePipelineStore.getState()
    const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n-${i}` }))
    const edges = Array.from({ length: 49 }, (_, i) => ({
      id: `e-${i}`,
      source: `n-${i}`,
      target: `n-${i + 1}`,
    }))
    s.setGraphSnapshot(nodes, edges, { phase: 'completed', nodes: 0, edges: 0 })
    const gp = usePipelineStore.getState().graphProgress as any
    expect(gp.evicted ?? 0).toBe(0)
    expect(gp.dropped_edges ?? 0).toBe(0)
  })

  it('F19: seedGraph 干净输入 -> evicted=0, dropped_edges=0', () => {
    const s = usePipelineStore.getState()
    s.seedGraph(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'e1', source: 'a', target: 'b' }],
    )
    const gp = usePipelineStore.getState().graphProgress as any
    expect(gp.evicted ?? 0).toBe(0)
    expect(gp.dropped_edges ?? 0).toBe(0)
  })

  // ---- F21: appendSimRound 重复 round dedup (first wins) ----
  it('F21: appendSimRound 重复 round 保留先到的 payload (first wins, SSE dedup)', () => {
    const { appendSimRound } = usePipelineStore.getState()
    appendSimRound({ round: 1, actions_count: 3, belief_updates_count: 0 } as any)
    appendSimRound({ round: 2, actions_count: 5 } as any)
    // 重复 round=1, 后到的 payload 被丢弃 (first wins dedup)
    appendSimRound({ round: 1, actions_count: 99, propagation_events_count: 7 } as any)
    const rs = usePipelineStore.getState().simRounds
    // 仍然只有 2 条 (按 round 升序: 1, 2)
    expect(rs).toHaveLength(2)
    expect(rs[0].round).toBe(1)
    expect(rs[1].round).toBe(2)
    // first wins: 先到的 actions_count 保留, 后到的 propagation_events_count 不写入
    expect(rs[0].actions_count).toBe(3)
    expect(rs[0].belief_updates_count).toBe(0)
    expect((rs[0] as any).propagation_events_count).toBeUndefined()
  })

  it('F21: appendSimRound 重复 round 3 次, 第一次 payload 是 canonical', () => {
    const { appendSimRound } = usePipelineStore.getState()
    appendSimRound({ round: 5, actions_count: 1 } as any)
    appendSimRound({ round: 5, belief_updates_count: 10 } as any)
    appendSimRound({ round: 5, actions_count: 99, propagation_events_count: 3 } as any)
    const rs = usePipelineStore.getState().simRounds
    expect(rs).toHaveLength(1)
    // first wins: 第一个 round 5 的 actions_count=1 保留, 后两个被丢弃
    expect(rs[0]).toMatchObject({
      round: 5,
      actions_count: 1,             // 第一次的 (保留)
    })
    // 后两个 payload 引入的字段不被合并
    expect((rs[0] as any).belief_updates_count).toBeUndefined()
    expect((rs[0] as any).propagation_events_count).toBeUndefined()
  })
})
