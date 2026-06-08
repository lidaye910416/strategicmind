/**
 * ConfigCard - 配置参数卡片 (3 tabs).
 *
 * P3-A 重设计：把原来只有 hours + report_style 扩为多维度参数
 * 阶段二扩展 (2026-06-08): 3 tabs — 基础 / 公司 / 市场
 *   - 基础: 模拟年限/时间步长/部门/对象数/外部因素/涌现/收敛/hours/报告风格
 *   - 公司: org_structure (OrgNode[]) + financials (revenue/margin/...)
 *   - 市场: market (TAM/growth/stance/competitors/regulation)
 *
 * 视觉保持原 motion.section 壳子, tabs 用 framer-motion AnimatePresence 切换。
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, AlertCircle, Copy, Info, Sparkles, Building2,
  TrendingUp, Globe2, Plus, Trash2, Users, Loader2,
} from 'lucide-react'
import { DASHBOARD, DASHBOARD_ACTIONS, REPORT_STYLE_LABELS } from '../../i18n/zh'
import {
  ALL_DEPARTMENTS, DEFAULT_DEPARTMENTS, MAX_EXTERNAL_FACTORS,
  MAX_ORG_NODES, MAX_COMPETITORS, MAX_REGULATIONS,
  TIME_STEP_LABELS, EMERGENCE_POLICY_LABELS, CONVERGENCE_POLICY_LABELS,
  MARKET_STANCE_LABELS,
  parseExternalFactors, formatExternalFactors,
  type TimeStep, type EmergencePolicy, type ConvergencePolicy, type Department,
  type SimulationUserParams, type OrgNode, type MarketStance,
} from '../../types/simulationConfig'

export type ReportStyle = 'executive' | 'technical' | 'narrative'

type TabKey = 'basic' | 'company' | 'market'

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'basic', label: '基础', icon: Settings },
  { key: 'company', label: '公司', icon: Building2 },
  { key: 'market', label: '市场', icon: Globe2 },
]

interface Props {
  uploadsCount: number
  showConfig: boolean
  onShowConfig: (show: boolean) => void

  // ---- 旧参数（向后兼容）----
  hours: number
  style: ReportStyle
  onChangeHours: (h: number) => void
  onChangeStyle: (s: ReportStyle) => void

  // ---- P3-A 新参数 ----
  params: SimulationUserParams
  onChangeParams: (next: SimulationUserParams) => void

  // ---- 复制配置 banner ----
  clonedFrom: string | null
  onDismissClone: () => void

  // ---- P3-A Phase 2: AI 一键预填 (P3) ----
  isPrefilling: boolean
  onPrefillFromLLM: () => void
}

export default function ConfigCard({
  uploadsCount, showConfig, onShowConfig,
  hours, style, onChangeHours, onChangeStyle,
  params, onChangeParams,
  clonedFrom, onDismissClone,
  isPrefilling, onPrefillFromLLM,
}: Props) {
  const ready = uploadsCount > 0
  const [tab, setTab] = useState<TabKey>('basic')

  // 子项 setter（不可变更新，触发父级 re-render）
  const setYears = (years: number) => onChangeParams({ ...params, years })
  const setTimeStep = (time_step: TimeStep) => onChangeParams({ ...params, time_step })
  const setNStakeholders = (n_stakeholders: number) => onChangeParams({ ...params, n_stakeholders })
  const setEmergence = (emergence_policy: EmergencePolicy) => onChangeParams({ ...params, emergence_policy })
  const setConvergence = (convergence_policy: ConvergencePolicy) => onChangeParams({ ...params, convergence_policy })
  const setExternal = (external_factors: string[]) => onChangeParams({ ...params, external_factors })

  const setOrgStructure = (org_structure: OrgNode[]) => onChangeParams({ ...params, org_structure })
  const setFinancials = (financials: SimulationUserParams['financials']) => onChangeParams({ ...params, financials })
  const setMarket = (market: SimulationUserParams['market']) => onChangeParams({ ...params, market })

  // 部门多选 toggle
  const toggleDept = (d: Department) => {
    const has = params.departments.includes(d)
    let next: Department[]
    if (has) {
      if (params.departments.length <= 1) return
      next = params.departments.filter((x) => x !== d)
    } else {
      next = [...params.departments, d]
    }
    onChangeParams({ ...params, departments: next })
  }

  // 外部因素 textarea 双向绑定
  const externalText = useMemo(() => formatExternalFactors(params.external_factors), [params.external_factors])
  const onExternalTextChange = (v: string) => setExternal(parseExternalFactors(v))

  // 派生 max_rounds 用于顶部 summary
  const per = { year: 1, quarter: 4, month: 12 }[params.time_step]
  const maxRounds = params.years * per

  // 派生 company/market 填充度徽章
  const orgCount = params.org_structure.length
  const finFilled = Object.values(params.financials).filter((v) => v != null && v !== '').length
  const compCount = params.market.competitors.length
  const regCount = params.market.regulation.length

  return (
    <>
      {/* P1-16: 复制配置提示 banner */}
      {clonedFrom && (
        <motion.div
          initial="initial"
          animate="animate"
          className={`card p-3 flex items-center gap-2 text-xs ${
            clonedFrom.startsWith('__error__')
              ? 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 text-amber-800 dark:text-amber-200'
              : 'border-brand-300/60 bg-brand-50/70 dark:bg-brand-950/30 dark:border-brand-800/60 text-brand-800 dark:text-brand-200'
          }`}
        >
          {clonedFrom.startsWith('__error__')
            ? <AlertCircle size={14} className="shrink-0" />
            : <Copy size={14} className="shrink-0" />}
          <div className="flex-1">
            {clonedFrom.startsWith('__error__')
              ? <>{DASHBOARD_ACTIONS.cloneFailed(clonedFrom.replace('__error__:', ''))}</>
              : <>{DASHBOARD_ACTIONS.cloneSuccessPrefix}<code className="px-1 rounded bg-white/60 dark:bg-ink-900/60 font-mono">{clonedFrom}</code>{DASHBOARD_ACTIONS.cloneSuccessTail}</>
            }
          </div>
          <div className="flex items-center gap-1 text-ink-500">
            <Info size={11} />
            <span>{DASHBOARD_ACTIONS.cloneSuccessHint}</span>
          </div>
          <button
            onClick={onDismissClone}
            className="ml-1 text-ink-400 hover:text-ink-700 text-[10px] px-1.5"
            title="关闭提示"
          >
            ✕
          </button>
        </motion.div>
      )}

      <motion.section className="card p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className={`step-num ${!ready ? 'opacity-40' : ''}`}>2</span>
            <div>
              <h2 className="font-semibold text-ink-900 dark:text-white">
                {!ready ? '先上传文档' : '配置参数并启动推演'}
              </h2>
              <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                {!ready
                  ? '上传至少一个文档后即可启动推演'
                  : '默认参数已适用于多数场景；可按需调整'}
              </p>
            </div>
          </div>
          {!showConfig && ready && (
            <button
              onClick={() => onShowConfig(true)}
              className="btn-ghost h-8 text-xs"
            >
              <Settings size={12} /> {DASHBOARD.openConfig}
            </button>
          )}
          {showConfig && ready && (
            <button
              onClick={() => onShowConfig(false)}
              className="text-xs text-ink-400 hover:text-ink-700"
            >
              {DASHBOARD.closeConfig}
            </button>
          )}
        </div>

        <AnimatePresence>
          {showConfig && ready && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              {/* 摘要行 */}
              <div className="mb-3 px-3 py-2 rounded-lg bg-brand-50/60 dark:bg-brand-950/20 border border-brand-200/50 dark:border-brand-800/50 flex items-center gap-2 text-[11px] text-brand-700 dark:text-brand-300">
                <Sparkles size={12} className="shrink-0" />
                <span className="font-medium">
                  {DASHBOARD.summary(params.years, params.departments.length, params.external_factors.length)}
                  <span className="text-ink-500 dark:text-ink-400 ml-1.5">· 约 {maxRounds} 回合</span>
                </span>
                {(orgCount > 0 || finFilled > 0 || compCount > 0 || regCount > 0) && (
                  <span className="text-ink-500 dark:text-ink-400 ml-1.5">
                    · 结构化: {orgCount} 节点 / {finFilled} 财务 / {compCount} 竞品 / {regCount} 监管
                  </span>
                )}
              </div>

              {/* ===== Tabs ===== */}
              <div className="flex items-center gap-1 mb-3 border-b border-ink-200/60 dark:border-ink-800/60">
                {TABS.map((t) => {
                  const Icon = t.icon
                  const active = tab === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={`relative flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors
                                  ${active
                                    ? 'text-brand-600 dark:text-brand-300'
                                    : 'text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200'}`}
                    >
                      <Icon size={12} />
                      {t.label}
                      {active && (
                        <motion.span
                          layoutId="config-tab-underline"
                          className="absolute inset-x-2 -bottom-px h-0.5 bg-brand-500 rounded-full"
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              <AnimatePresence mode="wait">
                {tab === 'basic' && (
                  <motion.div
                    key="basic"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40"
                  >
                    {/* 1. 模拟年限 */}
                    <div>
                      <label className="label">{DASHBOARD.years}</label>
                      <div className="flex gap-2" role="radiogroup" aria-label={DASHBOARD.years}>
                        {[1, 3, 5].map((y) => {
                          const active = params.years === y
                          return (
                            <button
                              key={y}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setYears(y)}
                              className={`flex-1 h-9 rounded-xl text-sm font-medium border transition-colors
                                ${active
                                  ? 'bg-brand-500 text-white border-brand-500 shadow-soft'
                                  : 'bg-white/60 dark:bg-ink-900/60 text-ink-700 dark:text-ink-200 border-ink-200 dark:border-ink-700 hover:border-brand-400'
                                }`}
                            >
                              {DASHBOARD.yearsUnit(y)}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.yearsHint}</p>
                    </div>

                    {/* 2. 时间步长 */}
                    <div>
                      <label className="label">{DASHBOARD.timeStep}</label>
                      <select
                        value={params.time_step}
                        onChange={(e) => setTimeStep(e.target.value as TimeStep)}
                        className="input"
                      >
                        {(Object.keys(TIME_STEP_LABELS) as TimeStep[]).map((k) => (
                          <option key={k} value={k}>{TIME_STEP_LABELS[k]}</option>
                        ))}
                      </select>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.timeStepHint}</p>
                    </div>

                    {/* 3. 公司部门 */}
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="label !mb-0 flex items-center gap-1.5">
                          <Building2 size={13} /> {DASHBOARD.departments}
                        </label>
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">
                          {DASHBOARD.departmentsCount(params.departments.length, ALL_DEPARTMENTS.length)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={DASHBOARD.departments}>
                        {ALL_DEPARTMENTS.map((d) => {
                          const active = params.departments.includes(d)
                          const isDefault = (DEFAULT_DEPARTMENTS as readonly string[]).includes(d)
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleDept(d)}
                              className={`h-8 px-3 rounded-full text-xs font-medium border transition-all
                                ${active
                                  ? 'bg-brand-500 text-white border-brand-500 shadow-soft'
                                  : 'bg-white/60 dark:bg-ink-900/60 text-ink-700 dark:text-ink-200 border-ink-200 dark:border-ink-700 hover:border-brand-400'
                                }`}
                              title={isDefault ? `${d}（默认）` : d}
                            >
                              {d}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.departmentsHint}</p>
                    </div>

                    {/* 4. 模拟对象数 */}
                    <div>
                      <label className="label">{DASHBOARD.nStakeholders}</label>
                      <input
                        type="number"
                        min={6}
                        max={24}
                        value={params.n_stakeholders}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v)) setNStakeholders(Math.max(6, Math.min(24, Math.round(v))))
                        }}
                        className="input"
                      />
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.nStakeholdersHint}</p>
                    </div>

                    {/* 5. 外部因素 */}
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="label !mb-0">{DASHBOARD.externalFactors}</label>
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">
                          {params.external_factors.length} / {MAX_EXTERNAL_FACTORS}
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        value={externalText}
                        onChange={(e) => onExternalTextChange(e.target.value)}
                        placeholder={DASHBOARD.externalFactorsPlaceholder}
                        className="input min-h-[80px] py-2 leading-relaxed resize-y"
                      />
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.externalFactorsHint}</p>
                    </div>

                    {/* 6. 涌现策略 */}
                    <div>
                      <label className="label">{DASHBOARD.emergencePolicy}</label>
                      <select
                        value={params.emergence_policy}
                        onChange={(e) => setEmergence(e.target.value as EmergencePolicy)}
                        className="input"
                      >
                        {(Object.keys(EMERGENCE_POLICY_LABELS) as EmergencePolicy[]).map((k) => (
                          <option key={k} value={k}>{EMERGENCE_POLICY_LABELS[k]}</option>
                        ))}
                      </select>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.emergencePolicyHint}</p>
                    </div>

                    {/* 7. 收敛策略 */}
                    <div>
                      <label className="label">{DASHBOARD.convergencePolicy}</label>
                      <select
                        value={params.convergence_policy}
                        onChange={(e) => setConvergence(e.target.value as ConvergencePolicy)}
                        className="input"
                      >
                        {(Object.keys(CONVERGENCE_POLICY_LABELS) as ConvergencePolicy[]).map((k) => (
                          <option key={k} value={k}>{CONVERGENCE_POLICY_LABELS[k]}</option>
                        ))}
                      </select>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.convergencePolicyHint}</p>
                    </div>

                    {/* 8. hours */}
                    <div>
                      <label className="label">
                        {DASHBOARD.hours}: <span className="font-bold text-brand-600">{hours} {DASHBOARD.hoursSuffix}</span>
                      </label>
                      <input
                        type="range" min={24} max={168} value={hours}
                        onChange={(e) => onChangeHours(Number(e.target.value))}
                        className="w-full accent-brand-600"
                      />
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.hoursHint}</p>
                    </div>

                    {/* 9. 报告风格 */}
                    <div>
                      <label className="label">{DASHBOARD.reportStyle}</label>
                      <select
                        value={style}
                        onChange={(e) => onChangeStyle(e.target.value as ReportStyle)}
                        className="input"
                      >
                        {Object.entries(REPORT_STYLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                )}

                {tab === 'company' && (
                  <motion.div
                    key="company"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40 space-y-5"
                  >
                    {/* 公司名称 + AI 一键提取 (P3-A Phase 2) */}
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="label !mb-1 flex items-center gap-1.5">
                          <Building2 size={13} /> {DASHBOARD.companyName}
                        </label>
                        <input
                          type="text"
                          value={params.company_name || ''}
                          placeholder="例: 湖北某科技股份公司"
                          onChange={(e) => onChangeParams({ ...params, company_name: e.target.value })}
                          className="input"
                        />
                        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{DASHBOARD.companyNameHint}</p>
                      </div>
                      <button
                        type="button"
                        disabled={uploadsCount === 0 || isPrefilling}
                        onClick={onPrefillFromLLM}
                        title={uploadsCount === 0 ? DASHBOARD.prefillEmpty : DASHBOARD.prefillButtonTitle}
                        className="h-9 px-3 rounded-xl text-xs font-semibold border
                                   bg-gradient-to-r from-brand-500 to-accent-500
                                   hover:from-brand-600 hover:to-accent-600
                                   text-white border-transparent
                                   disabled:opacity-40 disabled:cursor-not-allowed
                                   flex items-center gap-1.5 shrink-0"
                      >
                        {isPrefilling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {DASHBOARD.prefillButton}
                      </button>
                    </div>

                    {/* Org Structure */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="label !mb-0 flex items-center gap-1.5">
                          <Building2 size={13} /> 公司内部结构
                          <span className="text-[10px] text-ink-400 font-normal">
                            （部门/团队 · 汇报线 · 规模 · 关注 KPI）
                          </span>
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-ink-500 dark:text-ink-400">
                            {orgCount} / {MAX_ORG_NODES}
                          </span>
                          <button
                            type="button"
                            disabled={orgCount >= MAX_ORG_NODES}
                            onClick={() => {
                              const id = `org_${Date.now().toString(36)}`
                              setOrgStructure([
                                ...params.org_structure,
                                { id, name: '', headcount: undefined, kpi_focus: '' },
                              ])
                            }}
                            className="text-[10px] h-7 px-2 rounded border border-ink-200 dark:border-ink-700
                                       text-ink-600 dark:text-ink-300 hover:border-brand-400
                                       flex items-center gap-0.5 disabled:opacity-40"
                          >
                            <Plus size={10} /> 添加
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {params.org_structure.length === 0 && (
                          <p className="text-xs text-ink-400 italic px-3 py-3 text-center
                                        border border-dashed border-ink-200/60 dark:border-ink-800/60 rounded-lg">
                            尚未填写 — 留空将使用默认部门（{DEFAULT_DEPARTMENTS.join('/')}）
                          </p>
                        )}
                        {params.org_structure.map((node, i) => (
                          <div
                            key={node.id}
                            className="grid grid-cols-12 gap-1.5 items-center px-2 py-1.5 rounded-md
                                       bg-white/40 dark:bg-ink-900/30 border border-ink-200/40 dark:border-ink-800/40"
                          >
                            <input
                              type="text"
                              value={node.name}
                              placeholder="部门/团队名"
                              onChange={(e) => {
                                const next = [...params.org_structure]
                                next[i] = { ...node, name: e.target.value }
                                setOrgStructure(next)
                              }}
                              className="col-span-4 input !h-7 !text-xs"
                            />
                            <input
                              type="text"
                              value={node.reports_to || ''}
                              placeholder="汇报给 (部门名)"
                              onChange={(e) => {
                                const next = [...params.org_structure]
                                next[i] = { ...node, reports_to: e.target.value || undefined }
                                setOrgStructure(next)
                              }}
                              className="col-span-3 input !h-7 !text-xs"
                            />
                            <input
                              type="number"
                              min={1}
                              value={node.headcount ?? ''}
                              placeholder="人数"
                              onChange={(e) => {
                                const v = e.target.value === '' ? undefined : Number(e.target.value)
                                const next = [...params.org_structure]
                                next[i] = { ...node, headcount: v }
                                setOrgStructure(next)
                              }}
                              className="col-span-1 input !h-7 !text-xs"
                            />
                            <input
                              type="text"
                              value={node.kpi_focus || ''}
                              placeholder="关注 KPI"
                              onChange={(e) => {
                                const next = [...params.org_structure]
                                next[i] = { ...node, kpi_focus: e.target.value || undefined }
                                setOrgStructure(next)
                              }}
                              className="col-span-3 input !h-7 !text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => setOrgStructure(params.org_structure.filter((_, j) => j !== i))}
                              className="col-span-1 h-7 text-ink-400 hover:text-rose-500
                                         flex items-center justify-center"
                              title="删除"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Financials */}
                    <div>
                      <label className="label !mb-1.5 flex items-center gap-1.5">
                        <TrendingUp size={13} /> 公司经营数据
                        <span className="text-[10px] text-ink-400 font-normal">
                          （{finFilled} / 7 项已填 — 影响 Agent 决策, 现金流紧张 → 削减成本）
                        </span>
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {([
                          ['revenue_yi', '年营收 (亿)', 'number', 0, 10000],
                          ['gross_margin_pct', '毛利率 (%)', 'number', -100, 100],
                          ['net_margin_pct', '净利率 (%)', 'number', -100, 100],
                          ['growth_rate_pct', '增长率 (%)', 'number', -100, 200],
                          ['cash_runway_months', '现金跑道 (月)', 'number', 0, 60],
                          ['total_headcount', '总人数', 'number', 1, 100000],
                          ['monthly_burn_wan', '月烧钱 (万)', 'number', 0, 100000],
                        ] as const).map(([key, label, type, min, max]) => (
                          <div key={key}>
                            <label className="text-[10px] text-ink-500 dark:text-ink-400 block mb-0.5">
                              {label}
                            </label>
                            <input
                              type={type}
                              min={min} max={max} step="0.1"
                              value={(params.financials as any)[key] ?? ''}
                              placeholder="—"
                              onChange={(e) => {
                                const v = e.target.value === '' ? undefined : Number(e.target.value)
                                setFinancials({ ...params.financials, [key]: v })
                              }}
                              className="input !h-7 !text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {tab === 'market' && (
                  <motion.div
                    key="market"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40 space-y-5"
                  >
                    {/* Market size + growth + stance */}
                    <div>
                      <label className="label !mb-1.5 flex items-center gap-1.5">
                        <Globe2 size={13} /> 外部基础环境
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-ink-500 dark:text-ink-400 block mb-0.5">
                            TAM 市场规模 (亿)
                          </label>
                          <input
                            type="number" min={0} step="0.1"
                            value={params.market.tam_yi ?? ''}
                            placeholder="—"
                            onChange={(e) => setMarket({
                              ...params.market,
                              tam_yi: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            className="input !h-7 !text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-ink-500 dark:text-ink-400 block mb-0.5">
                            行业增速 (%)
                          </label>
                          <input
                            type="number" min={-50} max={200} step="0.1"
                            value={params.market.market_growth_pct ?? ''}
                            placeholder="—"
                            onChange={(e) => setMarket({
                              ...params.market,
                              market_growth_pct: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            className="input !h-7 !text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-ink-500 dark:text-ink-400 block mb-0.5">
                            整体态度
                          </label>
                          <select
                            value={params.market.stance}
                            onChange={(e) => setMarket({ ...params.market, stance: e.target.value as MarketStance })}
                            className="input !h-7 !text-xs"
                          >
                            {(Object.keys(MARKET_STANCE_LABELS) as MarketStance[]).map((k) => (
                              <option key={k} value={k}>{MARKET_STANCE_LABELS[k]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Competitors */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="label !mb-0 flex items-center gap-1.5">
                          <Users size={13} /> 竞品
                          <span className="text-[10px] text-ink-400 font-normal">（每行一条, 最多 {MAX_COMPETITORS}）</span>
                        </label>
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">
                          {compCount} / {MAX_COMPETITORS}
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        value={params.market.competitors.join('\n')}
                        placeholder={'例: 阿里云 / 腾讯云 / 华为云'}
                        onChange={(e) => setMarket({
                          ...params.market,
                          competitors: e.target.value
                            .split(/[\n;,，；]/g)
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .slice(0, MAX_COMPETITORS),
                        })}
                        className="input min-h-[70px] py-2 leading-relaxed resize-y text-xs"
                      />
                    </div>

                    {/* Regulation */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="label !mb-0 flex items-center gap-1.5">
                          <AlertCircle size={13} /> 监管 / 合规
                          <span className="text-[10px] text-ink-400 font-normal">（每行一条, 最多 {MAX_REGULATIONS}）</span>
                        </label>
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">
                          {regCount} / {MAX_REGULATIONS}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={params.market.regulation.join('\n')}
                        placeholder={'例: 数据安全法 / GDPR / 行业准入许可'}
                        onChange={(e) => setMarket({
                          ...params.market,
                          regulation: e.target.value
                            .split(/[\n;,，；]/g)
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .slice(0, MAX_REGULATIONS),
                        })}
                        className="input min-h-[60px] py-2 leading-relaxed resize-y text-xs"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </>
  )
}
