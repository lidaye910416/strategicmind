/**
 * ShockToast — 外部冲击浮层
 *
 * 消费 store.recentShocks (max 5 条，倒序), 每次新冲击到达时弹出
 *
 * 设计要点:
 *  - 完全无新冲击时不渲染 (零侵入)
 *  - 持续显示 latest 一条 (直到新冲击替换)
 *  - framer-motion AnimatePresence slide-in
 *  - severity 用颜色: <0.3 绿, 0.3-0.7 琥珀, >0.7 玫红
 *
 * Implements: must-tier v2 (外部冲击提醒)
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { WORKBENCH } from '../i18n/zh'
import type { ShockEvent } from '../store/pipeline'

interface Props {
  shocks: ShockEvent[]
}

const AUTO_DISMISS_MS = 8000  // 8s 自动消失 (新事件到达时再触发)

function getSeverityColor(severity: number): { bg: string, border: string, text: string, label: string } {
  if (severity >= 0.7) {
    return {
      bg: 'bg-rose-50/95 dark:bg-rose-950/40',
      border: 'border-rose-300 dark:border-rose-700/60',
      text: 'text-rose-700 dark:text-rose-300',
      label: '高',
    }
  }
  if (severity >= 0.3) {
    return {
      bg: 'bg-amber-50/95 dark:bg-amber-950/40',
      border: 'border-amber-300 dark:border-amber-700/60',
      text: 'text-amber-700 dark:text-amber-300',
      label: '中',
    }
  }
  return {
    bg: 'bg-emerald-50/95 dark:bg-emerald-950/40',
    border: 'border-emerald-300 dark:border-emerald-700/60',
    text: 'text-emerald-700 dark:text-emerald-300',
    label: '低',
  }
}

export default function ShockToast({ shocks }: Props) {
  // 用于追踪已显示过的 ts 集合, 避免重复弹
  const [visibleKey, setVisibleKey] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // 当新 shock 到达时, 重新触发显示
  useEffect(() => {
    if (shocks.length === 0) {
      setVisibleKey(null)
      setDismissed(false)
      return
    }
    const latest = shocks[0]
    const key = `${latest.factor_name}-${latest.ts}`
    if (key !== visibleKey) {
      setVisibleKey(key)
      setDismissed(false)
    }
  }, [shocks, visibleKey])

  // 自动消失
  useEffect(() => {
    if (!visibleKey || dismissed) return
    const t = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [visibleKey, dismissed])

  if (shocks.length === 0 || dismissed) return null
  const current = shocks[0]
  if (!current) return null
  const color = getSeverityColor(current.severity)

  return (
    <div
      data-testid="shock-toast"
      className="fixed top-16 right-4 z-40 max-w-sm"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={visibleKey}
          initial={{ opacity: 0, x: 40, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className={`card p-3 flex items-start gap-2 ${color.bg} ${color.border} border shadow-soft`}
        >
          <AlertTriangle size={16} className={`${color.text} shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${color.text}`}>
                {WORKBENCH.shockToastTitle}
              </span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded
                                ${color.text} bg-white/60 dark:bg-black/30`}>
                严重度 {color.label} · {(current.severity * 100).toFixed(0)}
              </span>
            </div>
            <div className="text-xs font-semibold text-ink-900 dark:text-white">
              {current.factor_name}
            </div>
            {current.description && (
              <div className="text-[11px] text-ink-600 dark:text-ink-300 mt-0.5 line-clamp-2">
                {current.description}
              </div>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-ink-400 hover:text-ink-700 dark:hover:text-white shrink-0"
            aria-label="dismiss"
          >
            <X size={14} />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
