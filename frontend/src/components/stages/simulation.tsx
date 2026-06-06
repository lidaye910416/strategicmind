/**
 * SimulationRunningContent - 阶段 6「执行多 Agent 推演」内容（核心阶段）。
 *
 * 展示：已推演回合 / 行动数 / 信念更新数 + 各回合状态。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 * 注意：组件内部仍使用 EventSource 直连 API（与 P0-2 unifiedSSE 目标有冲突，
 *       但本 P2-4 任务只做"拆文件"不改行为，保留 EventSource 后续单 PR 收敛）。
 */
import { useEffect, useState } from 'react'
import { Loader2, Network as NetworkIcon } from 'lucide-react'
import Stat from './Stat'

interface Props {
  artifact: any
  runId?: string | null
  isActive: boolean
}

export default function SimulationRunningContent({ artifact, runId, isActive }: Props) {
  const totalRounds = artifact?.total_rounds || 0
  const currentRound = artifact?.current_round || 0
  const roundResults = artifact?.round_results || []
  const [liveRound, setLiveRound] = useState(currentRound)

  useEffect(() => {
    if (!runId || !isActive) return
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'live_event' && d.event?.type === 'round_progress') {
          setLiveRound(d.event.data?.round || 0)
        }
      } catch {/* ignore */}
    }
    return () => es.close()
  }, [runId, isActive])

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="已推演" value={`${isActive ? liveRound : currentRound} / ${totalRounds}`} accent />
        <Stat label="行动数" value={String(roundResults.reduce((s: number, r: any) => s + (r.actions?.length || 0), 0))} />
        <Stat label="信念更新" value={String(roundResults.reduce((s: number, r: any) => s + (r.belief_updates?.length || 0), 0))} />
      </div>
      {roundResults.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1 flex items-center gap-1">
            <NetworkIcon size={10} /> 各回合状态
          </div>
          <div className="flex gap-1.5">
            {roundResults.map((r: any, i: number) => (
              <div key={i} className="flex-1 p-1.5 rounded bg-white/60 dark:bg-ink-900/40 text-center">
                <div className="text-[9px] text-ink-500 font-mono">R{r.round_num || i+1}</div>
                <div className="text-[11px] font-bold text-emerald-600">{r.actions?.length || 0}</div>
                <div className="text-[9px] text-ink-400">行动</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-ink-500 italic flex items-center gap-1">
        {isActive ? <><Loader2 size={10} className="animate-spin" /> 推演中，关系网同步演化…</> : '推演已完成，可查看完整关系网'}
      </div>
    </div>
  )
}
