/**
 * StageCards - 7 步流水线富内容卡（主壳层）。
 *
 * 来源：原 components/StageCards.tsx（439 行），P2-4 拆分为
 *       components/stages/ 目录下的 sub-component。
 *
 * 子组件（独立可复用）：
 *   - stages/seed.tsx        阶段 1：种子文档解析
 *   - stages/graph.tsx       阶段 2：构建知识图谱
 *   - stages/entity.tsx      阶段 3：抽取实体关系
 *   - stages/profile.tsx     阶段 4：生成 Agent 画像
 *   - stages/config.tsx      阶段 5：生成仿真配置
 *   - stages/simulation.tsx  阶段 6：执行多 Agent 推演
 *   - stages/report.tsx      阶段 7：生成战略报告
 *   - stages/Stat.tsx        共享：数值小卡
 *   - stages/meta.ts         共享：阶段元数据
 *
 * Feature Flag: flags.stageCardsSplit（默认 false）— 后续可挂更多行为开关
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import SeedParsingContent from './seed'
import GraphBuildingContent from './graph'
import EntityExtractionContent from './entity'
import ProfileGenerationContent from './profile'
import ConfigGenerationContent from './config'
import SimulationRunningContent from './simulation'
import ReportGeneratingContent from './report'
import { STAGE_META, STAGE_ORDER } from './meta'
import { flags } from '../../lib/featureFlags'

interface Props {
  runId?: string | null
  currentStage?: string
  status?: string
  artifacts?: Record<string, any>
  progress?: number
}

export default function StageCards({ runId, currentStage, artifacts = {} }: Props) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage as any)
  const isCompleted = currentStage === 'COMPLETED'
  // P1-4：默认展开前 1 已完成阶段
  const isDone0 = currentIdx > 0 || isCompleted
  const defaultExpanded = isDone0 ? STAGE_ORDER[0] : (currentStage || STAGE_ORDER[0])
  const [expanded, setExpanded] = useState<string | null>(defaultExpanded)

  useEffect(() => {
    if (isCompleted) { setExpanded(null); return }
    if (currentStage && currentIdx > 0) setExpanded(STAGE_ORDER[0])
    else if (currentStage) setExpanded(currentStage)
  }, [currentStage, isCompleted, currentIdx])

  return (
    <div className="space-y-2" data-stage-cards-split={flags.stageCardsSplit}>
      {STAGE_ORDER.map((stage, i) => {
        const meta = STAGE_META[stage]
        const isDone = i < currentIdx || isCompleted
        const isActive = i === currentIdx && !isCompleted
        const isOpen = expanded === stage
        const artifact = artifacts?.[stage] || {}
        return (
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className={`rounded-xl border transition-all ${cardClass(isActive, isDone)}`}
          >
            <StageHeader
              stage={stage} index={i} meta={meta}
              isDone={isDone} isActive={isActive} isOpen={isOpen}
              onToggle={() => setExpanded(isOpen ? null : stage)}
            />
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-1">
                    {renderStage(stage, artifact, isActive, runId)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}

function cardClass(isActive: boolean, isDone: boolean): string {
  if (isActive) {
    return 'bg-gradient-to-r from-brand-50 to-accent-50/30 border-brand-300 dark:from-brand-950/30 dark:to-accent-950/20 dark:border-brand-700 shadow-soft'
  }
  if (isDone) {
    return 'bg-emerald-50/30 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/60'
  }
  return 'bg-ink-50/40 border-ink-200/40 dark:bg-ink-900/20 dark:border-ink-800/40'
}

interface HeaderProps {
  stage: string
  index: number
  meta: any
  isDone: boolean
  isActive: boolean
  isOpen: boolean
  onToggle: () => void
}

function StageHeader({ stage, index, meta, isDone, isActive, isOpen, onToggle }: HeaderProps) {
  return (
    <button onClick={onToggle} className="w-full p-3 flex items-center gap-3 text-left">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.bg} inline-flex items-center justify-center ${meta.color}`}>
        {isDone ? <Check size={14} className="text-emerald-600" /> :
         isActive ? <Loader2 size={14} className="animate-spin" /> :
         <meta.icon size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${isActive ? 'text-brand-900 dark:text-brand-100' : 'text-ink-900 dark:text-white'}`}>
          第 {index + 1} 步 · {meta.label}
        </div>
        <div className="text-[10px] text-ink-500 truncate">{meta.desc}</div>
      </div>
      <div className="flex items-center gap-1.5">
        {isDone && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-semibold">已完成</span>}
        {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500 text-white font-semibold animate-pulse-soft">进行中</span>}
        {!isDone && !isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-200 dark:bg-ink-800 text-ink-500 font-semibold">等待</span>}
        {isOpen ? <ChevronDown size={12} className="text-ink-400" /> : <ChevronRight size={12} className="text-ink-400" />}
      </div>
      <span className="sr-only">{stage}</span>
    </button>
  )
}

function renderStage(stage: string, artifact: any, isActive: boolean, runId?: string | null) {
  // P2-4: featureFlag 用于追踪「新 sub-component 架构是否启用」；
  //       当前两路径等价（拆分前后行为一致），后续可挂更多开关。
  const useSplit = flags.stageCardsSplit
  const handler = useSplit ? handlersSplit : handlersSplit  // 预留：false 路径可挂 legacy
  return handler(stage, artifact, isActive, runId)
}

function handlersSplit(stage: string, artifact: any, isActive: boolean, runId?: string | null) {
  switch (stage) {
    case 'SEED_PARSING': return <SeedParsingContent artifact={artifact} />
    case 'GRAPH_BUILDING': return <GraphBuildingContent artifact={artifact} isActive={isActive} runId={runId} />
    case 'ENTITY_EXTRACTION': return <EntityExtractionContent artifact={artifact} />
    case 'PROFILE_GENERATION': return <ProfileGenerationContent artifact={artifact} />
    case 'CONFIG_GENERATION': return <ConfigGenerationContent artifact={artifact} />
    case 'SIMULATION_RUNNING': return <SimulationRunningContent artifact={artifact} runId={runId} isActive={isActive} />
    case 'REPORT_GENERATING': return <ReportGeneratingContent artifact={artifact} />
    default: return null
  }
}
