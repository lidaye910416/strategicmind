/**
 * Report 视图右侧 sticky 目录（TOC） — PR-2 P1-6。
 *
 * 设计来源：C3 §2.4 / D-11；C4 PR-2 P1-6。
 *
 * 行为：
 *   - 解析 props.content 中的 markdown `## 标题`（h2），自动生成目录
 *   - 桌面端（lg 及以上）：右侧 sticky 侧栏 + scroll-spy
 *   - 移动端（< lg）：折叠为 dropdown <select>，change 后平滑滚动
 *   - 高亮"战略建议"等关键章节（参考 props.highlightKeywords）
 *
 * 与 Report.tsx 的契合：
 *   - 解析出的 heading 会在 Report.tsx 渲染 markdown 时通过 `id` slug 锚定
 *     （Report 端用 `react-markdown` 的 components.h2 注入相同 slug）
 *   - 这里只负责 TOC 视图，不接管 markdown 渲染
 *
 * 约束：
 *   - 单文件 < 400 行
 *   - 不引入新依赖（用浏览器 IntersectionObserver / 原生 select）
 *   - i18n 文案已落 REPORT_TOC（D5 集成时补齐）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ListTree } from 'lucide-react'
import { REPORT_TOC } from '../i18n/zh'

export interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

interface Props {
  /** Markdown 原文 */
  content: string
  /**
   * 命中后高亮的关键词（在 heading 中包含即视为重点章节）。
   * 默认包含"战略建议 / 建议"。
   */
  highlightKeywords?: string[]
  /** sticky 时距视口顶端的偏移（px），默认 96 */
  topOffset?: number
  /** 滚动到锚点时的额外偏移（防被遮挡），默认 96 */
  scrollOffset?: number
}

/**
 * 把任意中英文 heading 转成稳定 slug：
 *   - 中文 → 保留原文；英文/数字 → 小写
 *   - 非字母数字中文 → 替换为 '-'
 *   - 前缀加 `report-` 避免和页面其他 id 冲突
 */
export function slugify(text: string): string {
  const cleaned = text
    .trim()
    .replace(/\s+/g, '-')
    // 仅保留中英文、数字、连字符、下划线
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .toLowerCase()
  return `report-${cleaned || 'section'}`
}

/**
 * 从 markdown 文本中解析出 ## / ### heading（仅 h2 + h3，避免噪声）。
 * 跳过代码块内的 # 行。
 */
export function parseHeadings(md: string): TocItem[] {
  const items: TocItem[] = []
  const seen = new Map<string, number>()
  let inCode = false
  const lines = md.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = /^(#{2,3})\s+(.+)$/.exec(line)
    if (!m) continue
    const level = (m[1].length === 2 ? 2 : 3) as 2 | 3
    const text = m[2].replace(/[#*_`]+/g, '').trim()
    if (!text) continue
    let id = slugify(text)
    // 防止重复 id（同名章节）
    const n = (seen.get(id) || 0) + 1
    seen.set(id, n)
    if (n > 1) id = `${id}-${n}`
    items.push({ id, text, level })
  }
  return items
}

const DEFAULT_KEYWORDS = ['战略建议', '建议', '行动清单']

export default function ReportTOC({
  content,
  highlightKeywords = DEFAULT_KEYWORDS,
  topOffset = 96,
  scrollOffset = 96,
}: Props) {
  const items = useMemo(() => parseHeadings(content), [content])
  const [activeId, setActiveId] = useState<string | null>(null)
  const lockRef = useRef<{ until: number } | null>(null)

  // scroll-spy
  useEffect(() => {
    if (items.length === 0) return
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter(Boolean) as HTMLElement[]
    if (els.length === 0) return

    const obs = new IntersectionObserver(
      (entries) => {
        const lock = lockRef.current
        if (lock && Date.now() < lock.until) return
        const inView = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({ id: e.target.id, top: e.boundingClientRect.top }))
          .sort((a, b) => a.top - b.top)
        if (inView[0]) setActiveId(inView[0].id)
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [items])

  const goTo = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset
    setActiveId(id)
    lockRef.current = { until: Date.now() + 700 }
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const isHighlight = (text: string) =>
    highlightKeywords.some((kw) => text.includes(kw))

  if (items.length === 0) {
    return null
  }

  return (
    <>
      {/* 移动端：dropdown */}
      <div className="lg:hidden mb-3">
        <label className="sr-only" htmlFor="report-toc-select">
          {REPORT_TOC.title}
        </label>
        <div className="flex items-center gap-2">
          <ListTree size={14} className="text-ink-400" />
          <select
            id="report-toc-select"
            value={activeId || ''}
            onChange={(e) => goTo(e.target.value)}
            className="input flex-1 text-xs h-9"
          >
            <option value="" disabled>
              {REPORT_TOC.dropdownPlaceholder}
            </option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.level === 3 ? '　' : ''}
                {i.text}
                {isHighlight(i.text) ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 桌面端：sticky 侧栏 */}
      <aside
        className="hidden lg:block"
        style={{ position: 'sticky', top: `${topOffset}px` }}
        aria-label="报告目录"
      >
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ListTree size={14} className="text-ink-400" />
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-bold">
              {REPORT_TOC.title}
            </div>
          </div>
          <ul className="space-y-1 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
            {items.map((i) => {
              const isActive = activeId === i.id
              const hi = isHighlight(i.text)
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => goTo(i.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={clsx(
                      'block w-full text-left px-2 py-1 rounded-md text-xs transition-colors',
                      'truncate',
                      i.level === 3 && 'pl-5 text-[11px]',
                      isActive
                        ? hi
                          ? 'bg-brand-700 text-white font-semibold'
                          : 'bg-brand-500 text-white font-semibold'
                        : hi
                          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 font-medium hover:bg-amber-100'
                          : 'text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800',
                    )}
                    title={i.text}
                  >
                    {hi ? '★ ' : ''}
                    {i.text}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>
    </>
  )
}
