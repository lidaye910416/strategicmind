/**
 * 图谱轮次 Diff 对比 (GraphDiff)
 *
 * 用途：让用户对比"第 N 轮 vs 第 M 轮"的图谱差异 (新增节点/边/改动)。
 *
 * 数据源：
 *   - store.graphSnapshots[round] → { nodes, edges } (由 appendSimRound 同步写入)
 *   - 用 left/right round 快照做集合差
 *
 * 空态：simRounds.length < 2 时显示"完成至少 2 轮推演后查看图谱变化"
 *
 * Implements: Workbench "图谱轮次 diff" feature2 (feature/history-graph-and-viz)
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { GitCompare, Network, Plus, Minus, Edit3 } from 'lucide-react'
import { useSimRounds, useGraphSnapshots } from '../../store/pipeline'
import { WORKBENCH } from '../../i18n/zh'

interface DiffSummary {
  addedNodes: number
  addedEdges: number
  removedNodes: number
  removedEdges: number
  modifiedNodes: number
}

function diffSnapshots(
  prev: { nodes: any[]; edges: any[] } | undefined,
  cur: { nodes: any[]; edges: any[] } | undefined,
): DiffSummary {
  if (!prev || !cur) {
    return { addedNodes: 0, addedEdges: 0, removedNodes: 0, removedEdges: 0, modifiedNodes: 0 }
  }
  const prevIds = new Set(prev.nodes.map((n) => String(n.id)))
  const curIds = new Set(cur.nodes.map((n) => String(n.id)))
  const prevEids = new Set(prev.edges.map((e) => String(e.id ?? `${e.source}->${e.target}`)))
  const curEids = new Set(cur.edges.map((e) => String(e.id ?? `${e.source}->${e.target}`)))

  let added = 0, removed = 0, modified = 0
  // 新增
  for (const id of curIds) if (!prevIds.has(id)) added++
  // 删除
  for (const id of prevIds) if (!curIds.has(id)) removed++
  // 改动（存在但属性变化）
  for (const n of cur.nodes) {
    const pid = String(n.id)
    if (prevIds.has(pid)) {
      const pn = prev.nodes.find((p) => String(p.id) === pid)
      if (pn && JSON.stringify({ l: pn.label ?? pn.name, t: pn.type ?? pn.entity_type }) !==
                JSON.stringify({ l: n.label ?? n.name, t: n.type ?? n.entity_type })) {
        modified++
      }
    }
  }
  let addedE = 0, removedE = 0
  for (const id of curEids) if (!prevEids.has(id)) addedE++
  for (const id of prevEids) if (!curEids.has(id)) removedE++

  return {
    addedNodes: added,
    removedNodes: removed,
    modifiedNodes: modified,
    addedEdges: addedE,
    removedEdges: removedE,
  }
}

function miniGraphData(
  snap: { nodes: any[]; edges: any[] } | undefined,
  prev: { nodes: any[]; edges: any[] } | undefined,
  direction: 'left' | 'right',
) {
  if (!snap) return { nodes: [] as any[], edges: [] as any[] }
  const prevIds = new Set((prev?.nodes ?? []).map((n) => String(n.id)))
  return {
    nodes: snap.nodes.map((n) => ({
      id: String(n.id),
      label: n.label ?? n.name ?? String(n.id),
      type: n.type ?? n.entity_type ?? 'RELATED_TO',
      // 标记新增/删除 — left 显示 prev 有但 right 没有的 (淡红), right 显示新加的 (亮琥珀)
      ...(direction === 'right' && !prevIds.has(String(n.id))
        ? { isNew: true }
        : direction === 'left' && !prevIds.has(String(n.id))
          ? { isRemoved: true }
          : {}),
    })),
    edges: snap.edges.map((e) => ({
      source: String(e.source),
      target: String(e.target),
      type: e.type ?? (e as any).relation ?? 'RELATED_TO',
    })),
  }
}

export default function GraphRoundDiff() {
  const simRounds = useSimRounds()
  const snapshots = useGraphSnapshots()

  // 可用 round 列表（按升序）
  const availableRounds = useMemo(
    () => simRounds.map((r) => r.round).sort((a, b) => a - b),
    [simRounds],
  )

  // 默认 left = 最早, right = 最新
  const [leftRound, setLeftRound] = useState<number | null>(null)
  const [rightRound, setRightRound] = useState<number | null>(null)

  // 初始化默认值（仅在 availableRounds 变化时）
  useMemo(() => {
    if (availableRounds.length >= 2 && (leftRound == null || rightRound == null)) {
      // 注意: 不能在 useMemo 里 setState, 这里仅作占位
    }
  }, [availableRounds, leftRound, rightRound])

  // 派生: 实际使用的 round
  const lr = leftRound ?? availableRounds[0] ?? null
  const rr = rightRound ?? availableRounds[availableRounds.length - 1] ?? null
  // 不允许 X === Y
  const effectiveLr = lr === rr && availableRounds.length >= 2
    ? (availableRounds[availableRounds.length - 2] ?? lr)
    : lr

  const leftSnap = lr != null ? snapshots[lr] : undefined
  const rightSnap = rr != null ? snapshots[rr] : undefined

  const diff = useMemo(
    () => diffSnapshots(snapshots[effectiveLr!], snapshots[rr!]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveLr, rr, snapshots],
  )

  const leftGraph = useMemo(
    () => miniGraphData(leftSnap, rightSnap, 'left'),
    [leftSnap, rightSnap],
  )
  const rightGraph = useMemo(
    () => miniGraphData(rightSnap, leftSnap, 'right'),
    [rightSnap, leftSnap],
  )

  // ---- 空态: simRounds < 2 ----
  if (simRounds.length < 2) {
    return (
      <section data-testid="graph-diff" className="card p-5 scroll-mt-28">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
            <GitCompare size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {WORKBENCH.graphDiffTitle}
            </div>
            <div className="text-sm font-semibold text-ink-900 dark:text-white">
              {WORKBENCH.graphDiffEmpty}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="graph-diff" className="card p-5 scroll-mt-28">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
          <GitCompare size={16} />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
            {WORKBENCH.graphDiffTitle}
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white">
            {WORKBENCH.graphDiffTitle}
          </div>
        </div>
        {/* 左右 select */}
        <select
          data-testid="graph-diff-left-select"
          value={effectiveLr ?? ''}
          onChange={(e) => setLeftRound(Number(e.target.value))}
          className="input h-8 text-[11px] px-2"
        >
          {availableRounds.map((r) => (
            <option key={r} value={r}>{WORKBENCH.graphDiffLeft} R{r}</option>
          ))}
        </select>
        <span className="text-ink-400 text-xs">→</span>
        <select
          data-testid="graph-diff-right-select"
          value={rr ?? ''}
          onChange={(e) => setRightRound(Number(e.target.value))}
          className="input h-8 text-[11px] px-2"
        >
          {availableRounds.map((r) => (
            <option key={r} value={r}>{WORKBENCH.graphDiffRight} R{r}</option>
          ))}
        </select>
      </div>

      {/* 双栏对比 (mini graph — 用 svg 自绘) */}
      <div className="grid grid-cols-2 gap-2 mb-3" style={{ height: 220 }}>
        <DiffPane title={`R${effectiveLr}`} graph={leftGraph} side="left" />
        <DiffPane title={`R${rr}`} graph={rightGraph} side="right" />
      </div>

      {/* 底部 sticky diff 摘要条 */}
      <div
        data-testid="graph-diff-summary"
        className="text-[10px] font-mono flex items-center gap-3 px-3 py-2 rounded-md bg-ink-50/60 dark:bg-ink-900/40 border border-ink-200/40 dark:border-ink-800/40"
      >
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <Plus size={11} /> {diff.addedNodes} 节点
        </span>
        <span className="inline-flex items-center gap-1 text-rose-500">
          <Minus size={11} /> {diff.removedNodes} 节点
        </span>
        <span className="inline-flex items-center gap-1 text-amber-600">
          <Edit3 size={11} /> {diff.modifiedNodes} 改动
        </span>
        <span className="inline-flex items-center gap-1 text-brand-600">
          <Network size={11} /> +{diff.addedEdges} 关系
        </span>
        <span className="ml-auto text-ink-400">
          {WORKBENCH.graphDiffSummary(rr ?? 0, effectiveLr ?? 0, diff.addedNodes, diff.addedEdges)}
        </span>
      </div>
    </section>
  )
}

