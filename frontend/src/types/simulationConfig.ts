/**
 * 用户可配置推演参数 — 与后端 backend/models/simulation_config.py 同步。
 *
 * Source: /tmp/arch-spec.md §4.1-4.2
 */
export type TimeStep = 'year' | 'quarter' | 'month'
export type EmergencePolicy = 'conservative' | 'moderate' | 'aggressive'
export type ConvergencePolicy = 'fixed' | 'auto_extend'
export type MarketStance = 'supportive' | 'neutral' | 'restrictive'

export const DEFAULT_DEPARTMENTS = ['销售', '技术', '财务', 'HR', '法务'] as const
export const ALL_DEPARTMENTS = [
  '销售', '技术', '财务', 'HR', '法务', '产品', '运营', '市场',
] as const
export type Department = typeof ALL_DEPARTMENTS[number]

export const TIME_STEP_LABELS: Record<TimeStep, string> = {
  year: '年',
  quarter: '季',
  month: '月',
}

export const EMERGENCE_POLICY_LABELS: Record<EmergencePolicy, string> = {
  conservative: '保守',
  moderate: '适中',
  aggressive: '激进',
}

export const CONVERGENCE_POLICY_LABELS: Record<ConvergencePolicy, string> = {
  fixed: '固定回合',
  auto_extend: '自动延长',
}

export const MARKET_STANCE_LABELS: Record<MarketStance, string> = {
  supportive: '利好',
  neutral: '中性',
  restrictive: '不利',
}

export const MAX_EXTERNAL_FACTORS = 10
export const MAX_ORG_NODES = 12
export const MAX_COMPETITORS = 8
export const MAX_REGULATIONS = 6

/** 公司内部结构: 一个节点 = 一个部门/团队, 包含汇报关系/规模/KPI 焦点 */
export interface OrgNode {
  id: string
  name: string                  // 部门/团队名
  reports_to?: string           // 上级 id, 顶层为 undefined
  headcount?: number            // 人数
  kpi_focus?: string            // 关注 KPI, 例 "营收/利润率/客户满意度"
}

/** 公司经营数据: 用于仿真中部门 Agent 决策 (现金流紧张 → 削减成本立场) */
export interface Financials {
  revenue_yi?: number           // 年营收 (亿元)
  gross_margin_pct?: number     // 毛利率 (%)
  net_margin_pct?: number       // 净利率 (%)
  growth_rate_pct?: number      // 同比增长率 (%)
  cash_runway_months?: number   // 现金跑道 (月)
  total_headcount?: number      // 公司总人数
  monthly_burn_wan?: number     // 月度烧钱 (万元)
}

/** 外部基础环境: 用于市场事件生成 + 推演前提 */
export interface MarketContext {
  tam_yi?: number                          // 总市场规模 (亿元)
  market_growth_pct?: number               // 行业增速 (%)
  stance: MarketStance                     // 整体态度
  competitors: string[]                    // 竞品
  regulation: string[]                     // 监管/合规约束
  customer_segments?: string[]             // 客户分层
}

export interface SimulationUserParams {
  years: number                 // 1-5
  time_step: TimeStep
  departments: Department[]
  external_factors: string[]    // 每行一条
  n_stakeholders: number        // 6-24
  emergence_policy: EmergencePolicy
  convergence_policy: ConvergencePolicy
  // 阶段二: 3 类可编辑结构化参数 (默认空 / 用户手动填 / LLM 预填)
  company_name?: string         // 公司/组织名, AI 预填可填, 报告 / 工作台显示
  org_structure: OrgNode[]
  financials: Financials
  market: MarketContext
}

export const DEFAULT_USER_PARAMS: SimulationUserParams = {
  years: 3,
  time_step: 'quarter',
  departments: [...DEFAULT_DEPARTMENTS],
  external_factors: [],
  n_stakeholders: 12,
  emergence_policy: 'moderate',
  convergence_policy: 'auto_extend',
  company_name: '',
  org_structure: [],
  financials: {},
  market: {
    stance: 'neutral',
    competitors: [],
    regulation: [],
  },
}

export function parseExternalFactors(text: string): string[] {
  return text
    .split(/[\n;,，；]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_EXTERNAL_FACTORS)
}

export function formatExternalFactors(factors: string[]): string {
  return factors.join('\n')
}
