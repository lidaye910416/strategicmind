/**
 * RoundTimelineStrip - 顶部 round 时间轴 (MiroFish-style).
 *
 * 显示 N 个 round pill, 当前 round 高亮 + animate-pulse.
 * 每个 pill 含 R{n} / simulated label / +nodes / +edges 徽章.
 */
import clsx from 'clsx'

export interface RoundDeltas {
  [round: number]: { nodes: number; edges: number }
}

export interface RoundTimelineStripProps {
  totalRounds: number
  currentRound: number
  deltas: RoundDeltas
  simulatedLabels: string[]
}

export function RoundTimelineStrip({
  totalRounds,
  currentRound,
  deltas,
  simulatedLabels,
}: RoundTimelineStripProps) {
  return (
    <div
      data-testid="round-timeline-strip"
      className="flex gap-1 overflow-x-auto py-2 px-4 bg-ink-900 border-b border-ink-700"
    >
      {Array.from({ length: totalRounds }).map((_, i) => {
        const n = i + 1
        const isCurrent = n === currentRound
        const isPast = n < currentRound
        const delta = deltas[n]
        return (
          <div
            key={n}
            data-testid={`round-pill-${n}`}
            className={clsx(
              'flex flex-col items-center min-w-[64px] px-2 py-1 rounded-md border text-xs',
              isCurrent && 'bg-brand-500/20 border-brand-500 animate-pulse',
              isPast && 'bg-ink-800 border-ink-700 opacity-70',
              !isCurrent && !isPast && 'border-ink-700 bg-ink-900'
            )}
          >
            <span className="font-mono font-semibold">R{n}</span>
            <span className="text-[10px] text-ink-400">
              {simulatedLabels[i] || `Round ${n}`}
            </span>
            {delta?.nodes || delta?.edges ? (
              <div className="flex gap-0.5 text-[10px]">
                {delta.nodes > 0 && (
                  <span className="text-emerald-500">+{delta.nodes}</span>
                )}
                {delta.edges > 0 && (
                  <span className="text-blue-500">+{delta.edges}</span>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}