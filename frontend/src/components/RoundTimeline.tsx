/**
 * RoundTimeline - 每回合博弈事件流（工作台风格 v2）
 *
 * 升级：
 *   1. 数据源改为 useSimRounds() 派生（与全局 SSE 同步），不再走自有 simulationId 轮询
 *   2. 顶部挂 RoundTimelineChart 双线趋势（行动数 vs 信念更新数）
 *   3. 18 种动作类型专属卡片（覆盖 StrategicAction 全量）
 *   4. 平台分解头：外部博弈（executor/external）/ 内部协同（department/internal）
 *   5. 实时事件横幅：本回合新增 N 条（从 simRounds 增量推算）
 *   6. 5 种卡片视觉变体：纯文本/引用块/转发/数字/二元表态
 *
 * PR-3 P2 增强：
 *   - P2-2 顶部趋势线 LineChart（recharts，flags.timelineTrendline 默认开）
 *   - P2-3 底部 scrubber 重放控件（flags.timelineScrubber 默认关）
 *     拖到 R3 即显示 R1-R3 累计事件；拖动时禁用 SSE/轮询更新（避免抖动）
 */
import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, ChevronRight, Clock, Zap, Loader2, Activity,
  Globe, Building2, Sparkles,
  Play, Pause, RotateCcw, History,
} from 'lucide-react'
import { flags } from '../lib/featureFlags'
import { actionMeta, classifyPlatform } from './roundTimelineMeta'
import ActionCard, { type Action } from './ActionCard'
import RoundTimelineChart, { buildRoundTimelineChartData } from './RoundTimelineChart'
import { useSimRounds, useRunId } from '../store/pipeline'

interface RoundData {
  round_num: number
  simulated_hour: number
  active_agents: string[]
  actions: Action[]
  belief_updates: any[]
  propagation_events: any[]
  start_time?: string
  end_time?: string
  ts?: number
}

interface Props { simulationId?: string }

