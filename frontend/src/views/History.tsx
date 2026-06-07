/**
 * History - 历史任务完整页 (at /history).
 *
 * 复用 RecentRuns 组件 — 它已有完整功能 (按日期分组 / 多选对比 / 删除 / 复制配置).
 * 本页加: 页面 header + 装饰 filter bar (未来扩展).
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, History as HistoryIcon, Filter } from 'lucide-react'
import api from '../services/api'
import { HISTORY } from '../i18n/zh'
import RecentRuns from '../components/RecentRuns'
import { fadeUp, stagger } from '../lib/motion'

export default function History() {
  // 顶部计数 (单独拉, 不与 RecentRuns 共享 store — 减少耦合)
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get('/pipeline/runs')
      .then((r) => { if (!cancelled) setCount((r.data.runs || []).length) })
      .catch(() => { if (!cancelled) setCount(0) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen" data-history>
      {/* Page header */}
      <section className="px-6 md:px-10 pt-10 md:pt-14 pb-4 max-w-6xl mx-auto">
        <motion.div
          initial="initial" animate="animate" variants={stagger(0.06)}
          className="flex flex-col gap-2"
        >
          <motion.div variants={fadeUp} className="flex items-center gap-2">
            <HistoryIcon size={16} className="text-brand-600 dark:text-brand-400" />
            <h1 className="text-[22px] font-bold text-ink-900 dark:text-white">
              {HISTORY.title}
            </h1>
            {count != null && (
              <span className="text-xs text-ink-400 ml-2">
                {HISTORY.resultCount(count)}
              </span>
            )}
          </motion.div>
          <motion.p variants={fadeUp} className="text-sm text-ink-500 dark:text-ink-400">
            {HISTORY.subtitle}
          </motion.p>
        </motion.div>
      </section>

      {/* Filter bar (visual stub — 实际筛选逻辑在 RecentRuns 内部 useEffect) */}
      <section className="px-6 md:px-10 pb-3 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="card p-3 flex flex-wrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              disabled
              placeholder={HISTORY.searchPlaceholder}
              className="w-full h-9 pl-9 pr-3 rounded-lg
                         bg-ink-50/50 dark:bg-ink-900/40
                         border border-ink-200/60 dark:border-ink-800/60
                         text-sm text-ink-900 dark:text-ink-100
                         placeholder:text-ink-400 dark:placeholder:text-ink-500
                         focus:outline-none focus:border-brand-400/70
                         transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-ink-400" />
            <select
              disabled
              defaultValue="all"
              className="h-9 px-2 rounded-lg text-xs
                         bg-ink-50/50 dark:bg-ink-900/40
                         border border-ink-200/60 dark:border-ink-800/60
                         text-ink-700 dark:text-ink-200
                         cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="all">{HISTORY.filterAll}</option>
            </select>
            <select
              disabled
              defaultValue="all"
              className="h-9 px-2 rounded-lg text-xs
                         bg-ink-50/50 dark:bg-ink-900/40
                         border border-ink-200/60 dark:border-ink-800/60
                         text-ink-700 dark:text-ink-200
                         cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="all">{HISTORY.dateAll}</option>
            </select>
          </div>
        </motion.div>
      </section>

      {/* RecentRuns 主体 — 复用上一步修过的水平 list-item 卡片 */}
      <section className="px-6 md:px-10 pb-16 max-w-6xl mx-auto">
        <RecentRuns />
      </section>
    </div>
  )
}