/** Mini DiffPane: 自绘简化版 (复用项目内 style 约定) */
function DiffPane({ title, graph, side }: { title: string; graph: { nodes: any[]; edges: any[] }; side: 'left' | 'right' }) {
  return (
    <div
      data-testid={`graph-diff-pane-${side}`}
      className="relative rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-white/40 dark:bg-ink-900/40 overflow-hidden"
    >
      <div className="absolute top-1 left-2 text-[9px] font-mono font-bold text-ink-400 z-10">{title}</div>
      <div className="absolute top-1 right-2 text-[9px] font-mono text-ink-400 z-10">{graph.nodes.length}N / {graph.edges.length}E</div>
      <svg viewBox="0 0 200 200" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* edges */}
        {graph.edges.map((e, i) => {
          const sn = graph.nodes.find((n) => n.id === String(e.source))
          const tn = graph.nodes.find((n) => n.id === String(e.target))
          if (!sn || !tn) return null
          // 简单环形布局
          const n = graph.nodes.length
          const idxS = graph.nodes.indexOf(sn)
          const idxT = graph.nodes.indexOf(tn)
          const ax = 100 + Math.cos((idxS / n) * Math.PI * 2 - Math.PI / 2) * 60
          const ay = 100 + Math.sin((idxS / n) * Math.PI * 2 - Math.PI / 2) * 60
          const bx = 100 + Math.cos((idxT / n) * Math.PI * 2 - Math.PI / 2) * 60
          const by = 100 + Math.sin((idxT / n) * Math.PI * 2 - Math.PI / 2) * 60
          return (
            <line
              key={i}
              x1={ax} y1={ay} x2={bx} y2={by}
              stroke="#94a3b8" strokeWidth={1} strokeOpacity={0.5}
            />
          )
        })}
        {/* nodes */}
        {graph.nodes.map((n, i) => {
          const total = graph.nodes.length
          const angle = (i / total) * Math.PI * 2 - Math.PI / 2
          const x = 100 + Math.cos(angle) * 60
          const y = 100 + Math.sin(angle) * 60
          const isNew = (n as any).isNew
          const isRemoved = (n as any).isRemoved
          return (
            <g key={n.id}>
              <motion.circle
                cx={x} cy={y}
                r={isNew ? 7 : 5}
                fill={isNew ? '#f59e0b' : isRemoved ? '#f43f5e' : '#64748b'}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.3 }}
              />
              {isNew && (
                <motion.circle
                  cx={x} cy={y} r={10}
                  fill="none" stroke="#f59e0b" strokeWidth={1.5}
                  initial={{ opacity: 0.8, r: 7 }}
                  animate={{ opacity: 0, r: 14 }}
                  transition={{ duration: 1.5, repeat: 1 }}
                />
              )}
              <text x={x} y={y + 12} fontSize={6} textAnchor="middle" fill="#64748b">
                {n.label.slice(0, 4)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
