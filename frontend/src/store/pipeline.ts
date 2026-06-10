/**
 * Pipeline global state (Zustand) — 唯一 source of truth。
 *
 * 设计目标：
 *   - Dashboard / Workbench / LiveRunPanel 共享同一份 run 状态
 *   - URL 变化（/workbench/:runId）能自动 hydrate 进 store
 *   - SSE 事件全应用分发
 *
 * 来源：C3 P0 #2 + C1 C-01~08 融合
 *   - (a) 字段化 _sseRef + dispose action
 *   - (b) setTimeout 句柄存 ref 可取消
 *   - (c) 5 个 atomic selector hooks（避免整树 re-render）
 *   - (d) uploads: Map<id, UploadItem> + isStarting 首行设置
 *   - (e) lastEventAt 字段 + 5s 静默检测
 *
 * Implements: US-061, US-062
 */
import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import http from '../services/http'
import { formatErrorMessage } from '../lib/formatError'
import { computeStageStatuses, type StageInfo as StageInfoType } from '../components/Workbench/stageProgress'
// Re-export usePipelineEvent (定义在 lib/hooks) 供业务组件统一从 store 导入
export { usePipelineEvent, type PipelineEvent } from '../lib/hooks/usePipelineEvent'

export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

/**
 * Hard caps to keep the realtime graph renderable.
 * - MAX_GRAPH_NODES: d3-force 官方推荐实时布局 < 1000 节点。超出后静默丢弃，
 *   避免 (a) store 内存爆掉 (b) SSE 风暴 (c) React/D3 每帧二次方 render 卡死。
 * - MAX_GRAPH_SNAPSHOTS: 保留最近 12 轮 (1 年 × month) 的快照用于回放。
 */
export const MAX_GRAPH_NODES = 1000
export const MAX_GRAPH_SNAPSHOTS = 12

export interface RunSnapshot {
  run_id: string
  status: PipelineStatus | string
  current_stage: string
  progress: number
  config?: Record<string, any>
  completed_stages?: string[]
  artifacts?: Record<string, any>
  error?: string | null
  started_at?: number
  updated_at?: number
  // 辅助字段（从 artifacts.SIMULATION_RUNNING 提取）
  current_round?: number
  total_rounds?: number
  active_agents?: number
}

export interface UploadItem {
  id: string
  docId: string
  filename: string
}

// ============================================================================
// 实时图谱 / 推演回合数据类型（FE2/FE3 消费方）
// ============================================================================

/** 图谱节点 (实体) */
export interface GraphNodeData {
  id: string
  label?: string
  name?: string
  type?: string
  entity_type?: string
  /** 影响力权重 (0-1)，Agent 推演节点用；普通实体可不填默认 0.5 */
  influence?: number
  /** 来源 (seed / emergence / rest_snapshot) */
  source?: string
  /** 涌现轮次（仅 emergence 来源的节点用） */
  round?: number
  properties?: Record<string, any>
  // 布局位置（d3-force 自实现力布局 / 自实现 rAF 布局 维护）
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

/** 图谱边 (关系) */
export interface GraphEdgeData {
  /** 缺省时由 `${source}->${target}` 生成 */
  id?: string
  source: string
  target: string
  type?: string
  relation?: string
  weight?: number
  /** 涌现轮次 */
  round?: number
  properties?: Record<string, any>
}

/** 图谱构建阶段进度 */
export interface GraphProgress {
  phase: 'idle' | 'starting' | 'graph_building' | 'completed' | 'failed' | string
  nodes: number
  edges: number
  delta_nodes?: number
  delta_edges?: number
  new_entities?: GraphNodeData[]
  new_relations?: GraphEdgeData[]
  current_doc?: string
  error?: string
}

/** 推演单轮（SimulationLoop 每轮 emit 的快照） */
export interface SimRound {
  round: number
  total_rounds?: number
  progress?: number
  actions_count?: number
  belief_updates_count?: number
  belief_shift_count?: number
  propagation_events_count?: number
  active_agents?: string[] | number  // 兼容 string[] (ids) 和 number (count)
  ts?: number
  // 详情（可选）
  actions?: any[]
  belief_updates?: any[]
  propagation_events?: any[]
  /** 兼容旧字段名（FE2 useRoundStream 派生 propagation_edges 用） */
  propagation_edges?: any[]
  // 涌现（可选）
  new_entities?: GraphNodeData[]
  new_relations?: GraphEdgeData[]
}

// ============================================================================
// must-tier v2: 实时事件类型（市场/冲击/跨年）
// ============================================================================

/** 市场事件（ExternalShockSimulator emit） */
export interface MarketEvent {
  type: string             // e.g. "MARKET_DOWN", "INDUSTRY_BOOM"
  industry?: string        // 行业
  gdp_growth?: number      // GDP 增长率 (%)
  cycle_label?: string     // 周期阶段 (e.g. "EXPANSION")
  ts: number               // 时间戳 (ms)
  /** 事件描述（中文友好） */
  description?: string
}

/** 外部冲击（shock_injected） */
export interface ShockEvent {
  factor_name: string      // 因素名
  severity: number         // 严重度 (0-1)
  ts: number               // 时间戳 (ms)
  description?: string
}

/** 跨年推演完成（year_advanced） */
export interface YearAdvancedEvent {
  year: number             // 推进到的年份
  rounds_added: number     // 本轮新增回合数
  entities_count?: number  // 新涌现实体数
  ts: number
}

/** 信念漂移事件（belief_shift） */
export interface BeliefShiftEvent {
  round: number
  agent_id: string
  topic?: string
  old_value?: number | null
  new_value?: number | null
  delta: number            // magnitude
  magnitude?: number
  ts: number
}

/** 风险条目（必须 v1 风险矩阵热力图） */
export interface RiskItem {
  name: string
  probability: number      // 0-1
  impact: number           // 0-1
  category: string
  mitigation_strategies?: string[]
}

interface PipelineState {
  // 核心 run 状态
  runId: string | null
  status: PipelineStatus
  currentStage: string
  progress: number
  error: string | null
  uploadedDocIds: string[]
  // 完整后端快照（artifacts / completed_stages 等）
  snapshot: RunSnapshot | null
  // UI 标志
  isStarting: boolean
  // 上传区（从 Dashboard 同步到 Workbench 不丢失）
  uploads: Map<string, UploadItem>
  // SSE 静默检测：上次收到事件的时间戳（ms）
  lastEventAt: number
  // P3-A: 最近一次启动推演时的 config（含 user_params），Workbench 用以读取真实配置
  lastRunConfig: Record<string, unknown> | null

