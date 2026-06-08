/**
 * YearAdvancedBanner — 跨年推演完成 banner
 *
 * 消费 store.yearAdvanced (YearAdvancedEvent | null), 每次 year_advanced SSE 事件触发显示
 *
 * 设计要点:
 *  - yearAdvanced === null → 不渲染
 *  - 显示后用户可手动关闭 (X 按钮) → clearYearAdvanced
 *  - 渐变背景突出庆祝感
 *
 * Implements: must-tier v2 (跨年推演完成提醒)
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Calendar, X, Sparkles } from 'lucide-react'
import { WORKBENCH } from '../i18n/zh'
import type { YearAdvancedEvent } from '../store/pipeline'
import { usePipelineStore } from '../store/pipeline'

interface Props {
  yearAdvanced: YearAdvancedEvent | null
}

export default function YearAdvancedBanner({ yearAdvanced }: Props) {
  const clear = usePipelineStore((s) => s.clearYearAdvanced)

  if (!yearAdvanced) return null

  return (
    <AnimatePresence>
      <motion.div
        data-testid="year-advanced-banner"
        key={`${yearAdvanced.year}-${yearAdvanced.ts}`}
        initial={{ opacity: 0, y: -16, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16, scale: 0.95 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        className="mx-4 md:mx-10 mt-4 mb-2
                   bg-gradient-to-r from-amber-50 via-amber-100/60 to-amber-50
                   dark:from-amber-950/30 dark:via-amber-900/20 dark:to-amber-950/30
                   border border-amber-200/80 dark:border-amber-700/50
                   rounded-xl shadow-soft p-4 flex items-start gap-3"
        role="status"
        aria-live="polite"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500
                        inline-flex items-center justify-center text-white shrink-0 shadow-soft">
          <Calendar size={18} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Sparkles size={12} className="text-amber-600 dark:text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-300">
              {WORKBENCH.yearAdvancedTitle}
            </span>
          </div>
          <div className="text-sm font-bold text-ink-900 dark:text-white">
            {WORKBENCH.yearAdvancedSubtitle(yearAdvanced.year, yearAdvanced.rounds_added)}
          </div>
          {typeof yearAdvanced.entities_count === 'number' && yearAdvanced.entities_count > 0 && (
            <div className="text-[11px] text-ink-600 dark:text-ink-300 mt-1">
              本轮新涌现实体 <span className="font-mono font-bold text-amber-700 dark:text-amber-300">{yearAdvanced.entities_count}</span> 个
            </div>
          )}
        </div>

        <button
          onClick={clear}
          className="text-ink-400 hover:text-ink-700 dark:hover:text-white shrink-0
                     p-1 rounded-md hover:bg-amber-100/60 dark:hover:bg-amber-900/30"
          aria-label="close"
        >
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
