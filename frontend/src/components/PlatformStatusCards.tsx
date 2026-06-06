/**
 * PlatformStatusCards - 推演阶段顶部双列平台卡（MiroFish 风格）。
 *
 * 仿照 MiroFish Step3Simulation.vue 第 6-90 行：
 *   - 顶部并排两列：外部推演（Plaza/广场）+ 内部推演（Community/社群）
 *   - 每列三态：pending / active / completed
 *   - 显示 ROUND / TIME / ACTS
 *   - hover 显示该平台可用动作 tooltip
 *
 * 我们项目里把 "Twitter/Reddit" 替换为战略推演场景：
 *   - 战略决策（外部博弈 / 对手/市场/监管）
 *   - 组织协同（内部博弈 / 部门/资源/共识）
 */
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Building2, Network, Check, Loader2, Clock } from 'lucide-react'

interface PlatformStats {
  round: number
  totalRounds: number
  time: string
  actions: number
  isActive: boolean
  isCompleted: boolean
  /** P1-11：预计还需时长（人类可读） */
  etaText?: string
}

interface Props {
  /** 当前推演状态 */
  status?: string
  currentStage?: string
  currentRound?: number
  totalRounds?: number
  activeAgents?: number
  /** 开始时间戳（用于计算 elapsed） */
  startedAt?: number
  /** 行动数（外/内） */
  externalActions?: number
  internalActions?: number
}

// 两平台可用动作（hover tooltip）
const EXTERNAL_ACTIONS = [
  '公开声明', '路演沟通', '监管申报', '媒体公告', '行业发声', '竞争动作', '联盟接触', '市场布局',
]
const INTERNAL_ACTIONS = [
  '部门协同', '私下会商', '资源调配', '议题共识', '决策投票', '风险评估', '应急响应', '跨部门会签',
]

export default function PlatformStatusCards({
  status, currentStage, currentRound = 0, totalRounds = 0,
  startedAt, externalActions = 0, internalActions = 0,
}: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const elapsedMs = startedAt ? Math.max(0, now - startedAt * 1000) : 0
  const elapsedH = Math.floor(elapsedMs / 3600000)
  const elapsedM = Math.floor((elapsedMs % 3600000) / 60000)
  const elapsed = elapsedMs > 0 ? `${elapsedH}h ${elapsedM}m` : '0h 0m'

  // P1-11: 预计还需时长 = (totalRounds - currentRound) * (elapsed / max(currentRound, 1))
  // 防御 currentRound=0 情况（推演刚启动无分母），此时 ETA 显示为"计算中…"
  const remainingRounds = Math.max(0, totalRounds - currentRound)
  let etaText: string | undefined
  if (remainingRounds === 0) {
    etaText = undefined  // 已完成
  } else if (currentRound <= 0 || elapsedMs <= 0) {
    etaText = '计算中…'  // 推演刚启动，无足够样本
  } else {
    const etaMs = (elapsedMs / currentRound) * remainingRounds
    if (etaMs < 60_000) {
      etaText = '预计还需 < 1 分钟'
    } else if (etaMs < 3_600_000) {
      etaText = `预计还需 ~${Math.max(1, Math.round(etaMs / 60_000))} 分钟`
    } else {
      const eh = Math.floor(etaMs / 3_600_000)
      const em = Math.max(1, Math.round((etaMs % 3_600_000) / 60_000))
      etaText = `预计还需 ~${eh}h ${em}m`
    }
  }

  const isRunning = status === 'running'
  const isCompleted = status === 'completed' || status === 'failed' || status === 'cancelled'
  const isSimulating = currentStage === 'SIMULATION_RUNNING'

  // 外部推演：仅在 SIMULATION 阶段才进入"active"
  const extActive = isSimulating && currentRound > 0
  const extCompleted = currentStage === 'REPORT_GENERATING' || (isCompleted && currentStage !== 'SIMULATION_RUNNING')

  // 内部推演：略晚于外部（实际业务里"先看市场，再做内部决策"）
  const intActive = isSimulating && currentRound > 0 && externalActions > 0
  const intCompleted = isCompleted && currentStage !== 'SIMULATION_RUNNING'

  const external: PlatformStats = {
    round: currentRound,
    totalRounds,
    time: elapsed,
    actions: externalActions,
    isActive: extActive,
    isCompleted: extCompleted,
    etaText,
  }
  const internal: PlatformStats = {
    round: currentRound,
    totalRounds,
    time: elapsed,
    actions: internalActions,
    isActive: intActive,
    isCompleted: intCompleted,
    etaText,
  }

  if (!isRunning && !isCompleted) {
    return null  // 推演未启动就不显示
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PlatformCard
          platform="external"
          icon={Network}
          name="战略博弈"
          subName="EXTERNAL"
          accentColor="#004E89"
          stats={external}
          actions={EXTERNAL_ACTIONS}
        />
        <PlatformCard
          platform="internal"
          icon={Building2}
          name="组织协同"
          subName="INTERNAL"
          accentColor="#FF6B35"
          stats={internal}
          actions={INTERNAL_ACTIONS}
        />
      </div>
      {/* P1-11: 跨双卡 ETA 横条（仅 active 期间显示） */}
      {etaText && (extActive || intActive) && (
        <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-ink-500 dark:text-ink-400">
          <Clock size={10} className="text-brand-500" />
          <span className="font-mono tabular-nums">{etaText}</span>
        </div>
      )}
    </div>
  )
}

