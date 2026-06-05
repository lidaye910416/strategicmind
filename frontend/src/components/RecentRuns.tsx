/**
 * RecentRuns - 侧边栏展示最近推演运行。
 *
 * 数据源：GET /api/pipeline/runs（后端返回内存+磁盘上的所有运行）
 * 每个 run 提供两个入口：报告、推演过程。
 *
 * Implements: US-100 导航
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Activity, Loader2, RefreshCcw, Inbox } from 'lucide-react'
import { APP_ROUTES } from '../i18n/zh'

interface Run {
  run_id: string
  status: string
  progress: number
  completed_stages: string[]
  current_stage?: string
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  completed: { dot: 'bg-emerald-500', label: '已完成' },
  running:   { dot: 'bg-blue-500 animate-pulse-soft', label: '运行中' },
  paused:    { dot: 'bg-amber-500', label: '已暂停' },
  failed:    { dot: 'bg-rose-500', label: '失败' },
  cancelled: { dot: 'bg-ink-400', label: '已取消' },
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  running: '运行中',
  paused: '已暂停',
  failed: '失败',
  cancelled: '已取消',
}

export default function RecentRuns() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/pipeline/runs')
      const d = await r.json()
      // Sort: most recent first by run_id (which embeds a timestamp)
      const list: Run[] = (d.runs || []).slice().sort((a: Run, b: Run) =>
        b.run_id.localeCompare(a.run_id)
      )
      setRuns(list.slice(0, 8))
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div>
      <div className="px-2 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-ink-400 dark:text-ink-500 font-medium">
          最近运行
        </span>
        <button
          onClick={load}
          className="text-ink-400 dark:text-ink-500 hover:text-ink-700 dark:hover:text-ink-200
                     transition-colors"
          title="刷新"
        >
          <RefreshCcw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-ink-400 dark:text-ink-500">
          <Loader2 size={12} className="animate-spin" /> 加载中…
        </div>
      ) : error ? (
        <div className="px-3 py-2 text-xs text-rose-500">{error}</div>
      ) : runs.length === 0 ? (
        <div className="px-3 py-3 text-xs text-ink-400 dark:text-ink-500 flex items-center gap-1.5">
          <Inbox size={12} /> 暂无运行
        </div>
      ) : (
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {runs.map((r) => {
              const s = STATUS_STYLES[r.status] || STATUS_STYLES.cancelled
              const done = r.status === 'completed'
              return (
                <motion.li
                  key={r.run_id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="group rounded-xl border border-transparent
                             hover:border-ink-200/60 dark:hover:border-ink-800/60
                             hover:bg-ink-50/60 dark:hover:bg-ink-900/40
                             transition-colors px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                    <div className="text-[11px] font-mono text-ink-700 dark:text-ink-200
                                    truncate flex-1">
                      {r.run_id}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100
                                    transition-opacity">
                      {done && (
                        <Link
                          to={APP_ROUTES.report(r.run_id)}
                          className="text-ink-400 hover:text-brand-600 dark:hover:text-brand-400"
                          title="查看报告"
                        >
                          <FileText size={12} />
                        </Link>
                      )}
                      <Link
                        to={APP_ROUTES.simulation(r.run_id)}
                        className="text-ink-400 hover:text-brand-600 dark:hover:text-brand-400"
                        title="查看推演"
                      >
                        <Activity size={12} />
                      </Link>
                    </div>
                  </div>
                  <div className="text-[10px] text-ink-400 dark:text-ink-500 mt-0.5 pl-3.5 flex items-center gap-1.5">
                    <span>{STATUS_LABEL[r.status] || r.status}</span>
                    {done && <span>· {Math.round((r.progress || 0) * 100)}%</span>}
                    {!done && r.status === 'running' && (
                      <span>· {r.current_stage}</span>
                    )}
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
