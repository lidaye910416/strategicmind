/**
 * RecentRuns - 历史任务卡片列表 (G4 P3 PERSIST 重构版)。
 *
 * 设计：
 *   - 每条历史 run 渲染为一张卡片
 *   - 卡片内容：run_id + 状态徽章 + config 摘要（年限/部门数/外部因素数）+ 风格 badge + 时间
 *   - 卡片底部 2 个操作按钮：查看报告 / 复制配置
 *   - 默认折叠，避免占用 Dashboard 视觉
 *   - 后端 GET /api/pipeline/runs 已返回 config_summary（无需前端再 fetch /pipeline/<id>）
 *   - 复制配置：跳 Dashboard 预填 user_params（不复制 doc_ids，提示由 ConfigCard 顶部 banner 展示）
 *
 * 来源：
 *   - 沿用旧 RecentRuns 的 P2-1 多选对比 + X 删除 + 清空已完成
 *   - 顶部 "对比 (N)" 入口保留（featureFlag 守门）
 */
import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Activity, Loader2, RefreshCcw, Inbox, ChevronRight,
  Trash2, X, Check, AlertCircle, Pause, Copy, GitCompare, BarChart3,
  Sun, Moon, CalendarDays, Archive,
} from 'lucide-react'
import api from '../services/api'
import { APP_ROUTES, RECENT_RUNS } from '../i18n/zh'
import { formatErrorMessage } from '../lib/formatError'
import { flags } from '../lib/featureFlags'

interface ConfigSummary {
  years: number | null
  time_step: string | null
  departments: string[]
  departments_count: number
  external_factors_count: number
  report_style: string | null
  simulation_hours: number | null
}

interface Run {
  run_id: string
  status: string
  progress?: number
  completed_stages?: string[]
  current_stage?: string
  started_at?: number
  updated_at?: number
  config_summary?: ConfigSummary
  // 兼容老接口（无 config_summary 时退化用）
  config?: { report_style?: string; simulation_hours?: number; user_params?: any }
}

const STATUS_STYLES: Record<string, { dot: string; bar: string; bg: string; label: string; icon: any; color: string }> = {
  completed: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', label: '已完成', icon: Check, color: 'text-emerald-600' },
  running:   { dot: 'bg-blue-500 animate-pulse-soft', bar: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30', label: '运行中', icon: Activity, color: 'text-blue-600' },
  paused:    { dot: 'bg-amber-500', bar: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', label: '已暂停', icon: Pause, color: 'text-amber-600' },
  failed:    { dot: 'bg-rose-500', bar: 'bg-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/30', label: '失败', icon: AlertCircle, color: 'text-rose-600' },
  cancelled: { dot: 'bg-ink-400', bar: 'bg-ink-400', bg: 'bg-ink-50 dark:bg-ink-900/30', label: '已取消', icon: X, color: 'text-ink-500' },
}

const MAX_COMPARE = 3

/** 相对时间 - 用户一眼看出"5分钟前/2小时前/昨天" */
function formatRelative(ts?: number): string {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 2) return '昨天'
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function summarizeConfig(run: Run): string {
  // 优先用后端新返回的 config_summary
  if (run.config_summary) {
    const s = run.config_summary
    return RECENT_RUNS.configSummary(s.years, s.departments_count, s.external_factors_count)
  }
  // 退化：自己从 config.user_params / config 拼
  const up = run.config?.user_params
  const y = up?.years
  const depts = Array.isArray(up?.departments) ? up.departments.length : 0
  const ef = Array.isArray(up?.external_factors) ? up.external_factors.length : 0
  return RECENT_RUNS.configSummary(y, depts, ef)
}

/** 按日期分组 runs（按 updated_at 降序后归入 今天/昨天/本周/更早）*/
function groupRunsByDate(runs: Run[]): { key: string; label: string; icon: any; runs: Run[] }[] {
  // 1) 先按 updated_at 降序排序
  const sorted = [...runs].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))

  // 2) 按"今天/昨天/本周/更早"分桶
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  const yesterdayStart = todayStart - 86400
  const weekStart = todayStart - 86400 * 7

  const buckets: Record<string, { label: string; icon: any; runs: Run[] }> = {
    today:     { label: '今天',   icon: Sun,         runs: [] },
    yesterday: { label: '昨天',   icon: Moon,        runs: [] },
    week:      { label: '本周',   icon: CalendarDays, runs: [] },
    earlier:   { label: '更早',   icon: Archive,     runs: [] },
  }
  for (const r of sorted) {
    const t = r.updated_at || 0
    if (t >= todayStart) buckets.today.runs.push(r)
    else if (t >= yesterdayStart) buckets.yesterday.runs.push(r)
    else if (t >= weekStart) buckets.week.runs.push(r)
    else buckets.earlier.runs.push(r)
  }
  // 3) 过滤空桶 + 按顺序输出
  const order: Array<keyof typeof buckets> = ['today', 'yesterday', 'week', 'earlier']
  return order
    .filter((k) => buckets[k].runs.length > 0)
    .map((k) => ({ key: k, ...buckets[k] }))
}

