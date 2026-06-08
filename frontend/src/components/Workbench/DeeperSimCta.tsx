/**
 * 进一步推演 CTA (DeeperSimCta)
 *
 * 用途：在 run 状态变为 completed/failed 时, 基于本轮涌现的实体 + belief_shift,
 *       自动建议 3 个可继续推演的方向。点击直接复用 lastRunConfig 启动新 run。
 *
 * 数据源：
 *   - store.snapshot.status
 *   - store.simRounds 后 1-2 轮
 *   - store.lastRunConfig 作为新 run 的 seed
 *
 * 空态：!runId / running / simRounds 空 → 兜底 1 张建议 "重试相同配置"
 *
 * Implements: Workbench "进一步推演 CTA" feature3 (feature/history-graph-and-viz)
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Target, ShieldAlert, Repeat, ChevronDown, ChevronUp, ArrowRight, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  usePipelineStore, useSimRounds, useGraphNodes, useStatus, useRunId, useLastRunConfig,
} from '../../store/pipeline'
import { WORKBENCH, APP_ROUTES } from '../../i18n/zh'

type SuggestionKind = 'focus' | 'risk' | 'iterate' | 'fallback'

interface Suggestion {
  kind: SuggestionKind
  title: string
  reason: string
  /** 改写的 user_params 字段 (深合并到 lastRunConfig.user_params) */
  overrides: Record<string, any>
  /** 副标题上展示的具体参数 */
  diff: string
}

const ICONS: Record<SuggestionKind, any> = {
  focus: Target,
  risk: ShieldAlert,
  iterate: Repeat,
  fallback: RefreshCcw,
}

const TITLE_KEYS: Record<SuggestionKind, string> = {
  focus: WORKBENCH.deeperSimFocusCard,
  risk: WORKBENCH.deeperSimRiskCard,
  iterate: WORKBENCH.deeperSimIterateCard,
  fallback: WORKBENCH.deeperSimFallback,
}

