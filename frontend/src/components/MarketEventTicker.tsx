/**
 * MarketEventTicker — 实时市场事件滚动条
 *
 * 消费 store.marketEvents (max 30 条，倒序), 每 4s 滚动一条高亮展示
 *
 * 显示规则:
 *  - events.length === 0 → 完全不渲染 (零侵入)
 *  - events.length >= 1 → 顶部一条固定的高亮当前事件卡 (AnimatePresence 切换)
 *  - 自动轮播: 每 4s 切换到下一条
 *
 * Implements: must-tier v2 (实时市场事件)
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown, Activity } from 'lucide-react'
import { WORKBENCH } from '../i18n/zh'
import type { MarketEvent } from '../store/pipeline'

interface Props {
  events: MarketEvent[]
}

const ROTATE_INTERVAL_MS = 4000  // 4s 切换

function getTypeMeta(type: string): { icon: typeof TrendingUp, color: string, label: string } {
  if (type === 'MARKET_UP' || type === 'INDUSTRY_BOOM' || type === 'EXPANSION') {
    return { icon: TrendingUp, color: 'emerald', label: '上行' }
  }
  if (type === 'MARKET_DOWN' || type === 'INDUSTRY_BUST' || type === 'RECESSION') {
    return { icon: TrendingDown, color: 'rose', label: '下行' }
  }
  return { icon: Activity, color: 'blue', label: '市场' }
}

export default function MarketEventTicker({ events }: Props) {
  // 当前展示的索引 (events 是 [newest, ..., oldest] 倒序)
  const [idx, setIdx] = useState(0)

  // 切换事件 (按 interval 滚动)
  useEffect(() => {
    if (events.length <= 1) return
    const t = setInterval(() => {
      setIdx((prev) => (prev + 1) % events.length)
    }, ROTATE_INTERVAL_MS)
    return () => clearInterval(t)
  }, [events.length])

  // events 变化 (新事件到达) 时重置到最新
  useEffect(() => {
    setIdx(0)
  }, [events.length])

  if (events.length === 0) return null

  const current = events[Math.min(idx, events.length - 1)]
  if (!current) return null
  const meta = getTypeMeta(current.type)
  const Icon = meta.icon

  return (
    <div
      data-testid="market-event-ticker"
      className="mx-4 md:mx-10 mt-4 mb-2"
      aria-label={WORKBENCH.marketEventTickerTitle}
    >
      <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border
                       bg-${meta.color}-50/70 dark:bg-${meta.color}-950/20
                       border-${meta.color}-200/60 dark:border-${meta.color}-800/40`}>
        <div className="flex items-center gap-2 shrink-0">
          <Icon size={14} className={`text-${meta.color}-600 dark:text-${meta.color}-400`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider
                            text-${meta.color}-700 dark:text-${meta.color}-300`}>
            {WORKBENCH.marketEventBadge} · {meta.label}
          </span>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${current.type}-${current.ts}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="text-xs text-ink-800 dark:text-ink-100 truncate"
            >
              <span className="font-semibold mr-1.5">{current.description || current.type}</span>
              {current.industry && (
                <span className="text-[10px] text-ink-500 mr-1.5">· {current.industry}</span>
              )}
              {typeof current.gdp_growth === 'number' && (
                <span className={`text-[10px] font-mono font-bold mr-1.5
                                  ${current.gdp_growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {current.gdp_growth >= 0 ? '+' : ''}{current.gdp_growth.toFixed(1)}%
                </span>
              )}
              {current.cycle_label && (
                <span className="text-[10px] text-ink-500">· {current.cycle_label}</span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {events.length > 1 && (
          <span className="text-[10px] font-mono text-ink-400 tabular-nums shrink-0">
            {idx + 1}/{events.length}
          </span>
        )}
      </div>
    </div>
  )
}
