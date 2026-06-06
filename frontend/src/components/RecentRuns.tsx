/**
 * RecentRuns - 可折叠的最近推演列表。
 *
 * 改进：
 * - 支持单条删除（X 按钮）
 * - 支持批量清空已完成
 * - 默认折叠，不占主屏空间
 * - 实时状态点 + 进度条
 * - 点击展开运行详情
 */
import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Activity, Loader2, RefreshCcw, Inbox, ChevronRight,
  Trash2, X, Check, AlertCircle, Pause, Clock, Copy,
} from 'lucide-react'
import api from '../services/api'
import { APP_ROUTES, STAGE_LABELS, RECENT_RUNS } from '../i18n/zh'
import { formatErrorMessage } from '../lib/formatError'

interface Run {
  run_id: string
  status: string
  progress: number
  completed_stages: string[]
  current_stage?: string
  started_at?: number
  updated_at?: number
  config?: { report_style?: string }
}

const STATUS_STYLES: Record<string, { dot: string; label: string; icon: any; color: string }> = {
  completed: { dot: 'bg-emerald-500', label: '已完成', icon: Check, color: 'text-emerald-600' },
  running:   { dot: 'bg-blue-500 animate-pulse-soft', label: '运行中', icon: Activity, color: 'text-blue-600' },
  paused:    { dot: 'bg-amber-500', label: '已暂停', icon: Pause, color: 'text-amber-600' },
  failed:    { dot: 'bg-rose-500', label: '失败', icon: AlertCircle, color: 'text-rose-600' },
  cancelled: { dot: 'bg-ink-400', label: '已取消', icon: X, color: 'text-ink-500' },
}

export default function RecentRuns() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)  // 默认折叠
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // P1-15: 复制此 run 的配置到 Dashboard（仅复用 hours/style；doc_ids 留空）
  const cloneConfig = (runId: string) => {
    navigate(`/?cloneConfig=${encodeURIComponent(runId)}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/pipeline/runs')
      const sortFn = (a: Run, b: Run) => b.run_id.localeCompare(a.run_id)
      const list: Run[] = ((r.data.runs || []) as Run[]).slice().sort(sortFn)
      setRuns(list)
    } catch (e: any) {
      setError(formatErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  // 删除单个 run（本地状态 + 后端）
  const deleteRun = async (runId: string) => {
    setRuns((prev) => prev.filter((r) => r.run_id !== runId))
    setDeleteConfirm(null)
    try {
      await api.delete(`/pipeline/${runId}`)
    } catch (e) {
      // 后端可能没有 DELETE，但本地已删除
      console.warn('后端删除失败（已从列表移除）', e)
    }
  }

  // 清空所有已完成的
  const clearCompleted = async () => {
    const completed = runs.filter((r) => r.status === 'completed')
    setRuns((prev) => prev.filter((r) => r.status !== 'completed'))
    for (const r of completed) {
      try {
        await api.delete(`/pipeline/${r.run_id}`)
      } catch (e) { /* 忽略 */ }
    }
  }

  // 统计
  const completedCount = runs.filter((r) => r.status === 'completed').length
  const runningCount = runs.filter((r) => r.status === 'running').length

  return (
    <div className="card overflow-hidden">
      {/* 头部 - 可折叠 */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-3 py-2.5 flex items-center justify-between
                   hover:bg-ink-50/60 dark:hover:bg-ink-900/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={12}
            className={`text-ink-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-semibold">
            历史任务
          </span>
          <span className="text-[10px] text-ink-400">
            ({runs.length})
          </span>
          {runningCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-0.5">
              <Activity size={8} className="animate-pulse" />
              {runningCount} 运行中
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {completedCount > 0 && !collapsed && (
            <button
              onClick={clearCompleted}
              className="text-[10px] text-ink-400 hover:text-rose-500 px-1.5 py-0.5
                         rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              title={`清空 ${completedCount} 条已完成任务`}
            >
              清空已完成
            </button>
          )}
          <button
            onClick={load}
            className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 p-0.5"
            title="刷新"
          >
            <RefreshCcw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-ink-200/40 dark:border-ink-800/40"
          >
            <div className="max-h-80 overflow-y-auto">
              {loading && runs.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-ink-400">
                  <Loader2 size={12} className="animate-spin" /> 加载中…
                </div>
              ) : error ? (
                <div className="px-3 py-2 text-xs text-rose-500">{error}</div>
              ) : runs.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-ink-400 flex flex-col items-center gap-1.5">
                  <Inbox size={20} className="opacity-50" />
                  暂无运行
                  <div className="text-[10px]">从工作台启动推演后，历史任务会显示在这里</div>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800/60">
                  <AnimatePresence initial={false}>
                    {runs.map((r) => {
                      const s = STATUS_STYLES[r.status] || STATUS_STYLES.cancelled
                      const Icon = s.icon
                      const done = r.status === 'completed'
                      const running = r.status === 'running'
                      const isConfirming = deleteConfirm === r.run_id

                      return (
                        <motion.li
                          key={r.run_id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, x: -20, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="group px-3 py-2 hover:bg-ink-50/60 dark:hover:bg-ink-900/30 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                            <Icon size={11} className={s.color} />
                            <div className="text-[11px] font-mono text-ink-700 dark:text-ink-200 truncate flex-1">
                              {r.run_id}
                            </div>
                            {/* 操作按钮 - hover 时显示 */}
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {done && (
                                <Link
                                  to={APP_ROUTES.report(r.run_id)}
                                  className="p-1 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30"
                                  title="查看报告"
                                >
                                  <FileText size={11} />
                                </Link>
                              )}
                              <Link
                                to={APP_ROUTES.simulation(r.run_id)}
                                className="p-1 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30"
                                title="查看推演"
                              >
                                <Activity size={11} />
                              </Link>
                              {/* P1-15: 复制此 run 的配置（hours/style）到 Dashboard */}
                              <button
                                onClick={() => cloneConfig(r.run_id)}
                                className="p-1 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30"
                                title={RECENT_RUNS.copyConfigTitle(r.run_id)}
                              >
                                <Copy size={11} />
                              </button>
                              {isConfirming ? (
                                <>
                                  <button
                                    onClick={() => deleteRun(r.run_id)}
                                    className="p-1 rounded text-rose-600 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100"
                                    title="确认删除"
                                  >
                                    <Check size={11} />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="p-1 rounded text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                                    title="取消"
                                  >
                                    <X size={11} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(r.run_id)}
                                  className="p-1 rounded text-ink-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                  title="删除"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* 状态行 + 进度条 */}
                          <div className="mt-1.5 ml-3.5 space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className={`font-medium ${s.color}`}>{s.label}</span>
                              {running && r.current_stage && (
                                <span className="text-ink-500 truncate">
                                  {STAGE_LABELS[r.current_stage] || r.current_stage}
                                </span>
                              )}
                              {done && (
                                <span className="text-ink-400 font-mono">
                                  {Math.round((r.progress || 0) * 100)}%
                                </span>
                              )}
                            </div>
                            {/* 进度条 */}
                            {(running || done) && (
                              <div className="h-0.5 bg-ink-100 dark:bg-ink-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    done ? 'bg-emerald-500' : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${Math.round((r.progress || 0) * 100)}%` }}
                                />
                              </div>
                            )}
                            {/* 时间戳 */}
                            {r.updated_at && (
                              <div className="text-[9px] text-ink-400 flex items-center gap-0.5">
                                <Clock size={8} />
                                {new Date(r.updated_at * 1000).toLocaleString('zh-CN', {
                                  month: '2-digit', day: '2-digit',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </div>
                            )}
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