function PlatformCard({ platform, icon: Icon, name, subName, accentColor, stats, actions }: {
  platform: string; icon: any; name: string; subName: string; accentColor: string;
  stats: PlatformStats; actions: string[];
}) {
  return (
    <div
      className={`relative rounded-xl border transition-all duration-300 overflow-hidden
        ${stats.isActive
          ? 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-700 shadow-soft'
          : stats.isCompleted
            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
            : 'bg-ink-50/50 dark:bg-ink-900/40 border-ink-200/60 dark:border-ink-800 opacity-60'
        }`}
    >
      {/* Accent left border */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: stats.isCompleted ? '#1A936F' : accentColor }}
      />

      <div className="pl-4 pr-3 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-7 h-7 rounded-md inline-flex items-center justify-center"
            style={{ background: `${accentColor}20`, color: accentColor }}
          >
            <Icon size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-ink-900 dark:text-white truncate">
              {name}
            </div>
            <div className="text-[9px] text-ink-500 uppercase tracking-widest font-mono">
              {subName}
            </div>
          </div>
          {stats.isCompleted && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-emerald-500"
            >
              <Check size={16} strokeWidth={3} />
            </motion.span>
          )}
          {stats.isActive && (
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="text-ink-700 dark:text-ink-200"
            >
              <Loader2 size={14} />
            </motion.span>
          )}
        </div>

        {/* 统计三件套 */}
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="ROUND" value={stats.round} total={stats.totalRounds} />
          <Stat label="TIME" value={stats.time} mono />
          <Stat label="ACTS" value={stats.actions} mono />
        </div>
      </div>

      {/* 底部进度条（仅 active 状态） */}
      {stats.isActive && stats.totalRounds > 0 && (
        <div className="h-0.5 bg-ink-200 dark:bg-ink-800">
          <motion.div
            className="h-full"
            style={{ background: accentColor }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, (stats.round / Math.max(1, stats.totalRounds)) * 100)}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}

      {/* Hover tooltip：可用动作（MiroFish 标志性） */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-ink-950 text-white rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-20 min-w-[200px] pointer-events-none">
        <div className="text-[10px] font-bold text-ink-400 uppercase tracking-widest mb-1.5">可用动作</div>
        <div className="flex flex-wrap gap-1">
          {actions.map((a) => (
            <span key={a} className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white font-medium">
              {a}
            </span>
          ))}
        </div>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-ink-950 rotate-45" />
      </div>

      {/* Group hover trigger (CSS-only) */}
      <style>{`
        [data-platform-card="${platform}"] { position: relative; }
      `}</style>
    </div>
  )
}

function Stat({ label, value, total, mono }: { label: string; value: any; total?: number; mono?: boolean }) {
  return (
    <div className="px-1.5 py-1 rounded bg-ink-50/60 dark:bg-ink-900/60">
      <div className="text-[8px] text-ink-500 font-bold uppercase tracking-widest">{label}</div>
      <div className={`text-[12px] font-bold text-ink-900 dark:text-white ${mono ? 'font-mono' : ''} tabular-nums`}>
        {value}
        {total != null && total > 0 && (
          <span className="text-[10px] text-ink-400 font-normal">/{total}</span>
        )}
      </div>
    </div>
  )
}
