/**
 * SimulationNetworkGraph - 模拟迭代关系网图（核心特性）。
 *
 * 每个 round 一帧：
 *   - 节点 = 智能体（按 agent_type 着色）
 *   - 边 = 该 round 的传播事件
 *   - 边颜色按 round 渐变（R1 浅蓝 → R5 深紫），形成"时间维度"
 *   - 节点大小 = 影响力
 *
 * 底部时间轴：点击 round 切换聚焦（其他 round 边淡化）
 * 右侧统计：本 round 新增边数 / 累计边数
 *
 * 数据源（FE3 P3-C：统一 EventSource 入口）：
 *   1. Store selector: useNetworkFrames()（由 store 内的唯一 EventSource
 *      解析 round_progress 后写入，组件不再自建 SSE）
 *   2. REST: /api/pipeline/<run_id>/network-frames（启动一次性拉全量）
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Radio, Eye, EyeOff, Pause, Play,
  ChevronLeft, ChevronRight, Zap,
} from 'lucide-react'
import api from '../services/api'
import {
  useNetworkFrames,
  useLastEventAt,
  type NetworkFrameLive,
} from '../store/pipeline'

const AGENT_COLORS: Record<string, string> = {
  CORPORATE_EXEC: '#FF6B35',
  INSTITUTIONAL_INVESTOR: '#004E89',
  POLICY_MAKER: '#C5283D',
  REGULATOR: '#7B2D8E',
  RATING_AGENCY: '#E9724C',
  MEDIA: '#1A936F',
  ANALYST: '#06B6D4',
  ADVOCACY: '#E91E63',
  DEFAULT: '#94A3B8',
}

// 边的颜色按 round 渐变：5 轮以内用蓝→紫；>5 轮循环
const ROUND_COLORS = [
  '#60A5FA', // R1 浅蓝
  '#3B82F6', // R2 蓝
  '#8B5CF6', // R3 紫
  '#A855F7', // R4 深紫
  '#EC4899', // R5 粉
  '#F59E0B', // R6 橙
  '#10B981', // R7 绿
]

interface NetworkAgent {
  id: string
  name: string
  type: string
  influence: number
}

interface NetworkEdge {
  source: string
  target: string
  channel: string
  round: number
}

interface Frame {
  round: number
  actions_count: number
  active_agents: number
  edges: NetworkEdge[]
  cumulative_edge_count: number
}

interface Props {
  runId?: string | null
  height?: number
  title?: string
  /** 模拟数据（无 runId 时用） */
  mockAgents?: NetworkAgent[]
  mockFrames?: Frame[]
}