export default function RecentRuns() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)  // 默认展开，避免用户感知"栏目消失"
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  // PR-3 P2-1：多选 + 对比入口
  const [selected, setSelected] = useState<string[]>([])

  const compareEnabled = flags.compareRuns

  // P3 PERSIST：复制此 run 的配置（user_params + hours + style），doc_ids 留空
  const cloneConfig = (runId: string) => {
    navigate(`/?cloneConfig=${encodeURIComponent(runId)}`)
  }

  // PR-3 P2-1：切换 checkbox 选中（最多 3 个）
  const toggleSelect = (runId: string) => {
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((x) => x !== runId)
      if (prev.length >= MAX_COMPARE) return prev  // 满了忽略
      return [...prev, runId]
    })
  }

  // PR-3 P2-1：跳到对比页（带 run id 列表）
  const goCompare = () => {
    if (selected.length < 2) return
    navigate(APP_ROUTES.compareWithRuns(selected))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/pipeline/runs')
      const list: Run[] = (r.data.runs || []) as Run[]
      setRuns(list)
      // 清理已不存在的选中项
      setSelected((prev) => prev.filter((id) => list.some((x) => x.run_id === id)))
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
    setSelected((prev) => prev.filter((id) => id !== runId))
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
    setSelected((prev) => prev.filter((id) => !completed.some((r) => r.run_id === id)))
    for (const r of completed) {
      try {
        await api.delete(`/pipeline/${r.run_id}`)
      } catch (e) { /* 忽略 */ }
    }
  }

  // 统计
  const completedCount = runs.filter((r) => r.status === 'completed').length
  const runningCount = runs.filter((r) => r.status === 'running').length
  const canCompare = compareEnabled && selected.length >= 2 && selected.length <= MAX_COMPARE

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
          <span className="text-[13px] uppercase tracking-wider text-ink-800 dark:text-ink-100 font-bold">
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
          {compareEnabled && selected.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-semibold flex items-center gap-0.5">
              <BarChart3 size={8} />
              {RECENT_RUNS.compareSelected(selected.length)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {compareEnabled && (
            <button
              onClick={goCompare}
              disabled={!canCompare}
              className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors
                ${canCompare
                  ? 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 cursor-pointer'
                  : 'text-ink-400 bg-ink-50 dark:bg-ink-900/30 cursor-not-allowed'}`}
              title={canCompare
                ? RECENT_RUNS.compareTitle
                : selected.length < 2 ? RECENT_RUNS.compareSelectHint : ''}
            >
              <GitCompare size={10} />
              {RECENT_RUNS.compare}
              {selected.length > 0 && ` (${selected.length})`}
            </button>
          )}
          {!compareEnabled && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded text-ink-400 cursor-not-allowed flex items-center gap-0.5"
              title={RECENT_RUNS.compareDisabledTitle}
            >
              <GitCompare size={10} />
              {RECENT_RUNS.compare}
            </span>
          )}
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
            <div className="max-h-[28rem] overflow-y-auto">
              {loading && runs.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-ink-400">
                  <Loader2 size={12} className="animate-spin" /> {RECENT_RUNS.loadingTitle}
                </div>
              ) : error ? (
                <div className="px-3 py-2 text-xs text-rose-500">{error}</div>
              ) : runs.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-ink-400 flex flex-col items-center gap-1.5">
                  <Inbox size={20} className="opacity-50" />
                  暂无运行
                  <div className="text-[10px]">{RECENT_RUNS.emptyHint}</div>
                </div>
              ) : (
                <div className="px-3 py-3 space-y-4">
                  <AnimatePresence initial={false}>
                    {groupRunsByDate(runs).map((group) => (
                      <div key={group.key}>
                        {/* 分组标题：今天 / 昨天 / 本周 / 更早 + 数量 */}
                        <div className="flex items-center gap-2 mb-2 px-0.5">
                          <div className="flex items-center gap-1.5">
                            <group.icon size={13} className="text-ink-500" />
                            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-200 uppercase tracking-wider">
                              {group.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-ink-400 font-mono">
                            {group.runs.length} 次
                          </span>
                          <div className="flex-1 h-px bg-ink-200/40 dark:bg-ink-800/40" />
                        </div>
                        {/* 该组卡片网格 */}
                        <ul className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
                          {group.runs.map((r) => {
                      const s = STATUS_STYLES[r.status] || STATUS_STYLES.cancelled
                      const isConfirming = deleteConfirm === r.run_id
                      const isSelected = selected.includes(r.run_id)
                      const selectable = compareEnabled && (r.status === 'completed')
                      const checkboxDisabled = !selectable || (!isSelected && selected.length >= MAX_COMPARE)
                      const summary = summarizeConfig(r)
                      const relTime = formatRelative(r.updated_at)

                      return (
                        <motion.li
                          key={r.run_id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -10, scale: 0.95 }}
                          transition={{ duration: 0.18 }}
                          className={`group relative flex items-stretch gap-2 rounded-lg border px-2.5 py-2
                                      ${isSelected
                                        ? 'border-brand-400/70 bg-brand-50/40 dark:bg-brand-950/20'
                                        : 'border-ink-200/40 dark:border-ink-800/40 bg-white/30 dark:bg-ink-900/20'}
                                      hover:border-brand-300/70 hover:bg-white/60 dark:hover:bg-ink-900/40
                                      transition-all`}
                        >
                          {/* checkbox (对比模式) */}
                          {compareEnabled && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={checkboxDisabled}
                              onChange={() => toggleSelect(r.run_id)}
                              title={selectable
                                ? (isSelected ? '取消选中' : '加入对比')
                                : (selected.length >= MAX_COMPARE ? `最多 ${MAX_COMPARE} 个` : '仅已完成 run 可对比')}
                              className="w-4 h-4 mt-2 shrink-0 cursor-pointer
                                         disabled:cursor-not-allowed disabled:opacity-40
                                         accent-brand-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}

                          {/* 主信息 - 状态徽章 + 摘要 + 相对时间 一行搞定 */}
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.bg} ${s.color}`}>
                              {s.label}
                            </span>
                            <span
                              className="text-[12px] text-ink-700 dark:text-ink-200 truncate min-w-0 flex-1"
                              title={summary}
                            >
                              {summary}
                            </span>
                            <span className="text-[10px] text-ink-400 shrink-0 font-medium tabular-nums">
                              {relTime}
                            </span>
                          </div>

                          {/* 操作区: 报告 + 复制 + 删除 */}
                          <div className="flex items-stretch shrink-0">
                            <Link
                              to={APP_ROUTES.report(r.run_id)}
                              className="inline-flex items-center justify-center
                                         w-7 h-7 my-auto rounded-l-md border-r border-ink-200/40
                                         text-brand-600 dark:text-brand-400
                                         hover:bg-brand-50 dark:hover:bg-brand-950/30
                                         transition-colors"
                              title={RECENT_RUNS.viewReportTitle}
                            >
                              <FileText size={12} />
                            </Link>
                            <button
                              onClick={() => cloneConfig(r.run_id)}
                              className="inline-flex items-center justify-center
                                         w-7 h-7 my-auto border-r border-ink-200/40
                                         text-ink-600 dark:text-ink-300
                                         hover:bg-ink-50 dark:hover:bg-ink-800/60
                                         transition-colors"
                              title={RECENT_RUNS.copyConfigTitle(r.run_id)}
                            >
                              <Copy size={12} />
                            </button>
                            {isConfirming ? (
                              <button
                                onClick={() => deleteRun(r.run_id)}
                                className="inline-flex items-center justify-center
                                           w-7 h-7 my-auto rounded-r-md
                                           text-rose-600 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100
                                           transition-colors"
                                title="确认删除"
                              >
                                <Check size={12} />
                              </button>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(r.run_id)}
                                className="inline-flex items-center justify-center
                                           w-7 h-7 my-auto rounded-r-md
                                           text-ink-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20
                                           transition-colors"
                                title="删除"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </motion.li>
                      )
                    })}
                        </ul>
                      </div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
