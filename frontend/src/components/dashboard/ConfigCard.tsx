/**
 * ConfigCard - 配置参数卡片。
 *
 * P3-A 重设计：把原来只有 hours + report_style 扩为多维度参数
 * （模拟年限 / 时间步长 / 公司部门 / 模拟对象数 / 外部因素 /
 *  涌现策略 / 收敛策略 / 报告风格 + 兼容旧 hours 字段）。
 *
 * 视觉保持原 motion.section 壳子 + 内部 grid 布局。
 */
import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, AlertCircle, Copy, Info, Sparkles, Building2 } from 'lucide-react'
import { DASHBOARD, DASHBOARD_ACTIONS, REPORT_STYLE_LABELS } from '../../i18n/zh'
import {
  ALL_DEPARTMENTS, DEFAULT_DEPARTMENTS, MAX_EXTERNAL_FACTORS,
  TIME_STEP_LABELS, EMERGENCE_POLICY_LABELS, CONVERGENCE_POLICY_LABELS,
  parseExternalFactors, formatExternalFactors,
  type TimeStep, type EmergencePolicy, type ConvergencePolicy, type Department,
  type SimulationUserParams,
} from '../../types/simulationConfig'

export type ReportStyle = 'executive' | 'technical' | 'narrative'

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
}

export default function ConfigCard({
  uploadsCount, showConfig, onShowConfig,
  hours, style, onChangeHours, onChangeStyle,
  params, onChangeParams,
  clonedFrom, onDismissClone,
}: Props) {
  const ready = uploadsCount > 0

  // 子项 setter（不可变更新，触发父级 re-render）
  const setYears = (years: number) => onChangeParams({ ...params, years })
  const setTimeStep = (time_step: TimeStep) => onChangeParams({ ...params, time_step })
  const setNStakeholders = (n_stakeholders: number) => onChangeParams({ ...params, n_stakeholders })
  const setEmergence = (emergence_policy: EmergencePolicy) => onChangeParams({ ...params, emergence_policy })
  const setConvergence = (convergence_policy: ConvergencePolicy) => onChangeParams({ ...params, convergence_policy })
  const setExternal = (external_factors: string[]) => onChangeParams({ ...params, external_factors })

  // 部门多选 toggle
  const toggleDept = (d: Department) => {
    const has = params.departments.includes(d)
    let next: Department[]
    if (has) {
      // 至少保留 1 个
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
            <span>文档需重新上传（旧文档已过期）</span>
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
              {/* 摘要行：让用户一眼看到推演规模 */}
              <div className="mb-3 px-3 py-2 rounded-lg bg-brand-50/60 dark:bg-brand-950/20 border border-brand-200/50 dark:border-brand-800/50 flex items-center gap-2 text-[11px] text-brand-700 dark:text-brand-300">
                <Sparkles size={12} className="shrink-0" />
                <span className="font-medium">
                  {DASHBOARD.summary(params.years, params.departments.length, params.external_factors.length)}
                  <span className="text-ink-500 dark:text-ink-400 ml-1.5">· 约 {maxRounds} 回合</span>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40">

                {/* ===== 1. 模拟年限（radio 1/3/5） ===== */}
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

                {/* ===== 2. 时间步长（select） ===== */}
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

                {/* ===== 3. 公司部门（多选 chips；跨整行） ===== */}
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

                {/* ===== 4. 模拟对象数（number input） ===== */}
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

                {/* ===== 5. 外部因素（textarea；跨整行） ===== */}
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

                {/* ===== 6. 涌现策略（select） ===== */}
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

                {/* ===== 7. 收敛策略（select） ===== */}
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

                {/* ===== 8. 兼容旧 hours（range slider） ===== */}
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

                {/* ===== 9. 报告风格（保留 3 选 1） ===== */}
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

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </>
  )
}