  // ---- 实时图谱 / 推演回合数据（FE2/FE3 SSE 消费方） ----
  /** 当前 run 的知识图谱节点数组。SSE entity_emerged 增量追加；REST /graph-snapshot 整批 seed */
  graphNodes: GraphNodeData[]
  /** 当前 run 的知识图谱边数组 */
  graphEdges: GraphEdgeData[]
  /** GRAPH_BUILDING 阶段进度（含 phase/nodes/edges/new_entities/new_relations） */
  graphProgress: GraphProgress
  /** 推演回合数组（按 round 升序）。SSE round_completed 追加；REST /network-frames 整批 seed */
  simRounds: SimRound[]
  /** feature2 (GraphDiff): 每轮推演结束时的图谱快照 (round → { nodes, edges }) */
  graphSnapshots: Record<number, { nodes: GraphNodeData[]; edges: GraphEdgeData[] }>

  // ---- must-tier v2: 实时事件队列（市场/冲击/跨年） ----
  /** 市场事件流（最多 30 条） */
  marketEvents: MarketEvent[]
  /** 最近的外部冲击（最多 5 条） */
  recentShocks: ShockEvent[]
  /** 跨年推演完成信息（null = 未触发） */
  yearAdvanced: YearAdvancedEvent | null
  /** should-tier: 最近一条市场事件的完整 payload (供 MarketEnvPulse 仪表盘展示) */
  latestMarketEvent: MarketEvent | null
  /** should-tier: 当前活动冲击（3s 后自动消失, 区别于 recentShocks 长队列） */
  activeShock: ShockEvent | null
  /** should-tier: 信念漂移流（最近 30 条, BeliefShiftFeed 消费） */
  beliefShifts: BeliefShiftEvent[]
  /** should-tier: 最近一次 round_started 横幅 (1s 后自动清空) */
  roundStartedBanner: { round: number; total_rounds?: number; ts: number } | null
  /** must-tier v1: 报告风险矩阵（从 snapshot.artifacts.REPORT_GENERATING.risks 派生） */
  reportRisks: RiskItem[]

  // ---- SSE 内部句柄（不暴露在公共 state，但放到 store 里便于 dispose 协同） ----
  _sseRef: EventSource | null
  _sseCloseTimer: number | null

  // ---- Atomic actions（细粒度，避免整树 re-render） ----
  startPipeline: (config: Record<string, unknown>) => Promise<string | null>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  /** P4 LOOP (G5): 再推 1 年 — 仅 completed/failed run 可用 */
  advanceYear: (yearOffset?: number) => Promise<{ run_id: string; year_offset: number; rounds_to_run: number; status: string } | null>
  reset: () => void
  setProgress: (stage: string, progress: number) => void
  setStatus: (status: PipelineStatus) => void
  setRunId: (runId: string | null) => void
  setSnapshot: (snap: RunSnapshot) => void
  hydrateFromRunId: (runId: string, signal?: AbortSignal, active?: boolean) => Promise<boolean>  // 加载历史 run (F2: active flag 防止 StrictMode 双挂载幽灵写入)
  addUploadedDoc: (docId: string) => void
  addUpload: (item: UploadItem) => void
  removeUpload: (id: string) => void
  clearUploads: () => void
  dispose: () => void

  // ---- 图谱 / 推演回合 actions（FE2/FE3） ----
  /** 兼容旧 API：FE2 RealtimeKnowledgeGraph 用 seedGraph(rawNodes, rawEdges) */
  seedGraph: (nodes: GraphNodeData[], edges: GraphEdgeData[]) => void
  /** 整批 seed 当前 run 的图谱（REST 拉全量时用） */
  setGraphSnapshot: (nodes: GraphNodeData[], edges: GraphEdgeData[], progress?: GraphProgress) => void
  /** 追加单条实体（entity_emerged 事件） */
  appendGraphNode: (node: GraphNodeData) => void
  /** 追加单条关系（relationship_formed 事件） */
  appendGraphEdge: (edge: GraphEdgeData) => void
  /** 更新图谱阶段进度（graph_progress 事件） */
  setGraphProgress: (progress: GraphProgress) => void
  /** 追加单轮推演结果（round_completed 事件） */
  appendSimRound: (round: SimRound) => void
  /** 重置图谱 + 推演数据（切 run 时调用） */
  resetGraphStream: () => void
  /** feature2: 在指定 round 拍下当前图谱快照（去重：同 round 只存最早一次） */
  snapshotGraphAtRound: (round: number) => void

  // ---- must-tier v2: SSE 事件 append actions ----
  /** 追加市场事件（保持最新 30 条） */
  appendMarketEvent: (event: MarketEvent) => void
  /** 追加外部冲击（保持最新 5 条） */
  appendShock: (shock: ShockEvent) => void
  /** 触发跨年完成 banner */
  setYearAdvanced: (event: YearAdvancedEvent) => void
  /** 清空跨年 banner（用户关闭后） */
  clearYearAdvanced: () => void

