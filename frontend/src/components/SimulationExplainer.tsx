/**
 * 推演说明面板 - 让用户清楚知道系统正在做什么
 *
 * 显示内容：
 * 1. 我们用什么替代 OASIS / Zep（本地化模拟）
 * 2. 推演如何运转（部门博弈 + 议题涌现）
 * 3. 实时显示当前正在执行的步骤
 *
 * Implements: US-250 推演可解释性
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Check, Loader2, ChevronDown, ChevronUp,
  Cpu, Network, GitBranch, Brain, Users,
  Database, Activity, FileText,
} from 'lucide-react'

interface PipelineStep {
  key: string
  title: string
  description: string
  icon: any
  status: 'pending' | 'running' | 'completed' | 'failed'
  details?: string
  startTime?: number
  endTime?: number
}

const PIPELINE_STEPS: Omit<PipelineStep, 'status'>[] = [
  {
    key: 'SEED_PARSING',
    title: '解析种子文档',
    description: '读取用户上传的战略规划文档，提取关键事实、实体、声明',
    icon: FileText,
    details: '使用本地文本解析器（替代 MiroFish 的 Zep Cloud），支持 PDF/Word/TXT',
  },
  {
    key: 'GRAPH_BUILDING',
    title: '构建知识图谱',
    description: '从文档中识别实体（组织/人物/业务/技术）并建立关系',
    icon: Network,
    details: '使用 nano-graphRAG（本地替代 Zep），保存到本地 JSON 文件',
  },
  {
    key: 'ENTITY_EXTRACTION',
    title: '抽取实体关系',
    description: '细粒度抽取实体属性和关系三元组',
    icon: Database,
    details: 'LLM 驱动的实体-关系-属性三元组抽取',
  },
  {
    key: 'PROFILE_GENERATION',
    title: '生成 Agent 画像',
    description: '为每个部门 / 利益相关方生成带 KPI 的画像',
    icon: Users,
    details: '10 种部门类型 + 12 维 KPI 权重，替代 OASIS 的平台化 Agent',
  },
  {
    key: 'CONFIG_GENERATION',
    title: '生成仿真配置',
    description: '组装部门、回合、市场环境、竞品、客户为仿真配置',
    icon: GitBranch,
    details: '基于经营模式（8 种）自动调整部门话语权、KPI 优先级',
  },
  {
    key: 'SIMULATION_RUNNING',
    title: '执行多 Agent 推演',
    description: '每回合：部门博弈 → 决议 → 行动 → 业务指标 → 涌现新议题',
    icon: Activity,
    details: '本地 BeliefEngine + PropagationLayer + InterDepartmentResolver',
  },
  {
    key: 'REPORT_GENERATING',
    title: '生成战略报告',
    description: '基于推演结果生成 8 章节战略推演报告（Markdown）',
    icon: Brain,
    details: '本地 LLM 驱动，支持高管/技术/叙述三种风格',
  },
]

interface Props {
  currentStage?: string
  progress?: number
  status?: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
}

export default function SimulationExplainer({ currentStage, progress, status }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>([])

  // 根据 currentStage 更新步骤状态
  useEffect(() => {
    const stageIndex = PIPELINE_STEPS.findIndex((s) => s.key === currentStage)
    const completedIndex = status === 'completed' ? PIPELINE_STEPS.length : stageIndex

    const newSteps: PipelineStep[] = PIPELINE_STEPS.map((s, i) => {
      let stepStatus: PipelineStep['status'] = 'pending'
      if (status === 'completed' || i < completedIndex) {
        stepStatus = 'completed'
      } else if (i === completedIndex && status === 'running') {
        stepStatus = 'running'
      } else if (i === completedIndex && status === 'failed') {
        stepStatus = 'failed'
      } else if (i > completedIndex) {
        stepStatus = 'pending'
      }
      return { ...s, status: stepStatus }
    })
    setSteps(newSteps)
  }, [currentStage, status])

  const currentStep = steps.find((s) => s.status === 'running')
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const totalSteps = steps.length
  const overallProgress = status === 'completed' ? 1 : (progress ?? 0)

  return (
    <div className="card overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-3 flex items-center justify-between
                   hover:bg-ink-50/60 dark:hover:bg-ink-900/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-bold">
              推演运行状态
            </div>
            <div className="text-sm font-semibold text-ink-900 dark:text-white">
              {currentStep
                ? `正在执行：${currentStep.title}`
                : status === 'completed'
                  ? '✅ 推演完成'
                  : status === 'failed'
                    ? '❌ 推演失败'
                    : status === 'paused'
                      ? '⏸ 推演已暂停'
                      : status === 'cancelled'
                        ? '⏹ 推演已取消'
                        : '⏳ 等待启动'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] text-ink-500">完成度</div>
            <div className="text-sm font-bold text-brand-600 dark:text-brand-300 tabular-nums">
              {Math.round(overallProgress * 100)}%
            </div>
          </div>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-ink-200/40 dark:border-ink-800/40 overflow-hidden"
          >
            {/* 整体进度条 */}
            <div className="px-4 pt-3 pb-2">
              <div className="h-1.5 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    status === 'failed' ? 'bg-rose-500' :
                    status === 'completed' ? 'bg-gradient-to-r from-emerald-500 to-teal-500' :
                    'bg-gradient-to-r from-brand-500 to-accent-500'
                  } progress-stripes`}
                  initial={{ width: 0 }}
                  animate={{ width: `${overallProgress * 100}%` }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-ink-500">
                <span>{completedCount}/{totalSteps} 步完成</span>
                {currentStep && (
                  <span className="text-brand-600 dark:text-brand-300 font-semibold animate-pulse-soft">
                    ▶ {currentStep.title}
                  </span>
                )}
              </div>
            </div>

            {/* 步骤列表 */}
            <div className="px-4 pb-4 space-y-2">
              {steps.map((step, i) => {
                const Icon = step.icon
                const isRunning = step.status === 'running'
                const isCompleted = step.status === 'completed'
                const isFailed = step.status === 'failed'
                return (
                  <div
                    key={step.key}
                    className={`p-2.5 rounded-lg border transition-all ${
                      isRunning
                        ? 'border-brand-300 dark:border-brand-700 bg-gradient-to-r from-brand-50 to-accent-50/30 dark:from-brand-950/30 dark:to-accent-950/20'
                        : isCompleted
                          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                          : isFailed
                            ? 'border-rose-300 dark:border-rose-700 bg-rose-50/50 dark:bg-rose-950/20'
                            : 'border-ink-200/40 dark:border-ink-800/40 bg-ink-50/30 dark:bg-ink-900/20 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${
                        isRunning
                          ? 'bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-glow animate-pulse-soft'
                          : isCompleted
                            ? 'bg-emerald-500 text-white'
                            : isFailed
                              ? 'bg-rose-500 text-white'
                              : 'bg-ink-200 dark:bg-ink-800 text-ink-500'
                      }`}>
                        {isRunning ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isCompleted ? (
                          <Check size={12} />
                        ) : (
                          <Icon size={12} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-ink-400 font-mono">步骤 {i + 1}</span>
                          {isRunning && (
                            <span className="text-[10px] text-brand-600 dark:text-brand-300 font-semibold animate-pulse-soft">
                              进行中
                            </span>
                          )}
                          {isCompleted && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-300 font-semibold">
                              ✓ 完成
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-ink-900 dark:text-white truncate">
                          {step.title}
                        </div>
                        <div className="text-[10px] text-ink-500 dark:text-ink-400 leading-snug mt-0.5">
                          {step.description}
                        </div>
                        {step.details && isRunning && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-1.5 p-1.5 rounded bg-white/60 dark:bg-ink-900/40
                                       text-[10px] text-ink-600 dark:text-ink-300 italic"
                          >
                            💡 {step.details}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 解释：本地替代了什么 */}
            <div className="px-4 pb-4">
              <div className="p-3 rounded-lg bg-gradient-to-br from-violet-50/60 to-pink-50/40 dark:from-violet-950/20 dark:to-pink-950/10 border border-violet-200/40 dark:border-violet-800/40">
                <div className="flex items-start gap-2">
                  <Cpu size={12} className="text-violet-600 mt-0.5 shrink-0" />
                  <div className="text-[11px] text-ink-700 dark:text-ink-200 leading-relaxed">
                    <div className="font-semibold text-violet-700 dark:text-violet-300 mb-1">
                      本地化模拟说明
                    </div>
                    <div className="text-[10px] text-ink-600 dark:text-ink-400 space-y-1">
                      <div>
                        <span className="font-semibold">替代 Zep Cloud</span>：
                        用 LocalKnowledgeStore（nano-graphRAG）+ LocalGraphStore 替代云端图谱记忆
                      </div>
                      <div>
                        <span className="font-semibold">替代 OASIS 平台</span>：
                        用 DepartmentAgent 集群替代 Twitter/Reddit 平台模拟
                      </div>
                      <div>
                        <span className="font-semibold">驱动机制</span>：
                        议题涌现（业务因果链）替代社交网络扩散
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
