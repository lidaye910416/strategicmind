/**
 * EntityDanmaku — 实体涌现弹幕（右下角浮窗）
 *
 * 数据源: store.graphNodes 派生 (对比上一次的 node id 集合, 取出新出现的节点)。
 *  - SSE `entity_emerged` 事件触发 appendGraphNode → store.graphNodes 增量
 *  - 该组件订阅 graphNodes, 计算 diff 并以浮窗弹幕方式呈现
 *  - 每条弹幕存在 3s 后淡出
 *
 * 行为约定:
 *  - graphNodes.length === 0 或无新增 → 不渲染 (零侵入)
 *  - 新增节点以"流式卡片"方式堆叠在右下角
 *  - 最多保留 MAX_VISIBLE (5) 张卡片, 超出后顶部最早一张被踢出
 *  - 同一 (id) 在 ANIMATION_LOCK_MS (250ms) 内不会重复出现 (节流)
 *
 * Implements: should-tier v3 / item #1 (entity_emerged 实时弹幕)
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { useGraphNodes } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'
import type { GraphNodeData } from '../store/pipeline'

const DANMAKU_LIFETIME_MS = 3000  // 3s 后淡出
const MAX_VISIBLE = 5             // 最多同时显示 5 张
const ANIMATION_LOCK_MS = 250     // 同 id 节流窗口

interface DanmakuItem {
  id: string
  label: string
  type: string
  ts: number
  /** 该条加入时的 store 节点总数 (用于显示 "已 X 节点") */
  totalCount: number
  /** 实体涌现轮次 (来自 GraphNodeData.emerged_round / round) */
  emergedRound?: number
}

const TYPE_COLOR: Record<string, string> = {
  COMPANY: 'from-blue-500/90 to-blue-600/90',
  PERSON: 'from-pink-500/90 to-pink-600/90',
  PRODUCT: 'from-violet-500/90 to-violet-600/90',
  BUSINESS: 'from-amber-500/90 to-amber-600/90',
  GOVERNMENT: 'from-red-500/90 to-red-600/90',
  REGULATION: 'from-slate-500/90 to-slate-600/90',
  TECH: 'from-cyan-500/90 to-cyan-600/90',
  CAPITAL: 'from-emerald-500/90 to-emerald-600/90',
  DEFAULT: 'from-ink-500/90 to-ink-600/90',
}

function pickColor(type: string): string {
  return TYPE_COLOR[type] ?? TYPE_COLOR.DEFAULT
}

function pickLabel(node: GraphNodeData): string {
  return String(node.label ?? node.name ?? node.id ?? '未知实体').slice(0, 24)
}

export default function EntityDanmaku() {
  const graphNodes = useGraphNodes()
  const [items, setItems] = useState<DanmakuItem[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const lastAddedRef = useRef<Record<string, number>>({})

  // 派生: 与上次 graphNodes 集合对比, 找出新增 id
  useEffect(() => {
    if (!graphNodes || graphNodes.length === 0) return
    const seen = seenRef.current
    const last = lastAddedRef.current
    const now = Date.now()
    const newcomers: DanmakuItem[] = []
    for (const n of graphNodes) {
      const id = String(n.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      // 节流: 同 id 在 250ms 内不重复
      const lastTs = last[id] ?? 0
      if (now - lastTs < ANIMATION_LOCK_MS) continue
      last[id] = now
      newcomers.push({
        id,
        label: pickLabel(n),
        type: String(n.type ?? 'DEFAULT'),
        ts: now,
        totalCount: graphNodes.length,
        emergedRound: (n as any).emerged_round ?? (n as any).round,
      })
    }
    if (newcomers.length === 0) return
    setItems((prev) => {
      // 倒序: 最新追加到最上 (UI 视觉)
      const next = [...newcomers.reverse(), ...prev].slice(0, MAX_VISIBLE)
      return next
    })
  }, [graphNodes])

  // 3s 后自动淡出 (基于 ts)
  useEffect(() => {
    if (items.length === 0) return
    const timers: number[] = []
    for (const it of items) {
      const elapsed = Date.now() - it.ts
      const remain = DANMAKU_LIFETIME_MS - elapsed
      if (remain <= 0) {
        setItems((prev) => prev.filter((p) => p.id !== it.id))
        continue
      }
      const t = window.setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== it.id))
      }, remain)
      timers.push(t)
    }
    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
  }, [items])

  // 切 run 时清空 (graphNodes 重置为 [])
  useEffect(() => {
    if (graphNodes.length === 0) {
      setItems([])
      seenRef.current = new Set()
      lastAddedRef.current = {}
    }
  }, [graphNodes.length])

  const dismiss = (id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id))
  }

  if (items.length === 0) return null

  return (
    <div
      data-testid="entity-danmaku"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 flex flex-col-reverse gap-2 max-w-[320px] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div
            key={`danmaku-${it.id}-${it.ts}`}
            data-testid="entity-danmaku-item"
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className={`pointer-events-auto relative overflow-hidden rounded-xl
                        bg-gradient-to-br ${pickColor(it.type)} text-white
                        shadow-lg shadow-black/10 px-3 py-2 pr-7`}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="shrink-0" />
              <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                {WORKBENCH.entityDanmakuTitle}
              </div>
              <button
                data-testid="entity-danmaku-dismiss"
                onClick={() => dismiss(it.id)}
                aria-label="关闭"
                className="absolute top-1 right-1 p-0.5 rounded hover:bg-white/20 transition"
              >
                <X size={10} />
              </button>
              {/* 涌现轮次 badge (右上角) — 用户立即看到 entity 在哪一轮出现 */}
              <span
                data-testid="entity-round-badge"
                className="absolute top-1 right-7 text-[9px] px-1.5 py-0.5 rounded bg-white/30 text-white font-mono"
              >
                📍 R{it.emergedRound ?? '?'}
              </span>
            </div>
            <div className="mt-0.5 text-sm font-semibold leading-tight truncate">
              {it.label}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] opacity-90">
              <span className="px-1.5 py-0.5 rounded bg-white/20 font-mono">
                {it.type}
              </span>
              <span>· 已 {it.totalCount} 节点</span>
            </div>
            {/* 进度条: 3s 倒计时 */}
            <motion.div
              className="absolute bottom-0 left-0 h-0.5 bg-white/60"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: DANMAKU_LIFETIME_MS / 1000, ease: 'linear' }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