  // ---- should-tier v3: 实时事件 actions (新增 market_event / shock / round_started / belief_shift) ----
  /** 设置最近一条市场事件（供 MarketEnvPulse 仪表盘） */
  setLatestMarketEvent: (event: MarketEvent | null) => void
  /** 设置当前活动冲击（ShockBanner 3s 后自动清除） */
  setActiveShock: (shock: ShockEvent | null) => void
  /** 清空活动冲击（用户关闭或定时器触发） */
  clearActiveShock: () => void
  /** 追加信念漂移（保持最新 30 条） */
  appendBeliefShift: (shift: BeliefShiftEvent) => void
  /** 设置 round_started 横幅（1s 后自动清空） */
  setRoundStartedBanner: (banner: { round: number; total_rounds?: number; ts: number } | null) => void
  /** 清空 round_started 横幅 */
  clearRoundStartedBanner: () => void
}

// ---- 内部 SSE 工具（仍在模块作用域，但只通过 store 字段访问） ----

function _openSSE(
  runId: string,
  get: () => PipelineState,
  set: (partial: Partial<PipelineState>) => void,
) {
  // 关闭旧的
  _closeSSE(get, set)
  const es = new EventSource(`/api/pipeline/${runId}/events`)
  set({ _sseRef: es, lastEventAt: Date.now() })
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      // 完整快照（含 artifacts）
      if (data.run_id && data.artifacts !== undefined) {
        // must-tier v1: 派生报告风险（从 REPORT_GENERATING.risks）
        const reportArt = data.artifacts?.REPORT_GENERATING
        const risks: RiskItem[] = Array.isArray(reportArt?.risks) ? reportArt.risks : []
        set({
          snapshot: data,
          runId: data.run_id,
          status: (data.status as PipelineStatus) || get().status,
          currentStage: data.current_stage || get().currentStage,
          progress: typeof data.progress === 'number' ? data.progress : get().progress,
          lastEventAt: Date.now(),
          reportRisks: risks,
        })
      }
      // 增量事件
      if (data.current_stage) {
        set({ currentStage: data.current_stage })
      }
      if (typeof data.progress === 'number') {
        set({ progress: data.progress })
      }
      if (data.status) {
        set({ status: data.status as PipelineStatus, lastEventAt: Date.now() })
        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          // 终态保留 SSE 一小段时间再关，方便收尾事件
          const existing = get()._sseCloseTimer
          if (existing) {
            clearTimeout(existing)
          }
          const t = window.setTimeout(() => {
            _closeSSE(get, set)
            set({ _sseCloseTimer: null })
          }, 5000)
          set({ _sseCloseTimer: t })
        }
      }

      // ---- 新事件协议（BE2 SSE 双轨） ----
      // live_event 信封: { type: "live_event", event: { type: "...", stage: "...", data: {...} } }
      if (data.type === 'live_event' && data.event) {
        const evt = data.event
        const evtType = evt.type
        const evtData = evt.data || {}
        set({ lastEventAt: Date.now() })
        if (evtType === 'graph_progress') {
          get().setGraphProgress({
            phase: evtData.phase || 'graph_building',
            nodes: evtData.nodes ?? get().graphProgress.nodes,
            edges: evtData.edges ?? get().graphProgress.edges,
            delta_nodes: evtData.delta_nodes,
            delta_edges: evtData.delta_edges,
            new_entities: evtData.new_entities,
            new_relations: evtData.new_relations,
            current_doc: evtData.current_doc,
            error: evtData.error,
          })
          if (Array.isArray(evtData.new_entities)) {
            for (const n of evtData.new_entities) get().appendGraphNode(n as GraphNodeData)
          }
          if (Array.isArray(evtData.new_relations)) {
            for (const e of evtData.new_relations) get().appendGraphEdge(e as GraphEdgeData)
          }
        } else if (evtType === 'entity_emerged' && evtData.entity) {
          get().appendGraphNode(evtData.entity as GraphNodeData)
        } else if (evtType === 'relationship_formed' && evtData.relation) {
          get().appendGraphEdge(evtData.relation as GraphEdgeData)
        } else if (evtType === 'round_completed' || evtType === 'round_progress') {
          get().appendSimRound({
            round: evtData.round ?? 0,
            total_rounds: evtData.total_rounds,
            progress: evtData.progress,
            actions_count: evtData.actions?.length ?? evtData.actions_count,
            belief_updates_count: evtData.belief_updates?.length ?? evtData.belief_updates_count,
            belief_shift_count: evtData.belief_shift_count ?? 0,
            propagation_events_count: evtData.propagation_events?.length ?? evtData.propagation_events_count,
            active_agents: evtData.active_agents,
            actions: evtData.actions,
            belief_updates: evtData.belief_updates,
            propagation_events: evtData.propagation_events,
            new_entities: evtData.new_entities,
            new_relations: evtData.new_relations,
            ts: Date.now(),
          } as SimRound)
        } else if (evtType === 'market_event') {
          // must-tier v2: 市场事件 → 队列 (max 30)
          get().appendMarketEvent({
            type: evtData.type || 'UNKNOWN',
            industry: evtData.industry,
            gdp_growth: typeof evtData.gdp_growth === 'number' ? evtData.gdp_growth : undefined,
            cycle_label: evtData.cycle_label,
            description: evtData.description,
            ts: evtData.ts ?? Date.now(),
          } as MarketEvent)
          // should-tier v3: 同步到 latest_market_event (供 MarketEnvPulse 仪表盘)
          // 这里把 sector_growth_rate / policy_pressure / capital_availability / cycle_label_cn 等
          // 额外字段合并到 MarketEvent 上 (MarketEvent 形状基础 + 扩展字段)
          try {
            get().setLatestMarketEvent({
              type: evtData.type || 'UNKNOWN',
              industry: evtData.industry,
              gdp_growth: typeof evtData.gdp_growth === 'number' ? evtData.gdp_growth : undefined,
              cycle_label: evtData.cycle_label,
              description: evtData.description,
              ts: evtData.ts ?? Date.now(),
              // 扩展字段 (MarketEnvPulse 消费)
              ...(evtData as any),
            } as any)
          } catch {/* ignore */}
        } else if (evtType === 'shock_injected') {
          // must-tier v2: 外部冲击 → 队列 (max 5)
          get().appendShock({
            factor_name: evtData.factor_name || '未知因素',
            severity: typeof evtData.severity === 'number' ? evtData.severity : 0.5,
            description: evtData.description,
            ts: evtData.ts ?? Date.now(),
          } as ShockEvent)
          // should-tier v3: 同步到 active_shock (ShockBanner 3s 高亮, 用户也能手动关)
          try {
            get().setActiveShock({
              factor_name: evtData.factor_name || '未知因素',
              severity: typeof evtData.severity === 'number' ? evtData.severity : 0.5,
              description: evtData.description,
              ts: evtData.ts ?? Date.now(),
              // 扩展字段 (ShockBanner 消费)
              ...(evtData as any),
            } as any)
          } catch {/* ignore */}
        } else if (evtType === 'year_advanced') {
          // must-tier v2: 跨年完成 → banner
          get().setYearAdvanced({
            year: evtData.year ?? 1,
            rounds_added: evtData.rounds_added ?? 0,
            entities_count: evtData.entities_count,
            ts: evtData.ts ?? Date.now(),
          } as YearAdvancedEvent)
          // 同时把 status 切回 completed, 让前端 advance-year 按钮的 loading 状态正确切回
          if (evtData.status === 'completed' || evtData.status === 'failed') {
            set({ status: evtData.status as PipelineStatus })
          }
        } else if (evtType === 'belief_shift') {
          // should-tier v3: 信念漂移事件 → beliefShifts[] 队列
          try {
            get().appendBeliefShift({
              round: evtData.round ?? 0,
              agent_id: String(evtData.agent_id ?? 'unknown'),
              topic: evtData.topic,
              old_value: evtData.old_value,
              new_value: evtData.new_value,
              delta: typeof evtData.delta === 'number' ? evtData.delta : 0,
              magnitude: evtData.magnitude,
              ts: evtData.ts ?? Date.now(),
            } as BeliefShiftEvent)
          } catch {/* ignore */}
        } else if (evtType === 'round_started') {
          // should-tier v3: 回合开始横幅 (1s 闪现)
          try {
            get().setRoundStartedBanner({
              round: evtData.round ?? 0,
              total_rounds: evtData.total_rounds,
              ts: evtData.ts ?? Date.now(),
            })
          } catch {/* ignore */}
        } else if (evtType === 'round_completed') {
          // should-tier v3: 回合完成 (与 round_progress 区分 — 不带 progress 字段, 纯快照)
          // 已在上面分支处理 (round_completed / round_progress 合并)
        }
      }
    } catch { /* ignore malformed events */ }
  }
  es.onerror = () => {
    if (['completed', 'failed', 'cancelled'].includes(get().status)) {
      _closeSSE(get, set)
    }
  }
}

