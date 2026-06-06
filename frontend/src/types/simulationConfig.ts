/**
 * 用户可配置推演参数 — 与后端 backend/models/simulation_config.py 同步。
 *
 * Source: /tmp/arch-spec.md §4.1-4.2
 */
export type TimeStep = 'year' | 'quarter' | 'month'
export type EmergencePolicy = 'conservative' | 'moderate' | 'aggressive'
export type ConvergencePolicy = 'fixed' | 'auto_extend'

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

export const MAX_EXTERNAL_FACTORS = 10

export interface SimulationUserParams {
  years: number                 // 1-5
  time_step: TimeStep
  departments: Department[]
  external_factors: string[]    // 每行一条
  n_stakeholders: number        // 6-24
  emergence_policy: EmergencePolicy
  convergence_policy: ConvergencePolicy
}

export const DEFAULT_USER_PARAMS: SimulationUserParams = {
  years: 3,
  time_step: 'quarter',
  departments: [...DEFAULT_DEPARTMENTS],
  external_factors: [],
  n_stakeholders: 12,
  emergence_policy: 'moderate',
  convergence_policy: 'auto_extend',
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
