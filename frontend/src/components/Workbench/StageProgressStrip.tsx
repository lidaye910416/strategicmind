/**
 * StageProgressStrip — Workbench 7 步流水线状态条 (P5 增强)
 *
 * 位于 WorkbenchLayout 的 StateHero 下方。
 * 基础高度 ≥80px, 展开 SIMULATION_RUNNING 子进度或回环提示时扩展到 ~120px。
 * 7 段水平排列, 每段含: 序号 / 图标 / 短名 / 状态色。
 * SIMULATION_RUNNING 是当前阶段时, 下方显示子进度 (round N/M · 部门数)。
 * 跨年回环时显示 "↻ 循环第 N 年" badge。
 *
 * 数据源: useStageProgress() (store/pipeline.ts)
 */
import { memo } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, Network, Tags, Users, Sliders, Play, FileBarChart,
  Check, Loader2, RotateCcw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { WORKBENCH, STAGE_LABELS } from '../../i18n/zh'
import type { StageInfo, SimulationSub } from './stageProgress'

export interface StageProgressStripProps {
  stages: StageInfo[]
  /** 第 6 步子进度 (其它阶段为 null) */
  sub?: SimulationSub | null
  currentStage?: string
  isLooping?: boolean
  yearOffset?: number
  dataTestId?: string
}

const STAGE_ICONS: Record<string, LucideIcon> = {
  SEED_PARSING: FileText,
  GRAPH_BUILDING: Network,
  ENTITY_EXTRACTION: Tags,
  PROFILE_GENERATION: Users,
  CONFIG_GENERATION: Sliders,
  SIMULATION_RUNNING: Play,
  REPORT_GENERATING: FileBarChart,
}

const STATUS_CLS: Record<StageInfo['status'], string> = {
  'done': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300/60',
  'active': 'bg-gradient-to-br from-brand-500 to-accent-500 text-white border-transparent shadow-soft animate-pulse-soft',
  'pending': 'bg-ink-50/70 dark:bg-ink-900/50 text-ink-400 dark:text-ink-500 border-ink-200/60 dark:border-ink-800/60',
  'looping-active': 'bg-gradient-to-br from-amber-500 to-orange-500 text-white border-transparent shadow-soft animate-pulse-soft',
  'failed': 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300/60',
  'cancelled': 'bg-ink-300/40 text-ink-500 dark:text-ink-500 border-ink-400/40',
}

function StageProgressStripImpl({
  stages,
  sub,
  currentStage,
  isLooping = false,
  yearOffset = 0,
  dataTestId = 'wb-stage-progress',
}: StageProgressStripProps) {
  const showSub = currentStage === 'SIMULATION_RUNNING' && sub
  return (
    <div
      data-testid={dataTestId}
      data-current-stage={currentStage ?? stages.find((s) => s.status === 'active')?.id ?? 'IDLE'}
      className="w-full card p-3 min-h-[80px] flex flex-col gap-2"
      aria-label={WORKBENCH.stageProgressTitle}
    >
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
          {WORKBENCH.stageProgressTitle}
        </div>
        {isLooping && yearOffset >= 2 && (
          <div
            data-testid="wb-stage-loop-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/60"
          >
            <RotateCcw size={10} />
            {WORKBENCH.stageProgressLoopBadge(yearOffset)}
          </div>
        )}
      </div>

      {/* 7 segments row */}
      <div role="list" className="flex items-stretch gap-1.5">
        {stages.map((s) => {
          const Icon = STAGE_ICONS[s.id] ?? FileText
          const cls = STATUS_CLS[s.status]
          const isCurrent = s.status === 'active' || s.status === 'looping-active' || s.status === 'failed' || s.status === 'cancelled'
          const showSpinner = isCurrent
          return (
            <motion.div
              key={s.id}
              role="listitem"
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={STAGE_LABELS[s.id] ?? s.id}
              data-testid={`wb-stage-${s.id}`}
              data-status={s.status}
              data-current={isCurrent ? 'true' : 'false'}
              whileHover={{ scale: 1.02 }}
              className={[
                'flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-md border',
                'text-[10px] font-mono',
                cls,
              ].join(' ')}
              title={STAGE_LABELS[s.id] ?? s.id}
            >
              <div className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold">
                {s.status === 'done' ? <Check size={11} /> :
                 showSpinner ? <Loader2 size={11} className="animate-spin" /> :
                 s.index + 1}
              </div>
              <Icon size={11} className="flex-shrink-0" />
              <span className="truncate text-[10px]">{STAGE_LABELS[s.id] ?? s.id}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Sub-progress row (only when SIMULATION_RUNNING active) */}
      {showSub && sub && (
        <div
          data-testid="wb-stage-sub"
          className="flex items-center gap-2 text-[11px] font-mono text-ink-700 dark:text-ink-200"
        >
          <Play size={10} className="text-brand-500 flex-shrink-0" />
          <span>{WORKBENCH.stageProgressSubSimulation(sub.round, sub.totalRounds, sub.activeAgents)}</span>
          {/* Inline progress bar */}
          <div className="flex-1 h-1.5 rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-accent-500"
              style={{ width: `${Math.max(0, Math.min(100, (sub.round / Math.max(1, sub.totalRounds)) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Loop sub-line */}
      {isLooping && currentStage && currentStage !== 'SIMULATION_RUNNING' && (
        <div
          data-testid="wb-stage-loop-sub"
          className="text-[10px] font-mono text-amber-700 dark:text-amber-300"
        >
          {WORKBENCH.stageProgressSubLoop(yearOffset)}
        </div>
      )}
    </div>
  )
}

const StageProgressStrip = memo(StageProgressStripImpl)
export default StageProgressStrip