function _closeSSE(get: () => PipelineState, set: (partial: Partial<PipelineState>) => void) {
  const cur = get()._sseRef
  if (cur) {
    try { cur.close() } catch {}
    set({ _sseRef: null })
  }
  const t = get()._sseCloseTimer
  if (t) {
    clearTimeout(t)
    set({ _sseCloseTimer: null })
  }
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  runId: null,
  status: 'idle',
  currentStage: 'IDLE',
  progress: 0,
  error: null,
  uploadedDocIds: [],
  snapshot: null,
  isStarting: false,
  uploads: new Map(),
  lastEventAt: 0,
  lastRunConfig: null,
  graphNodes: [],
  graphEdges: [],
  graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
  simRounds: [],
  graphSnapshots: {},
  // must-tier v2: 实时事件初始值
  marketEvents: [],
  recentShocks: [],
  yearAdvanced: null,
  // should-tier v3: 新增
  latestMarketEvent: null,
  activeShock: null,
  beliefShifts: [],
  roundStartedBanner: null,
  // must-tier v1: 风险矩阵初始值
  reportRisks: [],
  _sseRef: null,
  _sseCloseTimer: null,

  startPipeline: async (config) => {
    // 首行立刻设置 isStarting（消费方立即看到按钮变 loading）+ 重置上一 run 的图谱/回合数据
    set({
      status: 'running',
      currentStage: 'SEED_PARSING',
      progress: 0,
      error: null,
      isStarting: true,
      lastRunConfig: config,
      graphNodes: [],
      graphEdges: [],
      graphProgress: { phase: 'starting', nodes: 0, edges: 0 },
      simRounds: [],
    })
    try {
      const r = await http.post('/pipeline/start', { config })
      const runId: string = r.data.run_id
      set({ runId, isStarting: false })
      _openSSE(runId, get, set)
      return runId
    } catch (e: any) {
      // 来源：C3 P0 #10：启动失败用 formatError 翻译
      set({ status: 'failed', error: formatErrorMessage(e), isStarting: false })
      return null
    }
  },

  pause: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/pause`)
    set({ status: 'paused' })
  },

  resume: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/resume`)
    set({ status: 'running' })
  },

  cancel: async () => {
    const { runId } = get()
    if (!runId) return
    await http.post(`/pipeline/${runId}/cancel`)
    set({ status: 'cancelled' })
    _closeSSE(get, set)
  },

  /**
   * P4 LOOP (G5): 再推 1 年
   * - 仅 completed/failed run 可用
   * - 后端会重置 status=running + 跑 12 轮（time_step=month）+ 9 次市场事件
   * - 前端立刻进入 running UI 状态，SSE 通道保持打开接收新一轮事件
   */
  advanceYear: async (yearOffset = 1) => {
    const { runId } = get()
    if (!runId) return null
    // 乐观更新：把 status 切回 running，stage 切到 SIMULATION_RUNNING，UI 立即有反应
    set({
      status: 'running',
      currentStage: 'SIMULATION_RUNNING',
      error: null,
    })
    try {
      const r = await http.post(`/pipeline/${runId}/advance-year`, { year_offset: yearOffset })
      return r.data
    } catch (e: any) {
      set({ status: 'failed', error: formatErrorMessage(e) })
      return null
    }
  },

  reset: () => {
    _closeSSE(get, set)
    set({
      runId: null,
      status: 'idle',
      currentStage: 'IDLE',
      progress: 0,
      error: null,
      snapshot: null,
      isStarting: false,
      lastEventAt: 0,
      lastRunConfig: null,
    })
  },

  setProgress: (stage, progress) => set({ currentStage: stage, progress }),
  setStatus: (status) => set({ status }),
  setRunId: (runId) => {
    set({ runId })
    if (runId) _openSSE(runId, get, set)
    else _closeSSE(get, set)
  },
  setSnapshot: (snap) => set({ snapshot: snap, runId: snap.run_id }),

  /**
   * Hydrate from a runId (e.g. from URL /workbench/:runId).
   *
   * P3 PERSIST (G4) — 强鲁棒 hydrate：
   *   1) GET /api/pipeline/<id> — 失败 retry 3 次 (1s / 2s / 4s 指数退避)
   *   2) 成功后并行 GET /api/pipeline/<id>/graph-snapshot + /network-frames
   *      把 graphNodes / graphEdges / simRounds 一次填满（中途刷新恢复不丢进度）
   *   3) 终态不开 SSE；非终态重新打开 SSE（store 内的 EventSource 已被 router
   *      ``key={runId}`` remount 流程关掉，这里再开一次保证实时推流）
   *
   * 任意外部 AbortSignal 触发会立即取消所有等待并返回 false。
   */
  hydrateFromRunId: async (runId, signal, active = true) => {
    if (!runId) return false
    // F2: StrictMode 早期退出, 跳过第一次 mount 期间的写操作
    if (!active) return false

    // Helper: 包裹一个 timeout 的 sleep，监听外部 signal
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms)
      if (signal) {
        const onAbort = () => { clearTimeout(t); resolve() }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
    })
    const isAborted = () => !!signal?.aborted || !active

    // ---- Step 1: GET /pipeline/<id> 重试 ----
    const RETRY_DELAYS_MS = [1000, 2000, 4000]  // 3 attempts total
    let snap: any = null
    let lastErr: any = null
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (isAborted()) return false
      try {
        const r = await http.get(`/pipeline/${runId}`, { signal })
        if (r.data && r.data.run_id) {
          snap = r.data
          break
        }
        lastErr = new Error('empty payload')
      } catch (e) {
        lastErr = e
      }
      // 失败：等指数退避再 retry
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt])
      }
    }
    if (!snap) {
      // 3 次都失败：保留最后一次错误以供上层 toast
      // eslint-disable-next-line no-console
      console.warn('[hydrateFromRunId] 3 次 retry 后仍失败', lastErr)
      return false
    }
    if (!active) return false  // 等待期间被 unmount/重 hydrate

    // ---- Step 2: 写入 snapshot 字段 ----
    set({
      runId: snap.run_id,
      status: (snap.status as PipelineStatus) || 'idle',
      currentStage: snap.current_stage || 'IDLE',
      progress: typeof snap.progress === 'number' ? snap.progress : 0,
      snapshot: snap,
      error: snap.error || null,
    })

    // ---- Step 3: 并行拉 graph-snapshot + network-frames 把 store 填满 ----
    // 仅在"中途刷新后还想继续看" 的场景有意义，所以非终态 + completed 都拉；
    // 网络错失败不影响后续 SSE — 降级为 console.warn
    const fillPromises: Promise<void>[] = []
    fillPromises.push((async () => {
      if (isAborted()) return
      try {
        const r = await http.get(`/pipeline/${runId}/graph-snapshot`, { signal })
        const data = r.data || {}
        const nodes = Array.isArray(data.nodes) ? data.nodes as GraphNodeData[] : []
        const edges = Array.isArray(data.edges) ? data.edges as GraphEdgeData[] : []
        if (nodes.length || edges.length) {
          if (!active) return  // 写入前再 check 一次
          get().setGraphSnapshot(nodes, edges, {
            phase: 'completed',
            nodes: nodes.length,
            edges: edges.length,
          })
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[hydrateFromRunId] graph-snapshot 拉取失败（降级）', e)
      }
    })())
    fillPromises.push((async () => {
      if (isAborted()) return
      try {
        const r = await http.get(`/pipeline/${runId}/network-frames`, { signal })
        const data = r.data || {}
        const frames = Array.isArray(data.frames) ? data.frames as any[] : []
        if (frames.length) {
          if (!active) return  // 写入前再 check 一次
          // 把后端的 round_result frame 映射到 simRounds（用 SimRound 形状）
          // 注：appendSimRound 有 round 去重，所以多次 hydrate 不会重复 push
          for (const f of frames) {
            get().appendSimRound({
              round: f.round_num,
              total_rounds: data.total_rounds,
              actions_count: f.actions_count ?? (Array.isArray(f.actions) ? f.actions.length : 0),
              belief_updates_count: Array.isArray(f.belief_updates) ? f.belief_updates.length : 0,
              propagation_events_count: Array.isArray(f.propagation_events) ? f.propagation_events.length : 0,
              active_agents: f.active_agents,
              actions: f.actions,
              belief_updates: f.belief_updates,
              propagation_events: f.propagation_events,
              new_entities: undefined,
              new_relations: undefined,
              ts: f.end_time ? f.end_time * 1000 : Date.now(),
            } as SimRound)
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[hydrateFromRunId] network-frames 拉取失败（降级）', e)
      }
    })())
    // 等两个 fill 全部完成（任一降级失败都不影响主流程）
    await Promise.all(fillPromises)

    // ---- Step 4: 非终态重开 SSE ----
    if (isAborted()) return false
    if (!['completed', 'failed', 'cancelled'].includes(snap.status)) {
      _openSSE(snap.run_id, get, set)
    }
    return true
  },

  addUploadedDoc: (docId) =>
    set((s) => ({ uploadedDocIds: [...s.uploadedDocIds, docId] })),

  addUpload: (item) =>
    set((s) => {
      const next = new Map(s.uploads)
      next.set(item.id, item)
      return { uploads: next }
    }),

  removeUpload: (id) =>
    set((s) => {
      const next = new Map(s.uploads)
      next.delete(id)
      return { uploads: next }
    }),

  clearUploads: () => set({ uploads: new Map() }),

  dispose: () => {
    _closeSSE(get, set)
    set({ _sseRef: null, _sseCloseTimer: null })
  },

  // ---- 图谱 / 推演回合 actions（FE2/FE3 SSE + REST 消费方） ----
  /** 兼容旧 API：FE2 RealtimeKnowledgeGraph 用 seedGraph(rawNodes, rawEdges) */
  seedGraph: (nodes, edges) => {
    set({
      graphNodes: [...nodes],
      graphEdges: [...edges],
      graphProgress: { phase: 'completed', nodes: nodes.length, edges: edges.length },
    })
  },
  setGraphSnapshot: (nodes, edges, progress) => {
    set({
      graphNodes: [...nodes],
      graphEdges: [...edges],
      graphProgress: progress ?? { phase: 'completed', nodes: nodes.length, edges: edges.length },
    })
  },

  appendGraphNode: (node) => {
    const id = String(node.id)
    if (!id) return
    set((s) => {
      // 已存在则跳过（保留先来位置）
      if (s.graphNodes.some((n) => String(n.id) === id)) return s
      // Hard cap: 静默丢弃超出 MAX_GRAPH_NODES 的节点，避免浏览器崩溃。
      // UI 层可读 s.graphProgress.overflow / s.graphProgress.total_seen 显示提示。
      if (s.graphNodes.length >= MAX_GRAPH_NODES) {
        return {
          graphProgress: {
            ...s.graphProgress,
            overflow: ((s.graphProgress as any).overflow ?? 0) + 1,
          },
        }
      }
      const next = [...s.graphNodes, node]
      return { graphNodes: next, graphProgress: { ...s.graphProgress, nodes: next.length } }
    })
  },

  appendGraphEdge: (edge) => {
    const id = String(edge.id ?? `${edge.source}->${edge.target}`)
    set((s) => {
      if (s.graphEdges.some((e) => String(e.id ?? `${e.source}->${e.target}`) === id)) return s
      const next = [...s.graphEdges, edge]
      return { graphEdges: next, graphProgress: { ...s.graphProgress, edges: next.length } }
    })
  },

  setGraphProgress: (progress) => set({ graphProgress: progress }),

  appendSimRound: (round) => {
    set((s) => {
      // 去重（同一 round 不重复 push）
      if (s.simRounds.some((r) => r.round === round.round)) return s
      const next = [...s.simRounds, round].sort((a, b) => a.round - b.round)
      // feature2: 同步给该 round 拍一张图谱快照（首次见到该 round 才存）
      // cap: 保留最近 MAX_GRAPH_SNAPSHOTS 轮的快照（FIFO, 淘汰最早 key）
      const snap = s.graphSnapshots
      let newSnaps = snap
      if (!snap[round.round]) {
        newSnaps = { ...snap, [round.round]: { nodes: [...s.graphNodes], edges: [...s.graphEdges] } }
        const keys = Object.keys(newSnaps).map(Number).sort((a, b) => a - b)
        while (keys.length > MAX_GRAPH_SNAPSHOTS) {
          const oldKey = keys.shift()!
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldKey]: _dropped, ...rest } = newSnaps
          newSnaps = rest
        }
      }
      return { simRounds: next, graphSnapshots: newSnaps }
    })
  },

  resetGraphStream: () => {
    set({
      graphNodes: [],
      graphEdges: [],
      graphProgress: { phase: 'idle', nodes: 0, edges: 0 },
      simRounds: [],
      graphSnapshots: {},
      // must-tier: 切 run 时清空事件队列
      marketEvents: [],
      recentShocks: [],
      yearAdvanced: null,
      // should-tier v3: 切 run 时清空
      latestMarketEvent: null,
      activeShock: null,
      beliefShifts: [],
      roundStartedBanner: null,
      reportRisks: [],
    })
  },

  /** feature2: 在指定 round 拍下当前图谱快照（去重：同 round 只存最早一次） */
  snapshotGraphAtRound: (round) => {
    set((s) => {
      if (s.graphSnapshots[round]) return s
      let next = {
        ...s.graphSnapshots,
        [round]: { nodes: [...s.graphNodes], edges: [...s.graphEdges] },
      }
      // 同 appendSimRound: 保留最近 MAX_GRAPH_SNAPSHOTS 轮 (FIFO)
      const keys = Object.keys(next).map(Number).sort((a, b) => a - b)
      while (keys.length > MAX_GRAPH_SNAPSHOTS) {
        const oldKey = keys.shift()!
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [oldKey]: _dropped, ...rest } = next
        next = rest
      }
      return { graphSnapshots: next }
    })
  },

  // ---- must-tier v2: 实时事件 actions ----
  appendMarketEvent: (event) => {
    set((s) => {
      const next = [event, ...s.marketEvents].slice(0, 30)  // 保持最新 30 条, 倒序 (新→旧)
      return { marketEvents: next }
    })
  },
  appendShock: (shock) => {
    set((s) => {
      const next = [shock, ...s.recentShocks].slice(0, 5)  // 保持最新 5 条
      return { recentShocks: next }
    })
  },
  setYearAdvanced: (event) => {
    set({ yearAdvanced: event })
  },
  clearYearAdvanced: () => set({ yearAdvanced: null }),

  // ---- should-tier v3: 实时事件 actions ----
  setLatestMarketEvent: (event) => set({ latestMarketEvent: event }),
  setActiveShock: (shock) => {
    set({ activeShock: shock })
    // 3s 后自动清除 (与用户手动 close 互斥: 多次设置会重置)
    if (shock && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        try {
          const cur = get().activeShock
          if (cur && cur.ts === shock.ts) {
            set({ activeShock: null })
          }
        } catch {/* ignore */}
      }, 3000)
      // 清理上一个未触发的 timer
      const prev = (get() as any)._activeShockTimer
      if (prev) clearTimeout(prev)
      ;(set as any)({ _activeShockTimer: t } as any)
    }
  },
  clearActiveShock: () => set({ activeShock: null }),
  appendBeliefShift: (shift) => {
    set((s) => {
      const next = [shift, ...(s.beliefShifts ?? [])].slice(0, 30)
      return { beliefShifts: next }
    })
  },
  setRoundStartedBanner: (banner) => {
    set({ roundStartedBanner: banner })
    if (banner && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        try {
          const cur = get().roundStartedBanner
          if (cur && cur.ts === banner.ts) {
            set({ roundStartedBanner: null })
          }
        } catch {/* ignore */}
      }, 1000)
      const prev = (get() as any)._roundStartedTimer
      if (prev) clearTimeout(prev)
      ;(set as any)({ _roundStartedTimer: t } as any)
    }
  },
  clearRoundStartedBanner: () => set({ roundStartedBanner: null }),
}))

