/**
 * SystemLogs - 推演系统日志栏（MiroFish 风格）
 *
 * 仿照 MiroFish Step3Simulation 底部 .system-logs：
 *   - 黑色背景 + 绿色等宽字体（terminal 风）
 *   - 毫秒精度时间戳（HH:MM:SS.mmm）
 *   - 自动滚动到最新
 *   - 来源标签：Pipeline / Plaza / Community / Engine / Event
 *
 * 数据源（FE3 P3-C：统一 EventSource 入口）：
 *   1. usePipelineEvent 订阅 store 派发的 live_event（log_line / stage_change /
 *      graph_progress / round_progress 全部由 store 内的唯一 EventSource 接收后派发）
 *   2. 客户端自发事件：阶段切换、轮次变化等
 *   3. 命令历史（用户操作）
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Trash2, Pause, Play, ChevronDown } from 'lucide-react'
import { usePipelineEvent } from '../store/pipeline'

const SOURCE_STYLES: Record<string, { color: string; prefix: string }> = {
  Pipeline:  { color: 'text-cyan-400',   prefix: '[Pipeline]' },
  Engine:    { color: 'text-emerald-400', prefix: '[Engine]' },
  Plaza:     { color: 'text-sky-400',     prefix: '[Plaza]' },
  Community: { color: 'text-purple-400',  prefix: '[Community]' },
  Graph:     { color: 'text-violet-400',  prefix: '[Graph]' },
  Round:     { color: 'text-amber-400',   prefix: '[Round]' },
  Event:     { color: 'text-rose-400',    prefix: '[Event]' },
  LLM:       { color: 'text-orange-400',  prefix: '[LLM]' },
  User:      { color: 'text-pink-400',    prefix: '[User]' },
  System:    { color: 'text-ink-400',     prefix: '[System]' },
}

interface LogLine {
  id: string
  ts: number
  source: string
  msg: string
  level?: 'info' | 'warn' | 'error' | 'success'
}

interface Props {
  runId?: string | null
  /** 高度（默认 220） */
  height?: number
  /** 客户端推入日志的回调 */
  externalLogs?: LogLine[]
}

const MAX_LINES = 200

export default function SystemLogs({ runId, height = 220, externalLogs = [] }: Props) {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // 客户端推入的日志（合并到日志流）
  useEffect(() => {
    if (externalLogs.length === 0) return
    setLogs((prev) => {
      const last = prev[prev.length - 1]
      // 避免重复
      const newOnes = externalLogs.filter((l) => l.id !== last?.id && !prev.find((p) => p.id === l.id))
      return [...prev, ...newOnes].slice(-MAX_LINES)
    })
  }, [externalLogs])

  // 客户端推送函数（暴露到 window 方便其它组件调用）
  const push = useCallback((opts: { source: string; msg: string; level?: LogLine['level'] }) => {
    if (paused) return
    setLogs((prev) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const next: LogLine = { id, ts: Date.now(), ...opts }
      const out = [...prev, next]
      return out.length > MAX_LINES ? out.slice(-MAX_LINES) : out
    })
  }, [paused])

  // FE3 P3-C：usePipelineEvent 订阅 store 派发的 live_event（无自建 EventSource）
  usePipelineEvent(
    (ev) => {
      const e = ev.raw || ev
      const t = e?.type
      const d = e?.data
      if (t === 'graph_progress') {
        push({
          source: 'Graph',
          msg: `节点 ${d?.nodes} · 关系 ${d?.edges} ${d?.phase === 'completed' ? '✓ 完成' : '· Δ+' + (d?.delta_nodes || 0) + '/' + (d?.delta_edges || 0)}`,
          level: d?.phase === 'completed' ? 'success' : 'info',
        })
      } else if (t === 'round_progress') {
        push({
          source: 'Round',
          msg: `R${d?.round}/${d?.total_rounds} · 行动 ${d?.actions_count} · 传播 ${(d?.propagation_edges || []).length} · 活跃 ${d?.active_agents}`,
          level: 'info',
        })
      } else if (t === 'log_line') {
        push({
          source: d?.source || 'Event',
          msg: d?.msg || '',
          level: d?.level || 'info',
        })
      } else if (t === 'stage_change') {
        push({
          source: 'Pipeline',
          msg: `阶段切换 → ${d?.stage || '?'}`,
          level: 'info',
        })
      }
    },
    (ev) => {
      const t = ev.type
      return t === 'log_line' || t === 'stage_change' || t === 'graph_progress' || t === 'round_progress'
    },
  )
  // 保留 runId 形参以兼容调用方
  void runId

  // 自动滚动
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // 检测用户手动滚动（关闭自动滚动）
  const handleScroll = () => {
    if (!containerRef.current) return
    const el = containerRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    setAutoScroll(atBottom)
  }

  // 暴露 push 到 window 方便外部组件调用
  useEffect(() => {
    (window as any).__pushLog = push
    return () => { delete (window as any).__pushLog }
  }, [push])

  return (
    <div className="rounded-xl bg-ink-950 border border-ink-800 overflow-hidden flex flex-col" style={{ height }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-ink-900/80 border-b border-ink-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase">System Dashboard</span>
          <span className="text-[9px] text-ink-500 font-mono">{logs.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused((p) => !p)}
            className="text-ink-400 hover:text-white transition-colors p-1"
            title={paused ? '继续' : '暂停'}
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
          </button>
          <button
            onClick={() => setLogs([])}
            className="text-ink-400 hover:text-white transition-colors p-1"
            title="清空"
          >
            <Trash2 size={10} />
          </button>
          <button
            onClick={() => {
              setAutoScroll(true)
              if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
            }}
            className="text-ink-400 hover:text-white transition-colors p-1"
            title="滚到底部"
          >
            <ChevronDown size={10} />
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5"
      >
        <AnimatePresence initial={false}>
          {logs.length === 0 ? (
            <div className="text-ink-600 italic">No log entries yet. Start a simulation to see live events…</div>
          ) : logs.map((line) => {
            const src = SOURCE_STYLES[line.source] || SOURCE_STYLES.System
            const levelColor =
              line.level === 'error' ? 'text-rose-400' :
              line.level === 'warn' ? 'text-amber-400' :
              line.level === 'success' ? 'text-emerald-400' :
              'text-ink-200'
            return (
              <motion.div
                key={line.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-start gap-2 hover:bg-ink-900/40 -mx-1 px-1 rounded"
              >
                <span className="text-ink-500 flex-shrink-0">{formatTs(line.ts)}</span>
                <span className={`flex-shrink-0 font-semibold ${src.color}`}>{src.prefix}</span>
                <span className={`flex-1 break-all ${levelColor}`}>{line.msg}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {!autoScroll && logs.length > 5 && (
          <div className="sticky bottom-0 left-0 right-0 text-center py-1">
            <button
              onClick={() => {
                setAutoScroll(true)
                if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
              }}
              className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500 text-white shadow-soft hover:bg-brand-600"
            >
              ↓ 跳到最新
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

// 暴露的全局推送函数（其它组件可调用）
export function pushLog(source: string, msg: string, level?: 'info' | 'warn' | 'error' | 'success') {
  const fn = (window as any).__pushLog
  if (fn) fn({ source, msg, level })
}
