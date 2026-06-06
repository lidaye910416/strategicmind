/**
 * RoundTimeline - 每回合博弈事件流（MiroFish 风格 v2）
 *
 * 升级：
 *   1. 双层轮询：状态（/simulation/<id> 2s）+ 详情（/rounds 4s）
 *   2. 增量去重：用 actionIds Set，newActionsAdded 才 push（避免闪烁）
 *   3. 18 种动作类型专属卡片（覆盖 StrategicAction 全量）
 *   4. 平台分解头：外部博弈（executor/external）/ 内部协同（department/internal）
 *   5. 实时事件横幅：本回合新增 N 条
 *   6. 5 种卡片视觉变体：纯文本/引用块/转发/数字/二元表态
 */
import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Users, FileText, Archive, EyeOff,
  ChevronRight, Clock, Zap, Loader2, AlertCircle, Activity,
  Megaphone, Vote, BarChart3, Share2, Eye as EyeIcon, Brain, UserPlus, UserMinus,
  Search, Lock, Globe, Newspaper, Sparkles, Building2,
} from 'lucide-react'
import api from '../services/api'
import { formatErrorMessage } from '../lib/formatError'

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
  platform?: 'external' | 'internal'  // 平台分类（MiroFish 风格）
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

// 18 种动作类型完整配置（MiroFish 风格）
const ACTION_META: Record<string, {
  icon: any; label: string; color: string; bg: string; border: string; variant: string;
}> = {
  MAKE_STATEMENT:    { icon: Megaphone,  label: '公开发声',   color: 'text-brand-700 dark:text-brand-300',     bg: 'bg-brand-50 dark:bg-brand-950/40',       border: 'border-brand-200/60 dark:border-brand-800/60',   variant: 'text' },
  PUBLISH_REPORT:    { icon: Newspaper,  label: '发布报告',   color: 'text-cyan-700 dark:text-cyan-300',       bg: 'bg-cyan-50 dark:bg-cyan-950/40',         border: 'border-cyan-200/60 dark:border-cyan-800/60',     variant: 'text' },
  FILE_DOCUMENT:     { icon: FileText,   label: '提交文件',   color: 'text-sky-700 dark:text-sky-300',         bg: 'bg-sky-50 dark:bg-sky-950/40',           border: 'border-sky-200/60 dark:border-sky-800/60',       variant: 'text' },
  PRIVATE_MEETING:   { icon: Lock,       label: '私下会商',   color: 'text-purple-700 dark:text-purple-300',   bg: 'bg-purple-50 dark:bg-purple-950/40',     border: 'border-purple-200/60 dark:border-purple-800/60', variant: 'text' },
  LEAK_INFORMATION:  { icon: Share2,     label: '泄漏信息',   color: 'text-rose-700 dark:text-rose-300',       bg: 'bg-rose-50 dark:bg-rose-950/40',         border: 'border-rose-200/60 dark:border-rose-800/60',     variant: 'text' },
  CONCEALED_TRADE:   { icon: EyeOff,     label: '暗盘交易',   color: 'text-ink-700 dark:text-ink-300',         bg: 'bg-ink-50 dark:bg-ink-950/40',           border: 'border-ink-200/60 dark:border-ink-800/60',       variant: 'numeric' },
  PROPOSE_DEAL:      { icon: MessageSquare, label: '提出交易', color: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-950/40',       border: 'border-amber-200/60 dark:border-amber-800/60',   variant: 'text' },
  COORDINATE_POSITION:{ icon: Users,      label: '协调立场',   color: 'text-indigo-700 dark:text-indigo-300',   bg: 'bg-indigo-50 dark:bg-indigo-950/40',     border: 'border-indigo-200/60 dark:border-indigo-800/60', variant: 'text' },
  NEGOTIATE:         { icon: MessageSquare, label: '谈判协商', color: 'text-violet-700 dark:text-violet-300',   bg: 'bg-violet-50 dark:bg-violet-950/40',     border: 'border-violet-200/60 dark:border-violet-800/60', variant: 'text' },
  TRADE_ASSET:       { icon: Archive,    label: '资产转移',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'numeric' },
  ACCUMULATE_POSITION:{ icon: BarChart3, label: '建仓动作',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'numeric' },
  RATING_ACTION:     { icon: Vote,       label: '评级动作',   color: 'text-fuchsia-700 dark:text-fuchsia-300', bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',   border: 'border-fuchsia-200/60 dark:border-fuchsia-800/60', variant: 'binary' },
  SHARE_INTEL:       { icon: Brain,      label: '情报分享',   color: 'text-pink-700 dark:text-pink-300',       bg: 'bg-pink-50 dark:bg-pink-950/40',         border: 'border-pink-200/60 dark:border-pink-800/60',     variant: 'text' },
  SPREAD_NARRATIVE:  { icon: Megaphone,  label: '传播叙事',   color: 'text-orange-700 dark:text-orange-300',   bg: 'bg-orange-50 dark:bg-orange-950/40',     border: 'border-orange-200/60 dark:border-orange-800/60', variant: 'text' },
  GATHER_INTEL:      { icon: Search,     label: '情报搜集',   color: 'text-teal-700 dark:text-teal-300',       bg: 'bg-teal-50 dark:bg-teal-950/40',         border: 'border-teal-200/60 dark:border-teal-800/60',     variant: 'text' },
  FORM_COALITION:    { icon: UserPlus,   label: '组建联盟',   color: 'text-lime-700 dark:text-lime-300',       bg: 'bg-lime-50 dark:bg-lime-950/40',         border: 'border-lime-200/60 dark:border-lime-800/60',     variant: 'text' },
  JOIN_COALITION:    { icon: UserPlus,   label: '加入联盟',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'text' },
  LEAVE_COALITION:   { icon: UserMinus,  label: '退出联盟',   color: 'text-rose-700 dark:text-rose-300',       bg: 'bg-rose-50 dark:bg-rose-950/40',         border: 'border-rose-200/60 dark:border-rose-800/60',     variant: 'text' },
  IDLE:              { icon: EyeIcon,    label: '保持沉默',   color: 'text-ink-500',                            bg: 'bg-ink-50/50 dark:bg-ink-900/30',        border: 'border-ink-200/40 dark:border-ink-800/40',       variant: 'idle' },
}

function actionMeta(t: string) {
  return ACTION_META[t] || {
    icon: Zap, label: t || '未知动作',
    color: 'text-ink-700 dark:text-ink-200',
    bg: 'bg-ink-50 dark:bg-ink-900/40',
    border: 'border-ink-200/60 dark:border-ink-800/60',
    variant: 'text',
  }
}

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  DIRECT: { label: '直连', color: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300' },
  BROADCAST: { label: '广播', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  GRAPH: { label: '图谱', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  MEDIA: { label: '媒体', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
  SOCIAL_MEDIA: { label: '社交', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300' },
  MARKET_SIGNAL: { label: '市场', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  RUMOR: { label: '传闻', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  OFFICIAL: { label: '官方', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
}

function classifyPlatform(action: Action): 'external' | 'internal' {
  // 内部动作（部门内部、协同）
  if (['PRIVATE_MEETING', 'COORDINATE_POSITION', 'JOIN_COALITION', 'LEAVE_COALITION'].includes(action.action_type)) {
    return 'internal'
  }
  return 'external'
}

function ActionCard({ action, idx }: { action: Action; idx: number }) {
  const meta = actionMeta(action.action_type)
  const Icon = meta.icon
  const hasContent = action.public_description?.trim() || action.private_intent?.trim()
  const isHidden = action.is_hidden
  const platform = action.platform || classifyPlatform(action)
  // Action unique id for dedup
  const actionId = action.metadata?.id || `${action.actor_id}-${action.action_type}-${action.timestamp || idx}-${idx}`

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.3) }}
      className="relative pl-10"
      data-action-id={actionId}
    >
      {/* 时间线节点 */}
      <div className="absolute left-2.5 top-4 -translate-x-1/2">
        <div className={`w-3 h-3 rounded-full ${isHidden ? 'bg-ink-400' : 'bg-brand-500'} ring-4 ring-white dark:ring-ink-900`} />
      </div>

      <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5
                       hover:shadow-card transition-all duration-200 group`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className={`w-7 h-7 rounded-lg inline-flex items-center justify-center
                          ${meta.color} bg-white dark:bg-ink-900/60 border ${meta.border}`}>
            <Icon size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink-900 dark:text-white truncate">
              {action.actor_name || action.actor_id}
            </div>
            <div className={`text-[10px] ${meta.color} uppercase tracking-wider font-semibold`}>
              {meta.label}
            </div>
          </div>
          {/* Platform badge */}
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
              platform === 'internal'
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
            }`}
            title={platform === 'internal' ? '组织内部' : '外部博弈'}
          >
            {platform === 'internal' ? <Building2 size={9} /> : <Globe size={9} />}
            {platform === 'internal' ? '内部' : '外部'}
          </span>
          {isHidden && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                             bg-ink-200/60 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <EyeOff size={9} /> 隐藏
            </span>
          )}
        </div>

        {/* Variant-specific body */}
        {meta.variant === 'numeric' && (action.metadata?.amount || action.metadata?.value) && (
          <div className="text-lg font-mono font-bold text-ink-900 dark:text-white my-1.5">
            {action.metadata.currency || ''}{action.metadata.amount || action.metadata.value}
            {action.metadata.target && (
              <span className="text-xs text-ink-500 font-normal ml-1.5">→ {action.metadata.target}</span>
            )}
          </div>
        )}
        {meta.variant === 'binary' && (
          <div className="flex items-center gap-2 my-1.5">
            {action.metadata?.rating ? (
              <span className={`text-base font-bold ${
                action.metadata.rating === 'UPGRADE' || action.metadata.rating === 'POSITIVE'
                  ? 'text-emerald-600' : 'text-rose-600'
              }`}>
                {action.metadata.rating === 'UPGRADE' || action.metadata.rating === 'POSITIVE' ? '↑' : '↓'}
                {' '}{action.metadata.new_rating || action.metadata.from_to || '评级变动'}
              </span>
            ) : (
              <span className="text-sm text-ink-700">评级动作</span>
            )}
          </div>
        )}
        {meta.variant === 'idle' && (
          <div className="text-xs text-ink-500 dark:text-ink-400 italic my-1.5">
            （静默观望，不采取行动）
          </div>
        )}

        {/* 公共描述 + 引用样式 */}
        {action.public_description?.trim() && meta.variant === 'text' && (
          <div className="text-[13px] text-ink-800 dark:text-ink-100 leading-relaxed mb-1.5">
            {action.public_description}
          </div>
        )}
        {action.private_intent?.trim() && (
          <div className="text-[11px] text-ink-500 dark:text-ink-400 italic leading-relaxed
                          pl-2 border-l-2 border-ink-200 dark:border-ink-700 mt-1.5">
            <span className="font-semibold not-italic">私下意图：</span>{action.private_intent}
          </div>
        )}
        {!hasContent && meta.variant === 'text' && (
          <div className="text-[11px] text-ink-400 dark:text-ink-500 italic mb-1.5">
            （无文字描述）
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {(action.propagation_channels || []).map((c) => {
            const cm = CHANNEL_LABELS[c] || { label: c, color: 'bg-ink-100 text-ink-700' }
            return (
              <span key={c} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cm.color}`}>
                {cm.label}
              </span>
            )
          })}
          {(action.target_ids || []).length > 0 && (
            <span className="text-[10px] text-ink-500 dark:text-ink-400 flex items-center gap-0.5">
              <ChevronRight size={9} /> 影响 {action.target_ids.length} 个目标
            </span>
          )}
          {action.timestamp && (
            <span className="text-[10px] text-ink-400 font-mono ml-auto">
              {action.timestamp.slice(11, 19)}
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
  const [newCount, setNewCount] = useState(0)
  const [paused, setPaused] = useState(false)

  // 轻量轮询：状态（2s）
  useEffect(() => {
    if (!simulationId) return
    const tick = async () => {
      try {
        await api.get(`/simulation/${simulationId}`)
      } catch {/* ignore */}
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [simulationId])

  // 详情轮询：回合+动作（4s）+ 增量去重
  const load = async () => {
    try {
      const fresh = (await api.get(`/simulation/${simulationId}/rounds`)).data
      setError(null)
      // 增量去重：基于 action.uniqueId（来自 metadata.id 或组合键）
      let added = 0
      if (fresh.rounds && data?.rounds) {
        const prevIds = new Set<string>()
        data.rounds.forEach((rd: RoundData) =>
          rd.actions.forEach((a: Action) => {
            const id = a.metadata?.id || `${a.actor_id}-${a.action_type}-${a.timestamp}`
            prevIds.add(id)
          })
        )
        fresh.rounds.forEach((rd: RoundData) =>
          rd.actions.forEach((a: Action) => {
            const id = a.metadata?.id || `${a.actor_id}-${a.action_type}-${a.timestamp}`
            if (!prevIds.has(id)) added++
          })
        )
      }
      if (added > 0 && !paused) {
        setNewCount((c) => c + added)
        // 3s 后自动归零
        setTimeout(() => setNewCount(0), 3000)
      }
      setData(fresh)
      if (fresh.rounds?.length > 0 && selectedRound > fresh.rounds.length) {
        setSelectedRound(fresh.rounds.length)
      }
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        setError(formatErrorMessage(e))
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
  }, [simulationId, paused])

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

  return (
    <div className="card p-5">
      {/* 顶部状态栏（MiroFish 风格 + 平台分解） */}
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