// ============================================================
// Atomic selector hooks（P0-2 关键产出）
// 取代组件内 `usePipelineStore()` 整树订阅，
// 让组件只在订阅的字段变化时 re-render。
// ============================================================
export const useRunId = () => usePipelineStore((s) => s.runId)
export const useStatus = () => usePipelineStore((s) => s.status)
export const useStage = () => usePipelineStore((s) => s.currentStage)

export interface StageProgress {
  stages: StageInfoType[]
  currentStage: string
  completedStages: string[]
  /** SIMULATION_RUNNING 阶段子进度 (其它阶段为 null) */
  sub: {
    round: number
    totalRounds: number
    activeAgents: number
  } | null
  /** 跨年回环第几年 (1 表示首次, 2+ 表示回环) */
  yearOffset: number
  isLooping: boolean
}

export const useStageProgress = (): StageProgress => usePipelineStore((s) => {
  const completed = s.snapshot?.completed_stages ?? []
  const current = s.snapshot?.current_stage ?? s.currentStage ?? 'IDLE'
  const yearOffset = s.yearAdvanced?.year ?? 0
  // yearOffset >= 2 表示已经走过至少 1 次跨年, 重新进入 GRAPH/ENTITY/PROFILE 时算回环
  const isLooping = yearOffset >= 2 && (
    current === 'GRAPH_BUILDING' ||
    current === 'ENTITY_EXTRACTION' ||
    current === 'PROFILE_GENERATION' ||
    current === 'CONFIG_GENERATION'
  )
  const sub = current === 'SIMULATION_RUNNING' && s.simRounds.length > 0
    ? {
        round: s.simRounds[s.simRounds.length - 1].round,
        totalRounds: s.snapshot?.total_rounds ?? s.simRounds.length,
        activeAgents: (s.snapshot?.active_agents as number | undefined) ??
          (s.simRounds[s.simRounds.length - 1].active_agents as number | undefined) ??
          0,
      }
    : null
  return {
    stages: computeStageStatuses({
      currentStage: current,
      completedStages: completed,
      isLooping,
      runStatus: s.status,
    }),
    currentStage: current,
    completedStages: completed,
    sub,
    yearOffset,
    isLooping,
  }
}, shallow)
export const useProgress = () => usePipelineStore((s) => s.progress)
export const useSnapshot = () => usePipelineStore((s) => s.snapshot)
export const useError = () => usePipelineStore((s) => s.error)
export const useIsStarting = () => usePipelineStore((s) => s.isStarting)
export const useUploads = () => usePipelineStore((s) => s.uploads)
export const useLastEventAt = () => usePipelineStore((s) => s.lastEventAt)
// P3-A: 读取最近一次启动时的完整 config（含 user_params）；Workbench 用以知道"用户在 Dashboard 选了啥"
export const useLastRunConfig = () => usePipelineStore((s) => s.lastRunConfig)

