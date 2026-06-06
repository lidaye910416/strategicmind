/**
 * ConfigCard - 配置参数卡片（hours / style + 复制配置提示 banner）。
 *
 * 来源：原 views/Dashboard.tsx 行 327-431 区块，P2-8 拆出。
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, AlertCircle, Copy, Info } from 'lucide-react'
import { DASHBOARD, DASHBOARD_ACTIONS, REPORT_STYLE_LABELS } from '../../i18n/zh'

export type ReportStyle = 'executive' | 'technical' | 'narrative'

interface Props {
  uploadsCount: number
  showConfig: boolean
  onShowConfig: (show: boolean) => void
  hours: number
  style: ReportStyle
  onChangeHours: (h: number) => void
  onChangeStyle: (s: ReportStyle) => void
  clonedFrom: string | null
  onDismissClone: () => void
}

export default function ConfigCard({
  uploadsCount, showConfig, onShowConfig,
  hours, style, onChangeHours, onChangeStyle,
  clonedFrom, onDismissClone,
}: Props) {
  const ready = uploadsCount > 0
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-ink-50/60 dark:bg-ink-900/40">
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
