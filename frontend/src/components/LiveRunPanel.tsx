/**
 * LiveRunPanel - 实时推演可视化面板（Dashboard 与 Workbench 共享）。
 *
 * 用途：
 *   - Dashboard 在 run 启动后内嵌显示（紧凑模式）
 *   - Workbench 主视图（完整模式）
 *
 * 设计：
 *   - 全部状态来自 usePipelineStore（唯一 source of truth）
 *   - 通过 prop `compact` 切换布局密度
 *   - 通过 prop `runId` 显式指定（也支持从 store 读）
 *   - 通过 prop `title` 自定义标题
 *
 * 包含的可视化：
 *   1. RealtimeKnowledgeGraph - 实时增长图谱
 *   2. SimulationNetworkGraph - 迭代关系网（核心特性）
 *   3. RoundTimeline - 行动事件流
 *   4. StageCards - 7 步富内容
 *   5. SystemLogs - 终端风格日志
 *
 * 注意（P1-9）：PlatformStatusCards 已上提到 Workbench 顶部，避免重复渲染。
 */
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronRight, Maximize2, Network, Radio, Activity, Terminal, GitBranch,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePipelineStore } from '../store/pipeline'
import RealtimeKnowledgeGraph from './RealtimeKnowledgeGraph'
import SimulationNetworkGraph from './SimulationNetworkGraph'
import RoundTimeline from './RoundTimeline'
import StageCards from './StageCards'
import SystemLogs from './SystemLogs'
import { APP_ROUTES } from '../i18n/zh'

interface Props {
  /** 显式指定 runId；不传则用 store 当前 run */
  runId?: string | null
  /** 紧凑模式（Dashboard 嵌入）vs 完整模式（Workbench 主视图） */
  compact?: boolean
  /** 标题 */
  title?: string
  /** 子标题 */
  subtitle?: string
  /** 显示哪些块（默认全显示） */
  show?: Array<'graph' | 'network' | 'platforms' | 'stages' | 'timeline' | 'logs'>
}

const DEFAULT_SHOW: NonNullable<Props['show']> = [
  'graph', 'network', 'platforms', 'stages', 'timeline', 'logs',
]

export default function LiveRunPanel({
  runId: runIdProp,
  compact = false,
  title = '实时推演面板',
  subtitle,
  show = DEFAULT_SHOW,
}: Props) {
  const store = usePipelineStore()
  const runId = runIdProp || store.runId
  const status = store.status
  const stage = store.currentStage
  const progress = store.progress
  const snapshot = store.snapshot
  const artifacts = snapshot?.artifacts || {}

  // 局部 UI 状态
  // (暂无折叠需求，组件外层用 show prop 控制)

  // 兜底拉快照（仅在 store 没有时）
  useEffect(() => {
    if (runId && (!snapshot || snapshot.run_id !== runId)) {
      store.hydrateFromRunId(runId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  if (!runId) {
    return (
      <div className="card p-8 text-center bg-gradient-to-br from-brand-50/40 to-accent-50/20
                      dark:from-brand-950/20 dark:to-accent-950/10
                      border-2 border-dashed border-brand-200/60 dark:border-brand-800/40">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500/20 to-accent-500/20
                        inline-flex items-center justify-center text-brand-500 mb-3">
          <Network size={22} />
        </div>
        <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
          {title}
        </div>
        <div className="text-xs text-ink-500 dark:text-ink-400">
          {subtitle || '尚未启动推演。配置好参数并点击"启动推演"后，可视化将在这里出现。'}
        </div>
      </div>
    )
  }

  // 紧凑模式：只显示图谱 + 关系网，其余折叠（平台卡已上提到 Workbench 顶部）
  const visibleShow = compact
    ? (show.filter((s) => ['graph', 'network'].includes(s)))
    : show

  return (
    <div className="space-y-3">
      {/* 头部（紧凑模式才显示） */}
      {compact && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
              <Radio size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {title}
              </div>
              <div className="text-xs text-ink-700 dark:text-ink-300 truncate">
                {subtitle || `${status === 'running' ? '推演运行中' : status === 'completed' ? '推演完成' : '推演已停止'} · run ${runId.slice(0, 12)}`}
              </div>
            </div>
          </div>
          <Link
            to={APP_ROUTES.workbenchWithRun(runId)}
            className="btn-ghost h-8 text-[11px] flex items-center gap-1 flex-shrink-0"
          >
            <Maximize2 size={11} /> 完整工作台
            <ChevronRight size={11} />
          </Link>
        </div>
      )}

      {/* 实时图谱（紧凑模式用更小的高度） */}
      {visibleShow.includes('graph') && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 }}
        >
          <RealtimeKnowledgeGraph
            runId={runId}
            live={status === 'running' || status === 'paused'}
            height={compact ? 320 : 440}
            title="实时知识图谱"
          />
        </motion.div>
      )}

      {/* 迭代关系网 */}
      {visibleShow.includes('network') && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
        >
          <SimulationNetworkGraph
            runId={runId}
            height={compact ? 320 : 400}
            title="迭代关系网"
          />
        </motion.div>
      )}

      {/* 7 步富内容（完整模式才显示） */}
      {visibleShow.includes('stages') && !compact && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="card p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
              <GitBranch size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                7 步推演流水线详情
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                实时富内容阶段卡
              </div>
            </div>
          </div>
          <StageCards
            runId={runId}
            currentStage={stage}
            status={status}
            artifacts={artifacts}
            progress={progress}
          />
        </motion.div>
      )}

      {/* 实时事件流（完整模式） */}
      {visibleShow.includes('timeline') && !compact && status === 'running' && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-brand-500/20 inline-flex items-center justify-center text-emerald-600">
                <Activity size={16} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                  实时博弈事件流
                </div>
                <div className="text-sm font-semibold text-ink-900 dark:text-white">
                  18 种动作类型 · 增量去重
                </div>
              </div>
            </div>
            <RoundTimeline simulationId={runId} />
          </div>
        </motion.div>
      )}

      {/* 系统日志（完整模式） */}
      {visibleShow.includes('logs') && !compact && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-md bg-ink-900 inline-flex items-center justify-center text-emerald-400">
              <Terminal size={13} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              系统日志
            </div>
          </div>
          <SystemLogs runId={runId} height={220} />
        </motion.div>
      )}
    </div>
  )
}