// ---- FE2/FE3: 实时图谱 + 推演回合 atomic selectors ----
export const useGraphNodes = () => usePipelineStore((s) => s.graphNodes)
export const useGraphEdges = () => usePipelineStore((s) => s.graphEdges)
export const useGraphProgress = () => usePipelineStore((s) => s.graphProgress)
export const useSimRounds = () => usePipelineStore((s) => s.simRounds)
/** 派生：图谱构建阶段（idle/starting/graph_building/completed） */
export const useGraphPhase = () => usePipelineStore((s) => s.graphProgress.phase)
// feature2: 图谱快照字典 + 单点查询
export const useGraphSnapshots = () => usePipelineStore((s) => s.graphSnapshots)

// should-tier v3: 实体类型图例 (KnowledgeGraph 增强)
// GraphPanel.vue:285-299 风格 10 色 palette
export const ENTITY_TYPE_PALETTE: ReadonlyArray<{ type: string; color: string; label: string }> = [
  { type: 'COMPANY',    color: '#3b82f6', label: '公司' },
  { type: 'PERSON',     color: '#ec4899', label: '人物' },
  { type: 'PRODUCT',    color: '#8b5cf6', label: '产品' },
  { type: 'BUSINESS',   color: '#f59e0b', label: '业务' },
  { type: 'GOVERNMENT', color: '#ef4444', label: '政府' },
  { type: 'REGULATION', color: '#64748b', label: '监管' },
  { type: 'TECH',       color: '#06b6d4', label: '技术' },
  { type: 'CAPITAL',    color: '#10b981', label: '资本' },
  { type: 'MARKET',     color: '#f97316', label: '市场' },
  { type: 'RISK',       color: '#a855f7', label: '风险' },
] as const