export default function SimulationNetworkGraph({
  runId, height = 480, title = '迭代关系网',
  mockAgents, mockFrames,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [agents, setAgents] = useState<NetworkAgent[]>(mockAgents || [])
  const [frames, setFrames] = useState<Frame[]>(mockFrames || [])
  const [focusRound, setFocusRound] = useState<number | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const loading = false

  // ---- FE3 P3-C：store selector 替代自建 SSE ----
  const storeFrames = useNetworkFrames()
  const lastEventAt = useLastEventAt()

  const W = 900
  const H = height

  // 把 store frames 同步进本地 frames 状态（保持兼容）
  useEffect(() => {
    if (storeFrames.length === 0) return
    setFrames(storeFrames.map(toLocalFrame))
  }, [storeFrames])

  // autoFollow 时跟随最新 round
  useEffect(() => {
    if (!autoFollow || storeFrames.length === 0) return
    const last = storeFrames[storeFrames.length - 1]
    setFocusRound(last.round)
    // 仅依赖 lastEventAt 防止 loop（storeFrames 也会变化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEventAt])

  // 启动拉全量
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/pipeline/${runId}/network-frames`)
        if (cancelled) return
        setAgents(r.data.agents || [])
        setFrames(r.data.frames || [])
      } catch {/* ignore */}
    })()
    return () => { cancelled = true }
  }, [runId])

  // 计算每条边的累计状态
  const allEdgesWithRound = useMemo(() => {
    return frames.flatMap((f) => f.edges.map((e) => ({ ...e, round: f.round })))
  }, [frames])

  // 力模拟
  useEffect(() => {
    if (agents.length === 0) return
    let raf: number
    let iter = 0
    const maxIter = 400
    const step = () => {
      setAgents((prev) => {
        const next = prev.map((a) => ({ ...a }))
        // 附加位置信息
        type AWithPos = NetworkAgent & { x: number; y: number; vx: number; vy: number }
        const withPos: AWithPos[] = next.map((a, i) => {
          const a2 = a as any
          if (typeof a2.x !== 'number') {
            const angle = (i / next.length) * Math.PI * 2
            return { ...a, x: W/2 + Math.cos(angle) * 200, y: H/2 + Math.sin(angle) * 200, vx: 0, vy: 0 }
          }
          return a2
        })
        const cx = W / 2, cy = H / 2
        for (let i = 0; i < withPos.length; i++) {
          for (let j = i + 1; j < withPos.length; j++) {
            const dx = withPos[j].x - withPos[i].x
            const dy = withPos[j].y - withPos[i].y
            const dist = Math.sqrt(dx*dx + dy*dy) || 1
            const force = 6000 / (dist * dist)
            withPos[i].vx -= (dx/dist) * force
            withPos[i].vy -= (dy/dist) * force
            withPos[j].vx += (dx/dist) * force
            withPos[j].vy += (dy/dist) * force
          }
        }
        for (const edge of allEdgesWithRound) {
          const a = withPos.find((n) => n.id === edge.source)
          const b = withPos.find((n) => n.id === edge.target)
          if (!a || !b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx*dx + dy*dy) || 1
          const target = 160
          const diff = (dist - target) * 0.02
          a.vx += (dx/dist) * diff
          a.vy += (dy/dist) * diff
          b.vx -= (dx/dist) * diff
          b.vy -= (dy/dist) * diff
        }
        for (const n of withPos) {
          n.vx += (cx - n.x) * 0.004
          n.vy += (cy - n.y) * 0.004
          n.vx *= 0.8
          n.vy *= 0.8
          n.x += n.vx
          n.y += n.vy
          n.x = Math.max(40, Math.min(W - 40, n.x))
          n.y = Math.max(40, Math.min(H - 40, n.y))
        }
        return withPos as any
      })
      iter++
      if (iter < maxIter) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [allEdgesWithRound.length, agents.length > 0])

  const totalRounds = frames.length
  const totalEdges = allEdgesWithRound.length
  const focusFrame = focusRound != null ? frames.find((f) => f.round === focusRound) : null

  return (
    <div className="card p-4 flex flex-col" style={{ minHeight: height + 200 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-purple-500/20 inline-flex items-center justify-center text-brand-600">
            <Radio size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {title}
            </div>
            <div className="text-xs text-ink-700 dark:text-ink-300 truncate">
              {totalRounds > 0
                ? `已推演 ${totalRounds} 回合 · 累计 ${totalEdges} 条传播边`
                : '等待模拟启动…'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className={`btn-ghost h-7 px-2 text-[10px] flex items-center gap-1 ${autoFollow ? 'text-brand-600' : ''}`}
            onClick={() => setAutoFollow((v) => !v)}
            title="自动跟随最新回合"
          >
            {autoFollow ? <Pause size={10} /> : <Play size={10} />}
            {autoFollow ? '跟随中' : '已暂停'}
          </button>
          <button className="btn-ghost h-7 w-7 p-0" onClick={() => setShowLabels((v) => !v)}>
            {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative rounded-xl bg-gradient-to-br from-ink-50/30 to-ink-100/30 dark:from-ink-900/30 dark:to-ink-800/30 overflow-hidden border border-ink-200/40"
        style={{ minHeight: height }}
      >
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <defs>
            {ROUND_COLORS.map((c, i) => (
              <linearGradient key={i} id={`round-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={c} stopOpacity="0.9" />
                <stop offset="100%" stopColor={c} stopOpacity="0.4" />
              </linearGradient>
            ))}
            {Object.entries(AGENT_COLORS).map(([type, color]) => (
              <radialGradient key={type} id={`agent-grad-${type}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={color} stopOpacity="1" />
                <stop offset="100%" stopColor={color} stopOpacity="0.55" />
              </radialGradient>
            ))}
          </defs>

          {/* Edges - 按 round 着色 */}
          {allEdgesWithRound.map((edge, i) => {
            const a = agents.find((n) => n.id === edge.source) as any
            const b = agents.find((n) => n.id === edge.target) as any
            if (!a || !b || typeof a.x !== 'number') return null
            const colorIdx = (edge.round - 1) % ROUND_COLORS.length
            const isFocus = focusRound == null || edge.round === focusRound
            const isHighlighted = hovered === edge.source || hovered === edge.target
            return (
              <g key={`e-${i}`} opacity={isFocus ? (hovered && !isHighlighted ? 0.2 : 0.85) : 0.15}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={ROUND_COLORS[colorIdx]}
                  strokeWidth={isFocus ? 1.6 : 1}
                  strokeOpacity={isFocus ? 0.8 : 0.2}
                />
                {isFocus && isHighlighted && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 4}
                    textAnchor="middle"
                    className="fill-ink-700 dark:fill-ink-200"
                    style={{ fontSize: 9, fontWeight: 600 }}
                  >
                    R{edge.round} · {edge.channel}
                  </text>
                )}
              </g>
            )
          })}

          {/* Nodes */}
          {agents.map((node) => {
            const n = node as any
            if (typeof n.x !== 'number') return null
            const r = 8 + (n.influence || 0.5) * 14
            const isHighlighted = hovered === n.id
            const color = AGENT_COLORS[n.type] || AGENT_COLORS.DEFAULT
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Halo for high-influence agents */}
                {(n.influence || 0) > 0.7 && (
                  <circle r={r + 6} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.4}>
                    <animate attributeName="r" values={`${r+4};${r+10};${r+4}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  r={r}
                  fill={`url(#agent-grad-${n.type in AGENT_COLORS ? n.type : 'DEFAULT'})`}
                  stroke={isHighlighted ? '#fff' : color}
                  strokeWidth={isHighlighted ? 3 : 2}
                />
                {showLabels && (
                  <text
                    x={r + 4} y={4}
                    className="fill-ink-800 dark:fill-ink-100"
                    style={{
                      fontSize: 10, fontWeight: 500, pointerEvents: 'none',
                      textShadow: '0 0 3px #fff, 0 0 3px #fff',
                    }}
                  >
                    {n.name.length > 8 ? n.name.slice(0, 8) + '…' : n.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {agents.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-400">
            <Radio size={36} className="mb-2 opacity-30" />
            <div className="text-xs">{loading ? '加载中…' : '等待模拟启动'}</div>
            <div className="text-[10px] mt-1">每个 round 完成时关系网会动态更新</div>
          </div>
        )}

        {/* Round 边数统计 */}
        {focusFrame && (
          <div className="absolute top-3 right-3 card p-2 text-[10px] space-y-1 bg-white/90 dark:bg-ink-900/90">
            <div className="flex items-center gap-1 font-bold text-brand-700 dark:text-brand-300">
              <Activity size={10} /> R{focusFrame.round} 回合
            </div>
            <div className="text-ink-600 dark:text-ink-300">
              新增传播: <span className="font-mono font-bold">{focusFrame.edges.length}</span>
            </div>
            <div className="text-ink-600 dark:text-ink-300">
              累计传播: <span className="font-mono font-bold">{focusFrame.cumulative_edge_count}</span>
            </div>
            <div className="text-ink-600 dark:text-ink-300">
              行动次数: <span className="font-mono font-bold">{focusFrame.actions_count}</span>
            </div>
            <div className="text-ink-600 dark:text-ink-300">
              活跃 Agent: <span className="font-mono font-bold">{focusFrame.active_agents}</span>
            </div>
          </div>
        )}

        {/* Agent 图例 */}
        {agents.length > 0 && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5 pointer-events-none">
            {Object.entries(
              agents.reduce<Record<string, number>>((m, a) => {
                m[a.type] = (m[a.type] || 0) + 1
                return m
              }, {})
            ).slice(0, 6).map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/85 dark:bg-ink-900/85 backdrop-blur-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: AGENT_COLORS[type] || AGENT_COLORS.DEFAULT }} />
                <span className="text-ink-700 dark:text-ink-200">{type}</span>
                <span className="text-ink-500 font-mono">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Round 时间轴 */}
      <div className="mt-3 flex-shrink-0">
        <div className="flex items-center justify-between text-[10px] text-ink-500 font-semibold uppercase tracking-wider mb-1.5">
          <span className="flex items-center gap-1"><Zap size={10} /> 回合时间轴</span>
          <span className="font-mono normal-case text-ink-400">{totalRounds} rounds · {totalEdges} edges</span>
        </div>
        <div className="relative flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            className="btn-ghost h-6 w-6 p-0 flex-shrink-0"
            disabled={frames.length === 0}
            onClick={() => setFocusRound((r) => r == null ? null : Math.max(1, r - 1))}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            className={`btn-ghost h-6 px-2 text-[10px] flex-shrink-0 ${focusRound == null ? 'bg-brand-500 text-white' : ''}`}
            onClick={() => setFocusRound(null)}
          >
            全部
          </button>
          {frames.map((f) => {
            const colorIdx = (f.round - 1) % ROUND_COLORS.length
            const isFocus = focusRound === f.round
            return (
              <motion.button
                key={f.round}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.05 * (f.round - 1) }}
                onClick={() => setFocusRound(f.round)}
                className={`h-7 px-2 rounded-md text-[10px] font-semibold flex-shrink-0 flex items-center gap-1 border transition-all ${
                  isFocus
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                    : 'border-ink-200/60 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/30 text-ink-600 dark:text-ink-300'
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: ROUND_COLORS[colorIdx] }}
              >
                <span className="font-mono font-bold">R{f.round}</span>
                <span className="text-ink-500 font-mono">+{f.edges.length}</span>
              </motion.button>
            )
          })}
          <button
            className="btn-ghost h-6 w-6 p-0 flex-shrink-0"
            disabled={frames.length === 0}
            onClick={() => setFocusRound((r) => r == null ? 1 : Math.min(totalRounds, r + 1))}
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

// 把 store 内的 NetworkFrameLive 转成本地 Frame 形态（保持兼容）
function toLocalFrame(f: NetworkFrameLive): Frame {
  return {
    round: f.round,
    actions_count: f.actions_count ?? 0,
    active_agents: (f.active_agents as any) ?? 0,
    edges: (f.edges as any[]).map((e: any) => ({ source: e.source, target: e.target, channel: e.channel, round: e.round })),
    cumulative_edge_count: 0,
  }
}