export default function DeeperSimCta() {
  const runId = useRunId()
  const status = useStatus()
  const simRounds = useSimRounds()
  const graphNodes = useGraphNodes()
  const lastRunConfig = useLastRunConfig()
  const startPipeline = usePipelineStore((s) => s.startPipeline)
  const [expanded, setExpanded] = useState(true)
  const [starting, setStarting] = useState(false)

  // ---- 派生 3 个建议 ----
  const suggestions: Suggestion[] = useMemo(() => {
    if (simRounds.length === 0) {
      return [{
        kind: 'fallback',
        title: TITLE_KEYS.fallback,
        reason: 'run 异常退出, 复用相同配置再跑一次',
        overrides: {},
        diff: '配置不变',
      }]
    }

    // 取最后 2 轮
    const last2 = simRounds.slice(-2)
    // 收集涌现实体 (从 last2 轮的 new_entities + store.graphNodes 中涌现节点)
    const emergedIds = new Set<string>()
    const emergedLabels: string[] = []
    for (const r of last2) {
      for (const n of r.new_entities ?? []) {
        emergedIds.add(String(n.id))
        emergedLabels.push(n.label ?? n.name ?? String(n.id))
      }
    }
    for (const n of graphNodes) {
      if (n.source === 'emergence' || (n.round != null && n.round > 0)) {
        emergedIds.add(String(n.id))
        if (!emergedLabels.includes(n.label ?? n.name ?? String(n.id))) {
          emergedLabels.push(n.label ?? n.name ?? String(n.id))
        }
      }
    }

    // 收集 belief shifts
    // (后续可在此聚合 belief_shift_count 用于文案, 当前未直接用)

    // 找出 |delta| 最大的实体
    let highShiftEntity: { id: string; label: string; delta: number } | null = null
    for (const r of last2) {
      for (const u of (r.belief_updates ?? [])) {
        const eid = String(u.entity_id ?? u.agent_id ?? '')
        if (!eid) continue
        const delta = Math.abs(typeof u.delta === 'number' ? u.delta
          : typeof u.belief_delta === 'number' ? u.belief_delta
          : typeof u.shift === 'number' ? u.shift : 0)
        if (!highShiftEntity || delta > highShiftEntity.delta) {
          highShiftEntity = { id: eid, label: String(u.label ?? u.entity_label ?? eid), delta }
        }
      }
    }

    // 是否出现新风险因子
    const hasNewRisk = emergedLabels.some((l) => /RISK|风险|threat|warning/i.test(l))

    const result: Suggestion[] = []

    // 1) focus card: 关注高 shift 实体
    if (highShiftEntity) {
      result.push({
        kind: 'focus',
        title: TITLE_KEYS.focus,
        reason: `${highShiftEntity.label} 立场漂移最强 (|Δ|=${highShiftEntity.delta.toFixed(2)}), 单独聚焦再推`,
        overrides: { focus_entity: highShiftEntity.id, focus_mode: 'entity' },
        diff: `focus_entity=${highShiftEntity.id}`,
      })
    }

    // 2) risk card: 出现新风险
    if (hasNewRisk) {
      result.push({
        kind: 'risk',
        title: TITLE_KEYS.risk,
        reason: '本轮出现新风险因子, 调高风险厌恶参数看防御性决策',
        overrides: { risk_aversion: 0.8, emergence_policy: 'defensive' },
        diff: 'risk_aversion=0.8 / emergence=defensive',
      })
    }

    // 3) iterate card: 深化未收敛议题 (增加回合数)
    const totalRounds = simRounds.length
    result.push({
      kind: 'iterate',
      title: TITLE_KEYS.iterate,
      reason: `本轮 ${totalRounds} 回合未完全收敛, 增加推演回合数 + 调高 max_rounds`,
      overrides: { max_rounds: (totalRounds + 6), convergence_threshold: 0.05 },
      diff: `max_rounds=${totalRounds + 6}`,
    })

    return result
  }, [simRounds, graphNodes])

  // ---- 渲染条件 ----
  if (!runId) return null
  if (status === 'running' || status === 'paused') return null
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return null

  // ---- 点击应用: 启动新 run ----
  const handleApply = async (s: Suggestion) => {
    setStarting(true)
    try {
      const cfg: Record<string, any> = (lastRunConfig && Object.keys(lastRunConfig).length > 0)
        ? JSON.parse(JSON.stringify(lastRunConfig))
        : { simulation_hours: 72, report_style: 'executive' }
      // 把 overrides 合并到 user_params
      cfg.user_params = { ...(cfg.user_params ?? {}), ...s.overrides }
      // 标记为 derived from CTA
      cfg._derived_from = runId
      await startPipeline(cfg)
    } catch (e) {
      console.error('启动新一轮失败', e)
    } finally {
      setStarting(false)
    }
  }

  const n_entities = graphNodes.length
  const n_shifts = simRounds.reduce((s, r) => s + (r.belief_shift_count ?? r.belief_updates_count ?? 0), 0)

  return (
    <section data-testid="deeper-sim-cta" className="card p-5 scroll-mt-28">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-brand-500 inline-flex items-center justify-center text-white shadow-soft">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
            {WORKBENCH.deeperSimTitle}
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white">
            {WORKBENCH.deeperSimSubtitle(n_entities, n_shifts)}
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          data-testid="deeper-sim-toggle"
          className="w-7 h-7 inline-flex items-center justify-center rounded text-ink-500 hover:text-brand-600 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
          aria-label={expanded ? '折叠建议' : '展开建议'}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2" data-testid="deeper-sim-suggestions">
              {suggestions.map((s) => {
                const Icon = ICONS[s.kind]
                return (
                  <div
                    key={s.kind}
                    data-testid={`deeper-sim-card-${s.kind}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-white/40 dark:bg-ink-900/30 hover:border-brand-300 dark:hover:border-brand-700 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/15 to-accent-500/15 inline-flex items-center justify-center text-brand-600 shrink-0">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                        {s.title}
                      </div>
                      <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5 truncate">
                        {s.reason}
                      </div>
                      <div className="text-[10px] font-mono text-ink-400 mt-0.5">
                        将修改参数: {s.diff}
                      </div>
                    </div>
                    <button
                      onClick={() => handleApply(s)}
                      disabled={starting}
                      data-testid={`deeper-sim-apply-${s.kind}`}
                      title="应用此方向并启动新 run"
                      className="opacity-60 group-hover:opacity-100 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-all disabled:opacity-30"
                    >
                      {starting ? <RefreshCcw size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="mt-3 text-[10px] text-ink-500 dark:text-ink-400 flex items-center gap-2">
              <span>或自定义参数 →</span>
              <Link to={APP_ROUTES.home} className="text-brand-600 dark:text-brand-400 hover:underline font-semibold">
                {WORKBENCH.deeperSimCtaCustomize}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