const _ENTITY_TYPE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  ENTITY_TYPE_PALETTE.map((p) => [p.type, p.color]),
)

/** 根据 entity type 查 color (未知 type 走 fallback) */
export function getEntityTypeColor(type: string | undefined | null): string {
  if (!type) return '#94a3b8'
  return _ENTITY_TYPE_COLOR_MAP[type] ?? '#94a3b8'
}

/** 派生：聚合当前 graphNodes 中所有 type + count + color (按出现顺序, 未知 type 走 default) */
export interface EntityTypeStat {
  type: string
  color: string
  count: number
}

export const useEntityTypes = (): EntityTypeStat[] => {
  const nodes = useGraphNodes()
  const seen: Record<string, EntityTypeStat> = {}
  // 先按 palette 顺序遍历 (保证图例顺序稳定)
  for (const p of ENTITY_TYPE_PALETTE) {
    seen[p.type] = { type: p.type, color: p.color, count: 0 }
  }
  for (const n of nodes) {
    const t = String(n.type ?? 'UNKNOWN')
    if (!seen[t]) {
      // 未知 type: 走 default 灰
      const k = 'UNKNOWN'
      if (!seen[k]) seen[k] = { type: k, color: '#94a3b8', count: 0 }
      seen[k].count += 1
    } else {
      seen[t].count += 1
    }
  }
  // 过滤掉 count=0, 保留 palette 顺序; UNKNOWN 始终在最后
  const result: EntityTypeStat[] = []
  for (const p of ENTITY_TYPE_PALETTE) {
    if (seen[p.type].count > 0) result.push(seen[p.type])
  }
  if (seen.UNKNOWN && seen.UNKNOWN.count > 0) result.push(seen.UNKNOWN)
  return result
}

