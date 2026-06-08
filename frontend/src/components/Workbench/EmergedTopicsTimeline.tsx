/**
 * 涌现议题时间线 (EmTopicTimeline)
 *
 * 用途：把 store.graphNodes 中"涌现来源"(source === 'emergence')的实体
 *       与同 round 的 belief_updates 配对，按 round 升序列出，让用户看到
 *       "哪一轮冒出了什么议题、相关 Agent 的立场漂移如何"。
 *
 * 数据源：
 *   1) store.graphNodes: 节点含 entity_type + properties.topic + properties.first_seen_round
 *   2) store.simRounds[].belief_updates: 同 round 的 belief delta 数组
 *   3) store.simRounds[].new_entities: 该轮新涌现的实体
 *
 * SSR 兼容：replay 模式 (从 /history 跳进) 时，store 已由 hydrateFromRunId 填满
 *          graphNodes + simRounds，本组件纯派生、无需后端改动。
 *
 * Implements: Workbench "涌现议题时间线" feature1 (feature/history-graph-and-viz)
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Filter, ArrowRight, CircleDot } from 'lucide-react'
import { useGraphNodes, useSimRounds } from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

type FilterKey = 'all' | 'COMPANY' | 'PERSON' | 'PRODUCT' | 'RISK'

const FILTER_OPTIONS: { key: FilterKey; cn: string }[] = [
  { key: 'all', cn: WORKBENCH.emTopicFilterAll },
  { key: 'COMPANY', cn: WORKBENCH.emTopicFilterCompany },
  { key: 'PERSON', cn: WORKBENCH.emTopicFilterPerson },
  { key: 'PRODUCT', cn: WORKBENCH.emTopicFilterProduct },
  { key: 'RISK', cn: WORKBENCH.emTopicFilterRisk },
]

interface EmergedItem {
  id: string
  round: number
  label: string
  entityType: string
  /** 该议题相关的 belief shift 平均值（同一 round 内该 entity 涉及的 belief 更新） */
  beliefDelta: number | null
  /** 出现次数（同一 entity 可能被多 round 引用） */
  count: number
}

