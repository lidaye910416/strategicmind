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
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { computeStageStatuses, type StageInfo as StageInfoType } from '../components/Workbench/stageProgress'
// Re-export usePipelineEvent (定义在 lib/hooks) 供业务组件统一从 store 导入
export { usePipelineEvent, type PipelineEvent } from '../lib/hooks/usePipelineEvent'

// ---- G8: 4 typed slices composing the pipeline store ----
// The single big createWithEqualityFn body that used to live here is now
// decomposed into graphSlice / simSlice / configSlice / uiSlice. The exported
// usePipelineStore is a thin composite that spread-inits state from each
// slice creator, then spreads each creator's actions dict. Public API
// (atomic hook re-exports, type defs, helpers) is unchanged.
import {
  graphSlice,
  type GraphSliceState,
} from './slices/graphSlice'
import {
  simSlice,
  type SimSliceState,
} from './slices/simSlice'
import {
  configSlice,
  type ConfigSliceState,
} from './slices/configSlice'
import {
  uiSlice,
  type UiSliceState,
} from './slices/uiSlice'

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
  /** 累计被驱逐的节点数（signal_density 最低者） */
  evicted?: number
  /** 累计因节点缺失而被丢弃的边数 */
  dropped_edges?: number
  /** 累计因容量满而被丢弃的节点数（incoming density ≤ 最低 density） */
  overflow?: number
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

// ---- G8: SSE handlers + eviction helper are owned by slices/uiSlice.ts
//      and slices/graphSlice.ts respectively. The composite store below
//      just spreads each slice creator's state and actions.

// ============================================================================
// Composite store — 4 typed slices spread into one Zustand store.
//
// PipelineState (type) is the union of all slice interfaces; at runtime we
// only care that the dict shape lines up. createWithEqualityFn keeps the
// 2nd-arg shallow equality path that consumers depend on (G6 BUG c).
// ============================================================================

type PipelineState = GraphSliceState & SimSliceState & ConfigSliceState & UiSliceState

export const usePipelineStore = createWithEqualityFn<PipelineState>((set, get) => {
  // Spread each slice creator. Order matters for `resetGraphStream` which
  // clears cross-slice fields — that lives in graphSlice (where it owns
  // graphNodes/Edges) and we wire the simSlice counterpart (resetSimSlice)
  // here so the cross-slice reset still works.
  const g = graphSlice(set as any, get as any)
  const s = simSlice(set as any, get as any)
  const c = configSlice(set as any, get as any)
  const u = uiSlice(set as any, get as any)

  return {
    ...g,
    ...s,
    ...c,
    ...u,

    // Override resetGraphStream so it also clears sim/event slice state
    // (kept here to preserve the original behavior:切 run 时所有相关字段全清)
    resetGraphStream: () => {
      g.resetGraphStream()
      s.resetSimSlice()
      set({ reportRisks: [], worldState: null } as any)
    },
  }
})

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
export const useSnapshot = () => usePipelineStore((s) => s.snapshot, shallow)
export const useError = () => usePipelineStore((s) => s.error)
export const useIsStarting = () => usePipelineStore((s) => s.isStarting)
export const useUploads = () => usePipelineStore((s) => s.uploads, shallow)
export const useLastEventAt = () => usePipelineStore((s) => s.lastEventAt)
// P3-A: 读取最近一次启动时的完整 config（含 user_params）；Workbench 用以知道"用户在 Dashboard 选了啥"
export const useLastRunConfig = () => usePipelineStore((s) => s.lastRunConfig, shallow)

// ---- FE2/FE3: 实时图谱 + 推演回合 atomic selectors ----
export const useGraphNodes = () => usePipelineStore((s) => s.graphNodes, shallow)
export const useGraphEdges = () => usePipelineStore((s) => s.graphEdges, shallow)
export const useGraphProgress = () => usePipelineStore((s) => s.graphProgress, shallow)
export const useSimRounds = () => usePipelineStore((s) => s.simRounds, shallow)
/** 派生：图谱构建阶段（idle/starting/graph_building/completed） */
export const useGraphPhase = () => usePipelineStore((s) => s.graphProgress.phase)
// feature2: 图谱快照字典 + 单点查询
export const useGraphSnapshots = () => usePipelineStore((s) => s.graphSnapshots, shallow)

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
  /** 中文 label (来自 ENTITY_TYPE_PALETTE, 未知 type 退化到 type 字符串本身) */
  label: string
}

export const useEntityTypes = (): EntityTypeStat[] => {
  const nodes = useGraphNodes()
  const seen: Record<string, EntityTypeStat> = {}
  // 先按 palette 顺序遍历 (保证图例顺序稳定)
  for (const p of ENTITY_TYPE_PALETTE) {
    seen[p.type] = { type: p.type, color: p.color, count: 0, label: p.label }
  }
  for (const n of nodes) {
    const t = String(n.type ?? 'UNKNOWN')
    if (!seen[t]) {
      // 未知 type: 走 default 灰
      const k = 'UNKNOWN'
      if (!seen[k]) seen[k] = { type: k, color: '#94a3b8', count: 0, label: k }
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
export const useMarketEvents = () => usePipelineStore((s) => s.marketEvents, shallow)
export const useRecentShocks = () => usePipelineStore((s) => s.recentShocks, shallow)
export const useYearAdvanced = () => usePipelineStore((s) => s.yearAdvanced, shallow)

// ---- should-tier v3: 新增 atomic selectors ----
export const useLatestMarketEvent = () => usePipelineStore((s) => s.latestMarketEvent, shallow)
export const useActiveShock = () => usePipelineStore((s) => s.activeShock, shallow)
export const useBeliefShifts = () => usePipelineStore((s) => s.beliefShifts, shallow)
export const useRoundStartedBanner = () => usePipelineStore((s) => s.roundStartedBanner, shallow)

// ---- must-tier v1: 报告风险矩阵 selector (live) ----
export const useReportRisks = () => usePipelineStore((s) => s.reportRisks, shallow)

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