/** FE2 兼容：网络帧（推演回合 + 涌现节点的扁平化视图） */
export interface NetworkFrameLive {
  round: number
  total_rounds?: number
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  actions_count?: number
  belief_updates_count?: number
  active_agents?: string[] | number
  ts?: number
}

// ---- FE2 兼容：图谱节点/边的"实时"形式（含 d3-force 位置字段） ----
/** RealtimeKnowledgeGraph 期望的"实时节点"类型（= GraphNodeData + 布局字段） */
export type GraphNodeLive = GraphNodeData & {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  index?: number
  isNew?: boolean
}
/** RealtimeKnowledgeGraph 期望的"实时边"类型 */
export type GraphEdgeLive = GraphEdgeData & {
  index?: number
  drawProgress?: number
  isNew?: boolean
}
/** FE2 兼容：从 simRounds 派生 NetworkFrameLive 数组 */
export const useNetworkFrames = (): NetworkFrameLive[] => {
  const rounds = useSimRounds()
  return rounds.map((r) => ({
    round: r.round,
    total_rounds: r.total_rounds,
    nodes: r.new_entities ?? [],
    edges: r.new_relations ?? [],
    actions_count: r.actions_count,
    belief_updates_count: r.belief_updates_count,
    ts: r.ts,
  }))
}

// ---- must-tier v2: 实时事件 atomic selectors ----
export const useMarketEvents = () => usePipelineStore((s) => s.marketEvents)
export const useRecentShocks = () => usePipelineStore((s) => s.recentShocks)
export const useYearAdvanced = () => usePipelineStore((s) => s.yearAdvanced)

// ---- should-tier v3: 新增 atomic selectors ----
export const useLatestMarketEvent = () => usePipelineStore((s) => s.latestMarketEvent)
export const useActiveShock = () => usePipelineStore((s) => s.activeShock)
export const useBeliefShifts = () => usePipelineStore((s) => s.beliefShifts)
export const useRoundStartedBanner = () => usePipelineStore((s) => s.roundStartedBanner)

// ---- must-tier v1: 报告风险矩阵 selector (live) ----
export const useReportRisks = () => usePipelineStore((s) => s.reportRisks)

// ---------------------------------------------------------------------------
// Loop Engine v2 (T0.2) — influence / weight selectors + helpers
//
// Per docs/superpowers/specs/loop-engine-v2-implementation.md §T0.2:
//   influence = clamp01(0.4·normDeg + 0.3·recency + 0.3·(prop ?? 0.4))
//   weight    = clamp01(0.5·normCount + 0.5·exp(-0.15·age))
//   recency   = 0.5 if no round, 1 if round>=current, else 1/(1+(current-round))
// ---------------------------------------------------------------------------

/** Clamp a number into [0, 1]; return 0 for NaN / ±Infinity. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Normalize a value by reference; 0 for non-finite or non-positive ref. */
export function normalize(value: number, ref: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(ref) || ref <= 0) return 0
  return value / ref
}

/**
 * Recency score for a node that emerged at `emergedRound`.
 *  - undefined round → 0.5 (neutral)
 *  - round >= currentRound → 1
 *  - otherwise 1 / (1 + (currentRound - round))
 */
export function recencyScore(
  emergedRound: number | undefined,
  currentRound: number,
): number {
  if (emergedRound === undefined || emergedRound === null) return 0.5
  if (!Number.isFinite(emergedRound) || !Number.isFinite(currentRound)) return 0.5
  if (emergedRound >= currentRound) return 1
  return 1 / (1 + (currentRound - emergedRound))
}

export interface SelectInfluenceOpts {
  degree: number
  maxDegree: number
  currentRound: number
}

/** Node influence per the Loop Engine v2 spec formula. */
export function selectInfluence(
  node: GraphNodeData,
  opts: SelectInfluenceOpts,
): number {
  const normDeg = normalize(opts.degree, opts.maxDegree)
  const recency = recencyScore(node.round, opts.currentRound)
  const prop = node.properties?.influence
  const propInfluence = typeof prop === 'number' ? prop : 0.4
  return clamp01(0.4 * normDeg + 0.3 * recency + 0.3 * propInfluence)
}

export interface SelectWeightOpts {
  count: number
  maxCount: number
}

/**
 * Edge weight per the spec formula. `age` is `max(0, currentRound - edge.round)`;
 * edges without a `round` field are treated as touching the current round
 * (age=0, no decay).
 */
export function selectWeight(
  edge: GraphEdgeData,
  currentRound: number,
  opts: SelectWeightOpts = { count: 1, maxCount: 1 },
): number {
  const normCount = normalize(opts.count, opts.maxCount)
  const lastTouch = edge.round ?? currentRound
  const age = Math.max(0, currentRound - lastTouch)
  return clamp01(0.5 * normCount + 0.5 * Math.exp(-0.15 * age))
}
