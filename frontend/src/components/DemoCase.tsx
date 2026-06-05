/**
 * DemoCase - 案例示范：演示如何使用本系统做战略推演。
 *
 * 该组件从后端拉取一份已完成的 run（默认 run_a869a890，
 * 对应"湖北省数字产业发展集团"十五五"战略推演"），
 * 把 7 步流水线每一步的真实产物展示给用户，
 * 并在每一步下告诉用户"这一步在做什么 / 产物是什么 / 用户怎么用"。
 *
 * Implements: US-100 案例示范
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BookOpen, FileText, Activity, Database,
  GitBranch, Users, PlayCircle, FileBarChart, ArrowUpRight,
} from 'lucide-react'
import { DEMO, APP_ROUTES } from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'

interface PipelineSnapshot {
  run_id: string
  status: string
  current_stage: string
  progress: number
  completed_stages: string[]
  artifacts: Record<string, any>
  config: Record<string, any>
}

const STAGE_META: Array<{
  key: string
  icon: any
  goal: string
  output: string
  insight: string
  fn: (s: PipelineSnapshot | null) => { label: string; value: string }[]
}> = [
  {
    key: 'SEED_PARSING',
    icon: BookOpen,
    goal: DEMO.step1Goal,
    output: DEMO.step1OutDesc,
    insight: DEMO.step1Insight,
    fn: (s) => {
      const docs = s?.artifacts?.SEED_PARSING?.documents || []
      return [
        { label: '登记文档数', value: `${s?.artifacts?.SEED_PARSING?.count ?? docs.length} 份` },
        { label: '示例文件名', value: docs[0]?.title || DEMO.caseFileName },
        { label: '字符长度', value: docs[0]?.len ? `${docs[0].len} 字` : '-' },
      ]
    },
  },
  {
    key: 'GRAPH_BUILDING',
    icon: GitBranch,
    goal: DEMO.step2Goal,
    output: DEMO.step2OutDesc,
    insight: DEMO.step2Insight,
    fn: (s) => {
      const a = s?.artifacts?.GRAPH_BUILDING || {}
      return [
        { label: '已处理文档', value: `${a.documents_processed ?? 0} 份` },
        { label: '识别实体数', value: `${a.entities_created ?? 0} 个` },
        { label: '建立关系数', value: `${a.relations_created ?? 0} 条` },
      ]
    },
  },
  {
    key: 'ENTITY_EXTRACTION',
    icon: Database,
    goal: DEMO.step3Goal,
    output: DEMO.step3OutDesc,
    insight: DEMO.step3Insight,
    fn: (s) => {
      const a = s?.artifacts?.ENTITY_EXTRACTION || {}
      return [
        { label: '实体抽取数', value: `${a.entities_created ?? 0} 个` },
        { label: '关系抽取数', value: `${a.relations_created ?? 0} 条` },
        { label: '下游用途', value: '供 GraphRAG 检索' },
      ]
    },
  },
  {
    key: 'PROFILE_GENERATION',
    icon: Users,
    goal: DEMO.step4Goal,
    output: DEMO.step4OutDesc,
    insight: DEMO.step4Insight,
    fn: (s) => {
      const a = s?.artifacts?.PROFILE_GENERATION || {}
      const agents = a.agents || []
      const first = agents[0]
      return [
        { label: 'Agent 总数', value: `${a.count ?? agents.length} 个` },
        { label: '类型示例', value: first?.type || '-' },
        { label: '影响力权重', value: first?.influence_weight != null ? `${first.influence_weight}` : '-' },
        { label: '名称示例', value: first?.name || '-' },
      ]
    },
  },
  {
    key: 'CONFIG_GENERATION',
    icon: Activity,
    goal: DEMO.step5Goal,
    output: DEMO.step5OutDesc,
    insight: DEMO.step5Insight,
    fn: (s) => {
      const cfg = s?.artifacts?.CONFIG_GENERATION?.sim_config
      return [
        { label: '推演回合数', value: cfg ? `${cfg.max_rounds} 轮` : '-' },
        { label: '模拟时长', value: cfg ? `${cfg.simulated_hours} 小时` : '-' },
        { label: '监控指标', value: cfg ? `${(cfg.metrics || []).length} 个` : '-' },
      ]
    },
  },
  {
    key: 'SIMULATION_RUNNING',
    icon: PlayCircle,
    goal: DEMO.step6Goal,
    output: DEMO.step6OutDesc,
    insight: DEMO.step6Insight,
    fn: (s) => {
      const a = s?.artifacts?.SIMULATION_RUNNING || {}
      const rounds = a.round_results || []
      const actionsCount = rounds.reduce(
        (acc: number, r: any) => acc + (r.actions?.length || 0), 0
      )
      return [
        { label: '已完成回合', value: `${a.current_round ?? rounds.length} / ${a.total_rounds ?? rounds.length}` },
        { label: '总行动数', value: `${actionsCount} 次` },
        { label: '每回合小时', value: rounds[0]?.simulated_hour != null ? `第 1 回合 ${rounds[0].simulated_hour}h` : '-' },
      ]
    },
  },
  {
    key: 'REPORT_GENERATING',
    icon: FileBarChart,
    goal: DEMO.step7Goal,
    output: DEMO.step7OutDesc,
    insight: DEMO.step7Insight,
    fn: (s) => {
      const a = s?.artifacts?.REPORT_GENERATING || {}
      return [
        { label: '报告 ID', value: a.report_id || s?.run_id || '-' },
        { label: '报告长度', value: a.content_length ? `${a.content_length} 字` : '-' },
        { label: '落盘路径', value: a.path || '-' },
      ]
    },
  },
]

const TITLE_BY_STAGE: Record<string, string> = {
  SEED_PARSING: DEMO.step1Title,
  GRAPH_BUILDING: DEMO.step2Title,
  ENTITY_EXTRACTION: DEMO.step3Title,
  PROFILE_GENERATION: DEMO.step4Title,
  CONFIG_GENERATION: DEMO.step5Title,
  SIMULATION_RUNNING: DEMO.step6Title,
  REPORT_GENERATING: DEMO.step7Title,
}

const DEMO_RUN_ID = 'run_a869a890'

export default function DemoCase() {
  const [snap, setSnap] = useState<PipelineSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/pipeline/${DEMO_RUN_ID}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSnap(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      {/* 输入文档 */}
      <div className="rounded-2xl border border-ink-200/60 dark:border-ink-800/60
                      bg-gradient-to-br from-white to-brand-50/40
                      dark:from-ink-900/60 dark:to-brand-950/20
                      p-5 shadow-card">
        <div className="text-[11px] font-bold tracking-wider uppercase
                        text-ink-500 dark:text-ink-400 mb-1">
          📥 {DEMO.caseDocBackground}
        </div>
        <div className="text-sm text-ink-800 dark:text-ink-200">
          {DEMO.caseDocBackgroundDesc}
        </div>
        <div className="mt-3 text-xs font-mono text-ink-600 dark:text-ink-300
                        bg-ink-100/60 dark:bg-ink-800/50 inline-block px-2 py-1 rounded">
          {DEMO.caseFileName}
        </div>
      </div>

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400">无法加载案例数据：{error}</div>
      )}

      <motion.ol
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="space-y-3"
      >
        {STAGE_META.map((stage, idx) => {
          const Icon = stage.icon
          const facts = stage.fn(snap)
          const isDone = snap?.completed_stages?.includes(stage.key)
          return (
            <motion.li
              key={stage.key}
              variants={fadeUp}
              className="rounded-2xl border border-ink-200/60 dark:border-ink-800/60
                         bg-white/80 dark:bg-ink-900/50 p-5
                         hover:border-brand-300 dark:hover:border-brand-700
                         hover:shadow-card transition-all duration-200"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-lg inline-flex items-center justify-center
                                 ${isDone
                                   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                   : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'}`}>
                  <Icon size={15} />
                </div>
                <h3 className="text-sm font-semibold text-ink-900 dark:text-white">
                  {TITLE_BY_STAGE[stage.key]}
                </h3>
                <span className="text-[10px] text-ink-400 dark:text-ink-500 font-mono">
                  STEP {String(idx + 1).padStart(2, '0')}
                </span>
                {isDone && (
                  <span className="badge-completed ml-auto">已产出</span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="font-bold text-ink-500 dark:text-ink-400 mb-1.5 uppercase tracking-wider text-[10px]">
                    {DEMO.stageGoalTitle}
                  </div>
                  <p className="text-ink-700 dark:text-ink-200 leading-relaxed">{stage.goal}</p>
                </div>
                <div>
                  <div className="font-bold text-ink-500 dark:text-ink-400 mb-1.5 uppercase tracking-wider text-[10px]">
                    {DEMO.stageOutputTitle}
                  </div>
                  <p className="text-ink-700 dark:text-ink-200 leading-relaxed mb-1.5">{stage.output}</p>
                  <ul className="space-y-0.5 bg-ink-50/60 dark:bg-ink-900/40 rounded-lg p-2">
                    {facts.map((f, i) => (
                      <li key={i} className="flex items-baseline gap-1.5">
                        <span className="text-ink-500 dark:text-ink-400 shrink-0">{f.label}:</span>
                        <span className="text-ink-800 dark:text-ink-100 font-mono text-[11px] break-all">
                          {f.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-bold text-ink-500 dark:text-ink-400 mb-1.5 uppercase tracking-wider text-[10px]">
                    {DEMO.stageInsightTitle}
                  </div>
                  <p className="text-ink-700 dark:text-ink-200 leading-relaxed">{stage.insight}</p>
                </div>
              </div>
            </motion.li>
          )
        })}
      </motion.ol>

      <div className="flex flex-wrap gap-2 pt-2">
        <Link to={APP_ROUTES.report(DEMO_RUN_ID)} className="btn-primary h-9 px-4 text-sm">
          <FileText size={14} /> {DEMO.goToReport} <ArrowUpRight size={12} />
        </Link>
        <Link to={APP_ROUTES.simulation(DEMO_RUN_ID)} className="btn-ghost h-9 px-4 text-sm">
          <Activity size={14} /> {DEMO.goToSimulation} <ArrowUpRight size={12} />
        </Link>
      </div>
    </div>
  )
}