export default function EmergedTopicsTimeline() {
  const graphNodes = useGraphNodes()
  const simRounds = useSimRounds()
  const [filter, setFilter] = useState<FilterKey>('all')

  // ---- 派生: 涌现议题列表 (按 round 升序) ----
  const items = useMemo<EmergedItem[]>(() => {
    // 1) 取所有 source === 'emergence' 的节点 (从 graphNodes 里筛)
    const emerged = graphNodes.filter(
      (n) => n.source === 'emergence' || (n.round != null && n.round > 0),
    )
    if (emerged.length === 0 && simRounds.length === 0) return []

    // 2) 构建 (round, entity_id) → belief_delta 聚合 map
    //    从 simRounds[].belief_updates 派生，每条 belief_update 通常含 entity_id / delta
    const beliefByRoundEntity = new Map<string, number[]>()
    for (const r of simRounds) {
      const updates = Array.isArray(r.belief_updates) ? r.belief_updates : []
      for (const u of updates) {
        const eid = String(u.entity_id ?? u.agent_id ?? u.id ?? '')
        if (!eid) continue
        const delta = typeof u.delta === 'number'
          ? u.delta
          : typeof u.belief_delta === 'number'
            ? u.belief_delta
            : typeof u.shift === 'number'
              ? u.shift
              : null
        if (delta == null) continue
        const key = `${r.round}|${eid}`
        const arr = beliefByRoundEntity.get(key) ?? []
        arr.push(delta)
        beliefByRoundEntity.set(key, arr)
      }
    }

    // 3) 聚合每个涌现实体
    const result: EmergedItem[] = emerged.map((n) => {
      const round = Number(n.round ?? n.properties?.first_seen_round ?? 0)
      const eid = String(n.id)
      const key = `${round}|${eid}`
      const deltas = beliefByRoundEntity.get(key) ?? []
      const avg = deltas.length
        ? deltas.reduce((s, d) => s + d, 0) / deltas.length
        : null
      return {
        id: eid,
        round,
        label: n.label ?? n.name ?? eid,
        entityType: n.type ?? n.entity_type ?? 'UNKNOWN',
        beliefDelta: avg,
        count: 1,
      }
    })

    // 4) 按 round 升序，相同 round 按 label 字母序
    return result.sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round
      return a.label.localeCompare(b.label)
    })
  }, [graphNodes, simRounds])

  // ---- 派生: 过滤 ----
  const visibleItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'RISK') {
      return items.filter((i) =>
        /RISK|风险|threat|warning/i.test(i.entityType + i.label),
      )
    }
    return items.filter((i) => i.entityType === filter)
  }, [items, filter])

  // ---- 渲染 ----
  return (
    <section data-testid="em-topic-timeline" className="card p-5 scroll-mt-28">
      {/* 标题 + 过滤 chip */}
      <div className="flex items-center gap-2 mb-3 sticky top-0 bg-white/95 dark:bg-ink-900/95 -mx-5 -mt-5 px-5 pt-5 pb-3 z-10 border-b border-ink-200/40 dark:border-ink-800/40">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
          <Sparkles size={16} />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
            {WORKBENCH.emTopicTitle} ({items.length})
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white">
            {WORKBENCH.emTopicTitle}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <Filter size={12} className="text-ink-400" />
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              data-testid={`em-topic-filter-${opt.key}`}
              className={`text-[10px] px-2 py-1 rounded-full font-semibold transition-colors ${
                filter === opt.key
                  ? 'bg-brand-500 text-white'
                  : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-brand-100 dark:hover:bg-brand-900/40'
              }`}
            >
              {opt.cn}
            </button>
          ))}
        </div>
      </div>

      {/* 空态: runId 存在但 graphNodes 为空 */}
      {items.length === 0 && (
        <div className="text-center py-8 text-ink-400 text-xs">
          {WORKBENCH.emTopicEmpty}
        </div>
      )}

      {/* list-item 列表 (单行布局) */}
      {visibleItems.length > 0 && (
        <div className="space-y-1 max-h-[320px] overflow-y-auto" data-testid="em-topic-list">
          <AnimatePresence>
            {visibleItems.map((it) => (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 h-9 px-2 rounded-md hover:bg-brand-50/60 dark:hover:bg-brand-950/20 transition-colors group"
                data-testid="em-topic-item"
              >
                {/* [time-icon] */}
                <CircleDot
                  size={12}
                  className={
                    it.beliefDelta != null && it.beliefDelta > 0.05
                      ? 'text-emerald-500'
                      : it.beliefDelta != null && it.beliefDelta < -0.05
                        ? 'text-rose-500'
                        : 'text-ink-400'
                  }
                />

                {/* [entity-type 徽章 + label] */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  it.entityType === 'COMPANY'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : it.entityType === 'PERSON'
                      ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
                      : it.entityType === 'PRODUCT'
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                        : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300'
                }`}>
                  {it.entityType}
                </span>
                <span className="text-xs font-medium text-ink-800 dark:text-ink-100 truncate flex-1">
                  {it.label}
                </span>

                {/* [round N · belief +X.X / -Y.Y] */}
                <span className="text-[10px] text-ink-500 font-mono">
                  R{it.round}
                </span>
                <span className={`text-[10px] font-mono font-bold tabular-nums ${
                  it.beliefDelta == null
                    ? 'text-ink-300'
                    : it.beliefDelta > 0.05
                      ? 'text-emerald-600'
                      : it.beliefDelta < -0.05
                        ? 'text-rose-600'
                        : 'text-ink-500'
                }`}>
                  {it.beliefDelta == null
                    ? '—'
                    : `${it.beliefDelta >= 0 ? '+' : ''}${it.beliefDelta.toFixed(2)}`}
                </span>

                {/* [跳转图谱 icon-only] */}
                <button
                  title={WORKBENCH.emTopicJumpHint}
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 inline-flex items-center justify-center rounded text-ink-500 hover:text-brand-600 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-all"
                >
                  <ArrowRight size={12} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  )
}
