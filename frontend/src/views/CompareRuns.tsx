/**
 * CompareRuns - 多 run 横向对比页。
 *
 * 来源：C3 P2 #35 / D-22；C4 §3.3
 *
 * 路由：/compare?runs=id1,id2,id3（最多 3 个，逗号分隔）
 *
 * 行为：
 *   - 选中状态在 URL ?runs= 里传，不用全局 store
 *   - 拉每个 run 的 /api/pipeline/:id snapshot（已完成 run 才有 artifacts）
 *   - 三个对比图：决议分布（final_state 关键词计数）/ 阵营对比（agent stance 占比）/ 行动直方图
 *   - featureFlags.compareRuns = false 时，路由依然可访问但展示 "未启用" 提示
 *
 * 约束：单文件 < 350 行
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, AlertCircle, Loader2, BarChart3, GitCompare, ArrowRight,
} from 'lucide-react'
import api from '../services/api'
import CompareBarChart, { type SeriesData } from '../components/CompareBarChart'
import Hero from '../components/layout/Hero'
import { COMPARE, APP_ROUTES, COMMON, STAGE_LABELS } from '../i18n/zh'
import { flags } from '../lib/featureFlags'
import { fadeUp, stagger } from '../lib/motion'

/** 颜色：3 个 run 固定 brand / accent / teal，便于一眼区分 */
const RUN_COLORS = ['#6366f1', '#f59e0b', '#10b981']

/** run snapshot 简版类型（仅取对比需要的字段） */
interface RunSnapshot {
  run_id: string
  status: string
  current_stage?: string
  progress: number
  config?: Record<string, any>
  completed_stages?: string[]
  artifacts?: Record<string, any>
}

interface LoadedRun {
  id: string
  ok: boolean
  data?: RunSnapshot
  error?: string
}

/** 关闭态 / 缺 run id 共用提示卡（避免重复 50 行 JSX） */
function DisabledNotice({ title, subtitle, cta }: { title: string; subtitle: string; cta?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card p-8 max-w-md text-center"
      >
        <div className="w-12 h-12 rounded-xl bg-ink-100 dark:bg-ink-800
                        inline-flex items-center justify-center text-ink-500 mb-3">
          <GitCompare size={22} />
        </div>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-white mb-1">{title}</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400 mb-2">{subtitle}</p>
        {cta && (
          <p className="text-xs text-ink-400 font-mono mb-5">{cta}</p>
        )}
        <Link to={APP_ROUTES.home} className="btn-primary h-9">
          <ArrowLeft size={14} /> {COMMON.backToDashboard}
        </Link>
      </motion.div>
    </div>
  )
}

