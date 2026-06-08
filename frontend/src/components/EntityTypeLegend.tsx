/**
 * EntityTypeLegend — 实体类型图例（MiroFish GraphPanel.vue 风格）
 *
 * 借鉴 /Users/jasonlee/MiroFish/frontend/src/components/GraphPanel.vue:217-225 + 285-299
 * - 10 色 palette 按出现顺序展示
 * - 每行 [色块] [类型名] [count]
 * - 挂到 RealtimeKnowledgeGraph 右上角叠加
 * - 实时根据 graphNodes 变化（useEntityTypes 派生）
 *
 * Implements: mirofish-tier / item #1 (Entity Type Legend)
 */
import { motion } from 'framer-motion'
import { Tag } from 'lucide-react'
import { useEntityTypes } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'

interface EntityTypeLegendProps {
  /** 是否在右上角叠加 (true) 还是独立卡片 (false) */
  overlay?: boolean
}

export default function EntityTypeLegend({ overlay = true }: EntityTypeLegendProps) {
  const stats = useEntityTypes()

  // 空态: 无节点时只渲染 overlay 模式的占位 (不显示独立卡片)
  if (stats.length === 0) {
    return overlay ? null : (
      <div className="card p-3 text-xs text-ink-400">
        {WORKBENCH.entityTypeLegendEmpty}
      </div>
    )
  }

  const totalCount = stats.reduce((acc, s) => acc + s.count, 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={
        overlay
          ? 'absolute top-3 right-3 z-20 bg-white/95 dark:bg-ink-900/95 backdrop-blur-sm ' +
            'border border-ink-200/60 dark:border-ink-700/60 rounded-md shadow-sm ' +
            'px-2.5 py-2 max-w-[200px]'
          : 'card p-3'
      }
      data-testid="entity-type-legend"
    >
      {/* 标题 */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Tag size={10} className="text-ink-500 dark:text-ink-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-700 dark:text-ink-200">
          {WORKBENCH.entityTypeLegendTitle}
        </span>
        <span className="text-[9px] text-ink-400 font-mono ml-auto">
          {totalCount}
        </span>
      </div>

      {/* 列表 */}
      <ul className="space-y-1">
        {stats.map((s) => (
          <li
            key={s.type}
            className="flex items-center gap-1.5 text-[10px] text-ink-600 dark:text-ink-300"
          >
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-white/40"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="font-mono text-ink-500 dark:text-ink-400 tabular-nums">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}
