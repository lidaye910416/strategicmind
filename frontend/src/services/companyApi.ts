/**
 * 公司编排 API - 与后端 /api/company/* 配套使用
 *
 * 提供：
 * - 搭建一个公司（部门 + 经营模式 + 市场环境 + 竞品 + 客户）
 * - 查询部门列表 / 立场
 * - 解决战略议题（部门博弈推演）
 * - 推进季度 / 添加竞品 / 添加客户
 *
 * 来源：C3 P0 #13 - 复用 services/http.ts 单例，不重复 axios.create
 */
import http from './http'

// ---- 类型定义 ----
export type BusinessModelType =
  | 'PROJECT_BASED'
  | 'PRODUCT_BASED'
  | 'PLATFORM_BASED'
  | 'ASSET_HEAVY'
  | 'ASSET_LIGHT'
  | 'INTEGRATION'
  | 'SERVICE'
  | 'STATE_OWNED'

export type ResolutionOutcome = 'ADOPTED' | 'REJECTED' | 'COMPROMISED' | 'DEFERRED'

export interface DepartmentKPI {
  营收: number
  毛利率: number
  成本控制: number
  用户增长: number
  客户满意度: number
  留存: number
  研发投入: number
  创新: number
  合规: number
  风险控制: number
  人才获取: number
  组织效率: number
}

export interface DepartmentAgent {
  agent_id: string
  name: string
  agent_type: string
  agent_kind?: 'department' | 'customer' | 'competitor' | 'stakeholder'
  department_type?: string
  department_name_cn?: string
  influence_weight: number
  decision_power?: number
  kpi?: DepartmentKPI
  dept_relationships?: Record<string, number>
  private_signals_count?: number
  beliefs?: any
  interests?: any
  action_repertoire?: string[]
}

export interface BusinessModelProfile {
  model: BusinessModelType
  model_name_cn: string
  margin_baseline: number
  margin_volatility: number
  capex_intensity: number
  decision_cycle_days: number
  external_dependency: number
  shock_resilience: number
  customer_concentration: number
  contract_duration_months: number
  department_power_modifier: Record<string, number>
  shock_transmission_coefficient: number
}

export interface MarketEnvironment {
  sector_growth_rate: number
  market_size_billion: number
  competition_intensity: number
  policy_stance: string
  policy_pressure: number
  capital_availability: number
  interest_rate_level: number
  tech_maturity: number
  innovation_pace: number
  consumer_sentiment: number
  customer_price_sensitivity: number
  current_cycle: string
  cycle_label_cn: string
  fiscal_quarter: number
  fiscal_year_offset: number
}

export interface CompanyContext {
  company_id: string
  company_name: string
  departments: DepartmentAgent[]
  department_count: number
  business_model: BusinessModelProfile
  market_env: MarketEnvironment
  customers_count: number
  competitors_count: number
  competitors?: DepartmentAgent[]
}

export interface DepartmentPosition {
  dept_type: string
  dept_name: string
  position: number
  confidence: number
  voting_weight: number
  rationale: string
}

export interface TopicResolution {
  topic: string
  positions: DepartmentPosition[]
  company_position: number
  outcome: ResolutionOutcome
  outcome_label_cn: string
  winning_depts: string[]
  losing_depts: string[]
  summary: string
}

// ---- API 方法 ----
export const companyApi = {
  setup: (data: {
    company_name?: string
    business_model?: BusinessModelType
    competitors?: Array<{ name: string; market_share: number; strategy: string; aggressiveness: number }>
    customer_segments?: string[]
  }) => http.post<{ company_id: string; company: CompanyContext }>('/company/setup', data),

  get: (companyId: string) =>
    http.get<CompanyContext>(`/company/${companyId}`),

  listDepartments: (companyId: string) =>
    http.get<{ departments: DepartmentAgent[]; by_power: DepartmentAgent[] }>(
      `/company/${companyId}/departments`,
    ),

  resolve: (companyId: string, data: { topic: string; external_pressure?: number }) =>
    http.post<TopicResolution>(`/company/${companyId}/resolve`, data),

  departmentStance: (companyId: string, data: { topic: string }) =>
    http.post<{
      topic: string
      positions: Array<{ dept_type: string; dept_name: string; stance: number; stance_label: string }>
    }>(`/company/${companyId}/department-stance`, data),

  advanceQuarter: (companyId: string) =>
    http.post<{ market_env: MarketEnvironment; changes: Record<string, any> }>(
      `/company/${companyId}/advance-quarter`,
    ),

  addCompetitor: (
    companyId: string,
    data: { name: string; market_share?: number; strategy?: string; aggressiveness?: number },
  ) => http.post(`/company/${companyId}/add-competitor`, data),

  addCustomers: (companyId: string, data: { segment: string; count?: number }) =>
    http.post(`/company/${companyId}/add-customers`, data),
}

export default companyApi