export default function CompareRuns() {
  const [params] = useSearchParams()
  const rawRuns = params.get('runs') || ''
  const runIds = useMemo(
    () => rawRuns.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    [rawRuns],
  )
  const [runs, setRuns] = useState<LoadedRun[]>([])
  const [loading, setLoading] = useState(false)

  const flagOn = flags.compareRuns

  // 拉多个 run snapshot
  useEffect(() => {
    if (runIds.length < 2) {
      setRuns([])
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      runIds.map(async (id): Promise<LoadedRun> => {
        try {
          const r = await api.get(`/pipeline/${encodeURIComponent(id)}`)
          return { id, ok: true, data: r.data as RunSnapshot }
        } catch (e: any) {
          return { id, ok: false, error: e?.message || '加载失败' }
        }
      }),
    ).then((results) => {
      if (!cancelled) {
        setRuns(results)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [runIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // flag 关闭 / URL 校验：均返回提示卡（共用 Layout）
  if (!flagOn) {
    return <DisabledNotice title={`${COMPARE.title}（未启用）`} subtitle="功能当前由 featureFlags.compareRuns = false 关闭。开启后此页面才会渲染图表。" />
  }
  if (runIds.length < 2) {
    return <DisabledNotice title={COMPARE.noRuns} subtitle={COMPARE.pickHint} cta={COMPARE.noRunsLink} />
  }

  const completedRuns = runs.filter((r) => r.ok && r.data && r.data.status === 'completed')
  const okCount = runs.filter((r) => r.ok).length

  return (
    <div className="min-h-screen">
      <Hero
        eyebrow={`对比 ${runIds.length} 个 run`}
        title={COMPARE.title}
        subtitle={COMPARE.subtitle}
        rightSlot={
          <Link to={APP_ROUTES.home} className="btn-ghost h-9">
            <ArrowLeft size={14} /> {COMMON.backToDashboard}
          </Link>
        }
      />

      <div className="px-6 md:px-10 pb-12 max-w-6xl mx-auto space-y-6">
        {/* Run 摘要卡 */}
        <motion.div
          variants={stagger(0.05)}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          {runIds.map((id, i) => {
            const r = runs.find((x) => x.id === id)
            const color = RUN_COLORS[i % RUN_COLORS.length]
            return (
              <motion.div key={id} variants={fadeUp} className="card p-4 border-l-4" style={{ borderLeftColor: color }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="font-mono text-sm text-ink-900 dark:text-white truncate">{id}</div>
                </div>
                {loading && !r ? (
                  <div className="text-[11px] text-ink-400 flex items-center gap-1 mt-2">
                    <Loader2 size={10} className="animate-spin" /> {COMPARE.loading}
                  </div>
                ) : r?.ok ? (
                  <RunSummary run={r.data!} />
                ) : (
                  <div className="text-[11px] text-rose-500 flex items-center gap-1 mt-2">
                    <AlertCircle size={10} /> {r?.error || COMPARE.loadFailed}
                  </div>
                )}
              </motion.div>
            )
          })}
        </motion.div>

        {rawRuns.split(',').filter(Boolean).length > 3 && (
          <div className="text-xs text-amber-600 dark:text-amber-400">{COMPARE.moreThan3}</div>
        )}
        {completedRuns.length < okCount && (
          <div className="text-xs text-amber-600 dark:text-amber-400">
            {COMPARE.notCompleted(okCount - completedRuns.length)}
          </div>
        )}

        {/* 三个对比图 */}
        {completedRuns.length >= 1 && (
          <CompareCharts runs={completedRuns} />
        )}

        {completedRuns.length === 0 && !loading && (
          <div className="card p-8 text-center text-sm text-ink-500 dark:text-ink-400">
            选中的 run 均未完成 / 无 artifacts 数据。请先在 Workbench 完成推演。
            <div className="mt-3">
              <Link to={APP_ROUTES.workbench} className="btn-primary h-9">
                去工作台 <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 单个 run 的元数据摘要（与图无关，复用给三图） */
function RunSummary({ run }: { run: RunSnapshot }) {
  const stages = run.completed_stages || []
  const lastStage = stages[stages.length - 1]
  return (
    <div className="space-y-1 mt-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">
        {run.status === 'completed' ? '已完成' : run.status}
      </div>
      <div className="text-[11px] text-ink-500 dark:text-ink-400">
        {lastStage ? STAGE_LABELS[lastStage] || lastStage : '—'}
      </div>
      <div className="text-[10px] text-ink-400 font-mono">
        progress {Math.round((run.progress || 0) * 100)}%
      </div>
    </div>
  )
}

/** 三个对比图 */
function CompareCharts({ runs }: { runs: LoadedRun[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title={COMPARE.resolutionTitle} subtitle={COMPARE.resolutionSub}>
        <CompareBarChart
          series={buildResolutionSeries(runs)}
          categoryKey="category"
          yLabel="计数"
        />
      </ChartCard>

      <ChartCard title={COMPARE.stanceTitle} subtitle={COMPARE.stanceSub}>
        <CompareBarChart
          series={buildStanceSeries(runs)}
          categoryKey="category"
          yLabel="占比 %"
        />
      </ChartCard>

      <ChartCard title={COMPARE.actionTitle} subtitle={COMPARE.actionSub} wide>
        <CompareBarChart
          series={buildActionSeries(runs)}
          categoryKey="category"
          yLabel="次数"
        />
      </ChartCard>
    </div>
  )
}

function ChartCard({
  title, subtitle, children, wide,
}: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`card p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white flex items-center gap-1.5">
          <BarChart3 size={14} className="text-brand-500" />
          {title}
        </h3>
        <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

// ---- 数据归一化（从 run snapshot → series）----

/** 决议关键词：在 SIMULATION_RUNNING.round_results[*].actions[*].public_description 匹配 */
const RESOLUTION_KEYWORDS = [
  'support', 'supporting', 'oppose', 'opposing', 'neutral',
  '支持', '反对', '中立', '合作', '竞争', '妥协',
]

/** 工具：从 runs 抽 SIMULATION_RUNNING 的所有 actions 文本（reduce 一步） */
function extractActionTexts(runs: LoadedRun[], field: 'public_description' | 'action_type'): {
  run: LoadedRun; index: number; text: string
}[] {
  const out: { run: LoadedRun; index: number; text: string }[] = []
  runs.forEach((r, i) => {
    const rounds = r.data?.artifacts?.SIMULATION_RUNNING?.round_results || []
    for (const rd of rounds) {
      for (const a of (rd.actions || [])) {
        out.push({ run: r, index: i, text: String((a as any)[field] || '') })
      }
    }
  })
  return out
}

function buildResolutionSeries(runs: LoadedRun[]): SeriesData[] {
  const buckets = new Map<string, Record<string, number>>()
  runs.forEach((r) => buckets.set(r.id, {}))
  for (const { run, text } of extractActionTexts(runs, 'public_description')) {
    const lc = text.toLowerCase()
    for (const kw of RESOLUTION_KEYWORDS) {
      if (lc.includes(kw.toLowerCase())) {
        const m = buckets.get(run.id)!
        m[kw] = (m[kw] || 0) + 1
      }
    }
  }
  return runs.map((r, i) => ({
    name: r.id,
    color: RUN_COLORS[i % RUN_COLORS.length],
    data: Object.entries(buckets.get(r.id) || {}).map(([category, value]) => ({ category, value })),
  }))
}

function buildStanceSeries(runs: LoadedRun[]): SeriesData[] {
  const buckets = ['supportive', 'opposed', 'neutral']
  return runs.map((r, i) => {
    const counts: Record<string, number> = { supportive: 0, opposed: 0, neutral: 0 }
    const agents = r.data?.artifacts?.PROFILE_GENERATION?.agents || []
    for (const a of agents) {
      const st = String((a as any).stance || (a as any).initial_stance || '').toLowerCase()
      if (st.includes('support')) counts.supportive++
      else if (st.includes('oppos')) counts.opposed++
      else counts.neutral++
    }
    return {
      name: r.id,
      color: RUN_COLORS[i % RUN_COLORS.length],
      data: buckets.map((category) => ({
        category,
        value: agents.length === 0 ? 0 : Math.round((counts[category] / agents.length) * 100),
      })),
    }
  })
}

function buildActionSeries(runs: LoadedRun[]): SeriesData[] {
  const buckets = new Map<string, Record<string, number>>()
  runs.forEach((r) => buckets.set(r.id, {}))
  for (const { run, text } of extractActionTexts(runs, 'action_type')) {
    const m = buckets.get(run.id)!
    const t = text || 'OTHER'
    m[t] = (m[t] || 0) + 1
  }
  return runs.map((r, i) => ({
    name: r.id,
    color: RUN_COLORS[i % RUN_COLORS.length],
    data: Object.entries(buckets.get(r.id) || {}).map(([category, value]) => ({ category, value })),
  }))
}
