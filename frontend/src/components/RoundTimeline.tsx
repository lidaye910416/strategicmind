/**
 * RoundTimeline - 每回合博弈事件流（MiroFish 风格）。
 *
 * 顶部状态栏 + 回合选择 chips + 垂直时间线 + 行动卡片。
 *
 * Implements: US-100 模拟过程可视化
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Users, FileText, Archive, EyeOff,
  ChevronRight, Clock, Zap, Loader2, AlertCircle, Activity,
} from 'lucide-react'
import api from '../services/api'

interface Action {
  action_type: string
  actor_id: string
  actor_name?: string
  public_description: string
  private_intent: string
  target_ids: string[]
  propagation_channels: string[]
  is_hidden: boolean
  metadata: Record<string, any>
  timestamp?: string
}

interface RoundData {
  round_num: number
  simulated_hour: number
  active_agents: string[]
  actions: Action[]
  belief_updates: any[]
  propagation_events: any[]
  start_time?: string
  end_time?: string
}

interface RoundsResponse {
  run_id: string
  total_rounds: number
  current_round: number
  rounds: RoundData[]
  actor_names: Record<string, string>
}

const ACTION_META: Record<string, { icon: any; label: string; color: string; bg: string; border: string }> = {
  MAKE_STATEMENT: {
    icon: MessageSquare,
    label: '公开发声',
    color: 'text-brand-700 dark:text-brand-300',
    bg: 'bg-brand-50 dark:bg-brand-950/40',
    border: 'border-brand-200/60 dark:border-brand-800/60',
  },
  PRIVATE_MEETING: {
    icon: Users,
    label: '私下会面',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    border: 'border-purple-200/60 dark:border-purple-800/60',
  },
  PROPOSE_DEAL: {
    icon: Archive,
    label: '提出交易',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200/60 dark:border-amber-800/60',
  },
  TRADE_ASSET: {
    icon: Archive,
    label: '资产转移',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200/60 dark:border-emerald-800/60',
  },
  FILE_DOCUMENT: {
    icon: FileText,
    label: '提交文件',
    color: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    border: 'border-sky-200/60 dark:border-sky-800/60',
  },
}

function actionMeta(t: string) {
  return ACTION_META[t] || {
    icon: Zap,
    label: t || '未知动作',
    color: 'text-ink-700 dark:text-ink-200',
    bg: 'bg-ink-50 dark:bg-ink-900/40',
    border: 'border-ink-200/60 dark:border-ink-800/60',
  }
}

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  DIRECT: { label: '直连', color: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300' },
  BROADCAST: { label: '广播', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  GRAPH: { label: '图谱', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  MEDIA: { label: '媒体', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
}

function ActionCard({ action, idx }: { action: Action; idx: number }) {
  const meta = actionMeta(action.action_type)
  const Icon = meta.icon
  const hasContent = action.public_description?.trim() || action.private_intent?.trim()

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: idx * 0.05 }}
      className="relative pl-10"
    >
      {/* 时间线节点 */}
      <div className="absolute left-2.5 top-4 -translate-x-1/2">
        <div className={`w-3 h-3 rounded-full ${action.is_hidden ? 'bg-ink-400' : 'bg-brand-500'} ring-4 ring-white dark:ring-ink-900`} />
      </div>

      <div className={`rounded-xl border ${meta.border} ${meta.bg} p-4
                       hover:shadow-card transition-shadow duration-200`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className={`w-7 h-7 rounded-lg inline-flex items-center justify-center
                          ${meta.color} bg-white dark:bg-ink-900/60 border ${meta.border}`}>
            <Icon size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold ${meta.color}`}>
              {action.actor_name || 'Unknown'}
            </div>
            <div className="text-[10px] text-ink-500 dark:text-ink-400 uppercase tracking-wider font-medium">
              {meta.label}
            </div>
          </div>
          {action.is_hidden && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                             bg-ink-200/60 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <EyeOff size={9} /> 隐藏
            </span>
          )}
        </div>

        {action.public_description?.trim() && (
          <div className="text-sm text-ink-800 dark:text-ink-100 leading-relaxed mb-2">
            {action.public_description}
          </div>
        )}
        {action.private_intent?.trim() && (
          <div className="text-xs text-ink-500 dark:text-ink-400 italic leading-relaxed mb-2
                          pl-2 border-l-2 border-ink-200 dark:border-ink-700">
            私下意图：{action.private_intent}
          </div>
        )}
        {!hasContent && (
          <div className="text-xs text-ink-400 dark:text-ink-500 italic mb-2">
            （无内容描述）
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {(action.propagation_channels || []).map((c) => {
            const cm = CHANNEL_LABELS[c] || { label: c, color: 'bg-ink-100 text-ink-700' }
            return (
              <span key={c} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cm.color}`}>
                {cm.label}
              </span>
            )
          })}
          {(action.target_ids || []).length > 0 && (
            <span className="text-[10px] text-ink-500 dark:text-ink-400">
              · 影响 {action.target_ids.length} 个目标
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

interface Props { simulationId: string }

export default function RoundTimeline({ simulationId }: Props) {
  const [data, setData] = useState<RoundsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<number>(1)

  const load = async () => {
    try {
      const r = await api.get(`/simulation/${simulationId}/rounds`)
      setData(r.data)
      setError(null)
      if (r.data.rounds?.length > 0 && selectedRound > r.data.rounds.length) {
        setSelectedRound(r.data.rounds.length)
      }
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        setError(e?.message || '加载失败')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationId])

  if (loading && !data) {
    return (
      <div className="card p-6 flex items-center gap-2 text-ink-500 dark:text-ink-400">
        <Loader2 size={16} className="animate-spin" /> 加载博弈时间线…
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6 flex items-center gap-2 text-rose-600 dark:text-rose-400">
        <AlertCircle size={16} /> {error}
      </div>
    )
  }

  if (!data || data.rounds.length === 0) {
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

  const currentRound = data.rounds.find((r) => r.round_num === selectedRound) || data.rounds[0]
  const totalActions = data.rounds.reduce((acc, r) => acc + r.actions.length, 0)
  const allActorIds = new Set<string>()
  data.rounds.forEach((r) => r.actions.forEach((a) => allActorIds.add(a.actor_id)))

  return (
    <div className="card p-5">
      {/* 顶部状态栏（MiroFish 风格） */}
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
          <Stat label="行动总数" value={totalActions} icon={Zap} />
          <Stat label="活跃主体" value={allActorIds.size} icon={Users} />
          <Stat label="模拟时长" value={`${currentRound.simulated_hour}h`} icon={Clock} />
        </div>
      </div>

      {/* 回合选择 chips */}
      <div className="flex items-center gap-1.5 mb-5 overflow-x-auto nice-scroll pb-1">
        {data.rounds.map((r) => {
          const isSel = r.round_num === selectedRound
          return (
            <motion.button
              key={r.round_num}
              whileTap={{ scale: 0.96 }}
              onClick={() => setSelectedRound(r.round_num)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold
                          border transition-colors duration-150
                          ${isSel
                            ? 'bg-gradient-to-r from-brand-500 to-accent-500 text-white border-transparent shadow-soft'
                            : 'bg-white dark:bg-ink-900/40 text-ink-700 dark:text-ink-200 border-ink-200/60 dark:border-ink-800/60 hover:border-brand-400'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isSel ? 'bg-white' : 'bg-emerald-500'}`} />
              R{r.round_num}
              <span className={`px-1.5 rounded text-[10px] ${isSel ? 'bg-white/20' : 'bg-ink-100 dark:bg-ink-800'}`}>
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
              {/* 垂直时间轴线 */}
              <div className="absolute left-2.5 top-0 bottom-0 w-px bg-gradient-to-b from-brand-300 via-accent-300 to-transparent dark:from-brand-700 dark:via-accent-700" />
              <div className="space-y-3">
                {currentRound.actions.map((a, i) => (
                  <ActionCard key={`${currentRound.round_num}-${i}-${a.actor_id}-${a.action_type}`} action={a} idx={i} />
                ))}
              </div>
            </div>
          )}

          {/* 回合元信息 */}
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
