/**
 * ActionCard - 单一动作卡（RoundTimeline 的子组件）
 *
 * 从 RoundTimeline.tsx 抽出（避免单文件超 500 行）。
 * 5 种视觉变体：纯文本 / 引用块 / 数字 / 二元表态 / 静默。
 */
import { motion } from 'framer-motion'
import {
  ChevronRight, EyeOff, Building2, Globe,
} from 'lucide-react'
import { actionMeta, CHANNEL_LABELS, classifyPlatform } from './roundTimelineMeta'

export interface Action {
  action_type: string
  actor_id: string
  actor_name?: string
  public_description: string
  private_intent: string
  target_ids: string[]
  propagation_channels: string[]
  is_hidden: boolean
  metadata: Record<string, any>
  timestamp?: string
  platform?: 'external' | 'internal'
}

interface Props {
  action: Action
  idx: number
}

export default function ActionCard({ action, idx }: Props) {
  const meta = actionMeta(action.action_type)
  const Icon = meta.icon
  const hasContent = action.public_description?.trim() || action.private_intent?.trim()
  const isHidden = action.is_hidden
  const platform = action.platform || classifyPlatform(action)
  // Action unique id for dedup
  const actionId = action.metadata?.id || `${action.actor_id}-${action.action_type}-${action.timestamp || idx}-${idx}`

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.3) }}
      className="relative pl-10"
      data-action-id={actionId}
    >
      {/* 时间线节点 */}
      <div className="absolute left-2.5 top-4 -translate-x-1/2">
        <div className={`w-3 h-3 rounded-full ${isHidden ? 'bg-ink-400' : 'bg-brand-500'} ring-4 ring-white dark:ring-ink-900`} />
      </div>

      <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5
                       hover:shadow-card transition-all duration-200 group`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className={`w-7 h-7 rounded-lg inline-flex items-center justify-center
                          ${meta.color} bg-white dark:bg-ink-900/60 border ${meta.border}`}>
            <Icon size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink-900 dark:text-white truncate">
              {action.actor_name || action.actor_id}
            </div>
            <div className={`text-[10px] ${meta.color} uppercase tracking-wider font-semibold`}>
              {meta.label}
            </div>
          </div>
          {/* Platform badge */}
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
              platform === 'internal'
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
            }`}
            title={platform === 'internal' ? '组织内部' : '外部博弈'}
          >
            {platform === 'internal' ? <Building2 size={9} /> : <Globe size={9} />}
            {platform === 'internal' ? '内部' : '外部'}
          </span>
          {isHidden && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                             bg-ink-200/60 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <EyeOff size={9} /> 隐藏
            </span>
          )}
        </div>

        {/* Variant-specific body */}
        {meta.variant === 'numeric' && (action.metadata?.amount || action.metadata?.value) && (
          <div className="text-lg font-mono font-bold text-ink-900 dark:text-white my-1.5">
            {action.metadata.currency || ''}{action.metadata.amount || action.metadata.value}
            {action.metadata.target && (
              <span className="text-xs text-ink-500 font-normal ml-1.5">→ {action.metadata.target}</span>
            )}
          </div>
        )}
        {meta.variant === 'binary' && (
          <div className="flex items-center gap-2 my-1.5">
            {action.metadata?.rating ? (
              <span className={`text-base font-bold ${
                action.metadata.rating === 'UPGRADE' || action.metadata.rating === 'POSITIVE'
                  ? 'text-emerald-600' : 'text-rose-600'
              }`}>
                {action.metadata.rating === 'UPGRADE' || action.metadata.rating === 'POSITIVE' ? '↑' : '↓'}
                {' '}{action.metadata.new_rating || action.metadata.from_to || '评级变动'}
              </span>
            ) : (
              <span className="text-sm text-ink-700">评级动作</span>
            )}
          </div>
        )}
        {meta.variant === 'idle' && (
          <div className="text-xs text-ink-500 dark:text-ink-400 italic my-1.5">
            （静默观望，不采取行动）
          </div>
        )}

        {/* 公共描述 + 引用样式 */}
        {action.public_description?.trim() && meta.variant === 'text' && (
          <div className="text-[13px] text-ink-800 dark:text-ink-100 leading-relaxed mb-1.5">
            {action.public_description}
          </div>
        )}
        {action.private_intent?.trim() && (
          <div className="text-[11px] text-ink-500 dark:text-ink-400 italic leading-relaxed
                          pl-2 border-l-2 border-ink-200 dark:border-ink-700 mt-1.5">
            <span className="font-semibold not-italic">私下意图：</span>{action.private_intent}
          </div>
        )}
        {!hasContent && meta.variant === 'text' && (
          <div className="text-[11px] text-ink-400 dark:text-ink-500 italic mb-1.5">
            （无文字描述）
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {(action.propagation_channels || []).map((c) => {
            const cm = CHANNEL_LABELS[c] || { label: c, color: 'bg-ink-100 text-ink-700' }
            return (
              <span key={c} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cm.color}`}>
                {cm.label}
              </span>
            )
          })}
          {(action.target_ids || []).length > 0 && (
            <span className="text-[10px] text-ink-500 dark:text-ink-400 flex items-center gap-0.5">
              <ChevronRight size={9} /> 影响 {action.target_ids.length} 个目标
            </span>
          )}
          {action.timestamp && (
            <span className="text-[10px] text-ink-400 font-mono ml-auto">
              {action.timestamp.slice(11, 19)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}