export default function RoundTimeline({ simulationId: _simulationId }: Props = {}) {
  // data source: useSimRounds() 派生 — 与全局 SSE / Dashboard / Workbench 同步
  const simRoundsRaw = useSimRounds()
  const runId = useRunId()
  const [selectedRound, setSelectedRound] = useState<number>(1)
  const [newCount, setNewCount] = useState(0)
  const [paused, setPaused] = useState(false)

  // P2-3 scrubber 状态：
  //   scrubTo  = 0 表示"无重放，显示全部"（默认）
  //   scrubTo  > 0 表示"重放到 R{scrubTo}，只显示 0..scrubTo 累计事件"
  //   用户拖动 slider 时把 paused 设为 true（防 SSE 抖动）；松手后维持 paused 由用户决定
  const [scrubTo, setScrubTo] = useState<number>(0)
  const [scrubbing, setScrubbing] = useState(false)

  // 把 SimRound 转换为本地 RoundData 形状（含 simulated_hour / 兼容旧 action 渲染）
  const data = useMemo(() => {
    if (!simRoundsRaw || simRoundsRaw.length === 0) return null
    const rounds: RoundData[] = simRoundsRaw.map((r) => ({
      round_num: r.round,
      simulated_hour: r.round * 6,  // 默认 6h/round（与 SimulationLoop 一致）
      active_agents: Array.isArray(r.active_agents) ? (r.active_agents as string[]) : [],
      actions: (r.actions as Action[]) ?? [],
      belief_updates: r.belief_updates ?? [],
      propagation_events: r.propagation_events ?? [],
      ts: r.ts,
    }))
    const total_rounds = rounds.length
    return {
      run_id: runId ?? 'preview',
      total_rounds,
      current_round: total_rounds,
      rounds,
      actor_names: {},
    }
  }, [simRoundsRaw, runId])

  // 推算"新增 N 条" banner：simRounds 数量变化即触发 +N
  useEffect(() => {
    if (!data) return
    if (paused || scrubbing) return
    const newActionsCount = data.rounds[data.rounds.length - 1]?.actions.length ?? 0
    if (newActionsCount > 0) {
      setNewCount((c) => c + 1)
      const t = setTimeout(() => setNewCount(0), 3000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [simRoundsRaw?.length, data, paused, scrubbing])

  if (!data) {
    return (
      <div className="card p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-ink-100 dark:bg-ink-800
                        inline-flex items-center justify-center text-ink-400 mb-2">
          <Activity size={20} />
        </div>
        <div className="text-sm text-ink-500 dark:text-ink-400">
          推演尚未开始或无回合数据
        </div>
      </div>
    )
  }

  // P2-3 重放过滤：scrubTo > 0 时，只取 0..scrubTo 区间的回合
  const visibleRounds = useMemo(() => {
    if (!flags.timelineScrubber || scrubTo <= 0) return data.rounds
    return data.rounds.filter((r) => r.round_num <= scrubTo)
  }, [data.rounds, scrubTo])

  // 当前回合：scrubbing 时跟随 scrubTo；否则按 selectedRound
  const currentRound = useMemo(() => {
    if (flags.timelineScrubber && scrubbing && scrubTo > 0) {
      return visibleRounds[visibleRounds.length - 1] || data.rounds[0]
    }
    return data.rounds.find((r) => r.round_num === selectedRound) || data.rounds[0]
  }, [data.rounds, visibleRounds, selectedRound, scrubTo, scrubbing])

  const totalActions = data.rounds.reduce((acc, r) => acc + r.actions.length, 0)
  const allActorIds = new Set<string>()
  data.rounds.forEach((r) => r.actions.forEach((a) => allActorIds.add(a.actor_id)))

  // 平台分解统计
  const extCount = data.rounds.flatMap((r) => r.actions).filter((a) => classifyPlatform(a) === 'external').length
  const intCount = data.rounds.flatMap((r) => r.actions).filter((a) => classifyPlatform(a) === 'internal').length

  // 动作类型分布
  const typeDist = useMemo(() => {
    const m: Record<string, number> = {}
    data.rounds.forEach((r) => r.actions.forEach((a) => {
      m[a.action_type] = (m[a.action_type] || 0) + 1
    }))
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [data])

  // P2-2 趋势线数据 (从 useSimRounds 派生)
  const trendData = useMemo(() => buildRoundTimelineChartData(data.rounds), [data.rounds])

  const maxScrubRound = data.rounds.length
  const isScrubbingActive = flags.timelineScrubber && scrubTo > 0

  return (
    <div className="card p-5">
      {/* 顶部状态栏（工作台风格 + 平台分解） */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-bold">
              博弈时间线
            </div>
            <div className="text-2xl font-bold text-ink-900 dark:text-white mt-0.5 tabular-nums">
              R{currentRound.round_num}
              <span className="text-base text-ink-400 dark:text-ink-500 font-normal"> / {data.total_rounds}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-ink-50 dark:bg-ink-900/60 border border-ink-200/50">
            <span className="text-[10px] font-semibold text-ink-500">TOTAL EVENTS</span>
            <span className="text-sm font-bold font-mono text-ink-900 dark:text-white tabular-nums">{totalActions}</span>
            <span className="text-ink-300">/</span>
            <span className="inline-flex items-center gap-0.5 text-[11px] font-mono">
              <Globe size={9} className="text-blue-500" />{extCount}
            </span>
            <span className="text-ink-300">/</span>
            <span className="inline-flex items-center gap-0.5 text-[11px] font-mono">
              <Building2 size={9} className="text-orange-500" />{intCount}
            </span>
          </div>
          <Stat label="行动总数" value={totalActions} icon={Zap} />
          <Stat label="活跃主体" value={allActorIds.size} icon={Users} />
          <Stat label="模拟时长" value={`${currentRound.simulated_hour}h`} icon={Clock} />
        </div>
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {newCount > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="px-2 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-soft"
              >
                <Sparkles size={9} /> +{newCount} 新增
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`btn-ghost h-7 px-2 text-[10px] ${paused ? 'text-amber-600' : ''}`}
            title={paused ? '继续轮询' : '暂停轮询'}
          >
            {paused ? '已暂停' : '轮询中'}
          </button>
        </div>
      </div>

      {/* P2-2 趋势线 LineChart（默认关闭） */}
      {flags.timelineTrendline && (
        <RoundTimelineChart
          data={trendData}
          highlightToRound={isScrubbingActive ? scrubTo : undefined}
        />
      )}

      {/* 动作类型分布条 */}
      {typeDist.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {typeDist.map(([type, count]) => {
            const m = actionMeta(type)
            return (
              <span
                key={type}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${m.bg} ${m.color} ${m.border} border`}
              >
                {m.label}
                <span className="font-mono opacity-70">{count}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* 回合选择 chips */}
      <div className="flex items-center gap-1.5 mb-5 overflow-x-auto nice-scroll pb-1">
        {data.rounds.map((r) => {
          const isSel = r.round_num === selectedRound
          // P2-3 scrubber 激活时，把 R > scrubTo 的回合标灰（暗示"超出回放范围"）
          const isBeyondScrub = isScrubbingActive && r.round_num > scrubTo
          return (
            <motion.button
              key={r.round_num}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                if (isBeyondScrub) return
                setSelectedRound(r.round_num)
              }}
              disabled={isBeyondScrub}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold
                          border transition-colors duration-150
                          ${isSel
                            ? 'bg-gradient-to-r from-brand-500 to-accent-500 text-white border-transparent shadow-soft'
                            : isBeyondScrub
                              ? 'bg-ink-100/50 dark:bg-ink-900/30 text-ink-300 dark:text-ink-600 border-ink-200/40 dark:border-ink-800/40 cursor-not-allowed'
                              : 'bg-white dark:bg-ink-900/40 text-ink-700 dark:text-ink-200 border-ink-200/60 dark:border-ink-800/60 hover:border-brand-400'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                isSel ? 'bg-white' : isBeyondScrub ? 'bg-ink-300' : 'bg-emerald-500'
              }`} />
              R{r.round_num}
              <span className={`px-1.5 rounded text-[10px] ${
                isSel ? 'bg-white/20' : 'bg-ink-100 dark:bg-ink-800'
              }`}>
                {r.actions.length}
              </span>
            </motion.button>
          )
        })}
      </div>

      {/* 当前回合时间线 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentRound.round_num}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
        >
          {currentRound.actions.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-400 dark:text-ink-500">
              本回合无行动
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-2.5 top-0 bottom-0 w-px bg-gradient-to-b from-brand-300 via-accent-300 to-transparent dark:from-brand-700 dark:via-accent-700" />
              <div className="space-y-2.5">
                {currentRound.actions.map((a, i) => (
                  <ActionCard key={a.metadata?.id || `${a.actor_id}-${a.action_type}-${a.timestamp}-${i}`} action={a} idx={i} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-ink-200/60 dark:border-ink-800/60
                          flex items-center gap-3 flex-wrap text-[11px] text-ink-500 dark:text-ink-400">
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> 第 {currentRound.round_num} 回合 · 模拟第 {currentRound.simulated_hour} 小时
            </span>
            {currentRound.belief_updates.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Activity size={11} /> {currentRound.belief_updates.length} 条信念更新
              </span>
            )}
            {currentRound.propagation_events.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <ChevronRight size={11} /> {currentRound.propagation_events.length} 条传播事件
              </span>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* P2-3 scrubber 重放控件（默认关闭） */}
      {flags.timelineScrubber && (
        <div className="mt-4 pt-4 border-t border-ink-200/60 dark:border-ink-800/60
                        bg-ink-50/40 dark:bg-ink-900/30 -mx-5 -mb-5 px-5 py-3 rounded-b-xl">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold
                            text-ink-500 dark:text-ink-400">
              <History size={11} /> 重放控制
            </div>
            <div className="flex-1 min-w-[200px] flex items-center gap-2">
              <span className="text-[10px] font-mono text-ink-500 dark:text-ink-400 tabular-nums w-10">
                R0
              </span>
              <input
                type="range"
                min={0}
                max={maxScrubRound}
                step={1}
                value={scrubTo}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setScrubTo(v)
                  setScrubbing(true)
                  // 拖动期间禁用 SSE/轮询（避免抖动）
                  if (!paused) setPaused(true)
                }}
                onMouseUp={() => setScrubbing(false)}
                onTouchEnd={() => setScrubbing(false)}
                onKeyUp={() => setScrubbing(false)}
                className="flex-1 h-1.5 accent-brand-500 cursor-pointer"
                aria-label="重放滑块：从 R0 拖到当前回合"
              />
              <span className="text-[10px] font-mono text-ink-700 dark:text-ink-200 tabular-nums w-12 text-right font-bold">
                {scrubTo === 0 ? '全部' : `R${scrubTo}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setScrubTo(0)
                  setScrubbing(false)
                  setPaused(false)
                }}
                className="btn-ghost h-7 px-2 text-[10px] inline-flex items-center gap-1"
                title="重置：取消重放，恢复轮询"
              >
                <RotateCcw size={10} /> 重置
              </button>
              <button
                onClick={() => setPaused((p) => !p)}
                className={`btn-ghost h-7 px-2 text-[10px] inline-flex items-center gap-1 ${paused ? 'text-amber-600' : ''}`}
                title={paused ? '继续轮询' : '暂停轮询（重放期间自动暂停）'}
              >
                {paused ? <Play size={10} /> : <Pause size={10} />}
                {paused ? '继续' : '暂停'}
              </button>
            </div>
          </div>
          {scrubTo > 0 && (
            <div className="mt-2 text-[10px] text-ink-500 dark:text-ink-400 flex items-center gap-1.5">
              <Activity size={10} />
              已重放到 R{scrubTo}（仅显示 R1 – R{scrubTo} 累计 {visibleRounds.reduce((acc, r) => acc + r.actions.length, 0)} 个行动）
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, icon: Icon }: { label: string; value: any; icon: any }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-ink-100 dark:bg-ink-800/60
                      inline-flex items-center justify-center text-ink-500 dark:text-ink-400">
        <Icon size={14} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-medium">
          {label}
        </div>
        <div className="text-base font-bold text-ink-900 dark:text-white tabular-nums leading-tight">
          {value}
        </div>
      </div>
    </div>
  )
}
