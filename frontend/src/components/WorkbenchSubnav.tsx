/**
 * Workbench 顶部 sticky 子导航 — 4 锚点 + scroll-spy + 实时心跳。
 *
 * 设计来源：C3 设计 §2-3 D-08/D-14；C4 PR-2 P1-1。
 *
 * 4 个锚点（与 Workbench 主体的 <section id> 一一对应）：
 *   - graph      实时图谱
 *   - dept       部门博弈
 *   - rel        关系网
 *   - interview  智能体采访
 *
 * scroll-spy 实现：
 *   - IntersectionObserver，rootMargin '-30% 0px -60% 0px'
 *     → 锚点 section 进入视口中部 1 秒内高亮
 *
 * 实时心跳：
 *   - 订阅 store.lastEventAt（来自 PR-1 P0-2 / atomic selector）
 *   - 计算 elapsed 秒：< 10s 绿色、10-30s 橙色、> 30s 红色
 *   - 1s tick 平滑刷新
 *
 * 约束：
 *   - 单文件 < 400 行
 *   - 复用 lastEventAt selector（不引入新 store 字段）
 *   - 不引入新依赖
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Activity, GitBranch, Users, MessageCircle } from 'lucide-react'
import { useLastEventAt } from '../store/pipeline'
import { WORKBENCH_SUBNAV } from '../i18n/zh'

/** 子导航锚点定义；id 必须与 Workbench 中 <section id="..."> 对齐。 */
export const SUBNAV_ANCHORS = [
  { id: 'graph', label: '实时图谱', icon: GitBranch },
  { id: 'dept', label: '部门博弈', icon: Activity },
  { id: 'rel', label: '关系网', icon: Users },
  { id: 'interview', label: '智能体采访', icon: MessageCircle },
] as const

export type AnchorId = (typeof SUBNAV_ANCHORS)[number]['id']

interface Props {
  /** 顶部偏移，sticky 时距离视口顶端的距离（px），默认 0 */
  topOffset?: number
  /** 滚动锚定的额外偏移（防止被 sticky bar 遮挡），默认 96 */
  scrollOffset?: number
}

/**
 * 心跳指示：根据 lastEventAt 显示"实时 · X 秒前"。
 * < 10s 绿色、10-30s 橙色、> 30s 红色。
 * 如果 lastEventAt 为 0（未启动），显示"未连接"。
 */
function HeartbeatBadge() {
  const lastEventAt = useLastEventAt()
  const [now, setNow] = useState(() => Date.now())

  // 1s tick 让"X 秒前"实时刷新
  useEffect(() => {
    if (!lastEventAt) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lastEventAt])

  if (!lastEventAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-400">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300" />
        {WORKBENCH_SUBNAV.notConnected}
      </span>
    )
  }

  const elapsedSec = Math.max(0, Math.round((now - lastEventAt) / 1000))
  const tone: 'green' | 'orange' | 'red' =
    elapsedSec < 10 ? 'green' : elapsedSec < 30 ? 'orange' : 'red'

  const toneCls = {
    green: 'text-emerald-600 dark:text-emerald-300',
    orange: 'text-amber-600 dark:text-amber-300',
    red: 'text-rose-600 dark:text-rose-300',
  }[tone]
  const dotCls = {
    green: 'bg-emerald-500 animate-pulse',
    orange: 'bg-amber-500',
    red: 'bg-rose-500',
  }[tone]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums',
        toneCls,
      )}
      title={`上次事件时间：${new Date(lastEventAt).toLocaleTimeString()}`}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', dotCls)} />
      {WORKBENCH_SUBNAV.heartbeat} · {WORKBENCH_SUBNAV.heartbeatSecondsAgo(elapsedSec)}
    </span>
  )
}

export default function WorkbenchSubnav({
  topOffset = 0,
  scrollOffset = 96,
}: Props) {
  // 当前 scroll-spy 命中的 anchorId
  const [activeId, setActiveId] = useState<AnchorId | null>(null)
  // 防止 click → smooth scroll 过程中 observer 抖动覆盖
  const lockRef = useRef<{ id: AnchorId; until: number } | null>(null)

  // ---- scroll-spy（IntersectionObserver）----
  useEffect(() => {
    const els = SUBNAV_ANCHORS
      .map((a) => document.getElementById(a.id))
      .filter(Boolean) as HTMLElement[]
    if (els.length === 0) return

    // rootMargin '-30% 0px -60% 0px' → 元素中部进入 → 触发
    const obs = new IntersectionObserver(
      (entries) => {
        // 锁定窗口期内忽略 observer（避免 click → smooth-scroll 期间被覆盖）
        const lock = lockRef.current
        if (lock && Date.now() < lock.until) return

        // 找到所有 intersecting 中最靠上的那个（保证只高亮一个）
        const inView = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({ id: e.target.id as AnchorId, top: e.boundingClientRect.top }))
          .sort((a, b) => a.top - b.top)
        if (inView[0]) setActiveId(inView[0].id)
      },
      {
        rootMargin: '-30% 0px -60% 0px',
        threshold: 0,
      },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // ---- click 平滑滚动 ----
  const handleClick = (id: AnchorId) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset
    // 立即高亮 + 锁定 700ms 防止 observer 反复触发
    setActiveId(id)
    lockRef.current = { id, until: Date.now() + 700 }
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const stickyStyle = useMemo(
    () => ({ top: `${topOffset}px` }),
    [topOffset],
  )

  return (
    <nav
      style={stickyStyle}
      className={clsx(
        'sticky z-30',
        'glass-strong border-b border-ink-200/50 dark:border-ink-800/50',
        'px-3 md:px-6 py-2 rounded-xl',
        'flex items-center gap-1 md:gap-2 flex-wrap',
      )}
      aria-label="工作台子导航"
    >
      <ul className="flex items-center gap-1 md:gap-2 flex-1 min-w-0 overflow-x-auto">
        {SUBNAV_ANCHORS.map((a) => {
          const isActive = activeId === a.id
          const Icon = a.icon
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => handleClick(a.id)}
                aria-current={isActive ? 'true' : undefined}
                className={clsx(
                  'inline-flex items-center gap-1.5',
                  'h-8 px-3 rounded-lg text-xs font-medium',
                  'transition-colors duration-150',
                  'whitespace-nowrap',
                  isActive
                    ? 'bg-brand-500 text-white shadow-soft'
                    : 'text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800',
                )}
              >
                <Icon size={12} />
                {a.label}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="shrink-0 pl-2 border-l border-ink-200/50 dark:border-ink-800/50">
        <HeartbeatBadge />
      </div>
    </nav>
  )
}
