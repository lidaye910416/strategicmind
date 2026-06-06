/**
 * SimulationRunningContent - 阶段 6「执行多 Agent 推演」内容（核心阶段）。
 *
 * 展示：已推演回合 / 行动数 / 信念更新数 + 各回合状态。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 * FE3 P3-C：EventSource 统一在 store，本组件用 useNetworkFrames() 订阅。
 */
import { useEffect, useState } from 'react'
import { Loader2, Network as NetworkIcon } from 'lucide-react'
import Stat from './Stat'
import { useNetworkFrames } from '../../store/pipeline'

interface Props {
  artifact: any
  runId?: string | null
  isActive: boolean
}

export default function SimulationRunningContent({ artifact, runId, isActive }: Props) {
  const totalRounds = artifact?.total_rounds || 0
  const currentRound = artifact?.current_round || 0
  const roundResults = artifact?.round_results || []
  // ---- FE3 P3-C：store selector 替代自建 SSE ----
  const networkFrames = useNetworkFrames()
  const liveRound = networkFrames.length > 0
    ? networkFrames[networkFrames.length - 1].round
    : currentRound
  // 保留 useState 触发以兼容上层 hook 顺序（无副作用）
  const [, setTick] = useState(0)
  useEffect(() => { setTick((t) => t + 1) }, [liveRound])
  // 保留 runId 形参以兼容调用方
  void runId

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
