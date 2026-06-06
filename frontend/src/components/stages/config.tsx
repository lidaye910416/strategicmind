/**
 * ConfigGenerationContent - 阶段 5「生成仿真配置」内容。
 *
 * 展示：最大回合 / 仿真小时 + 推演议题清单（前 4）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */
import { ListChecks } from 'lucide-react'
import Stat from './Stat'

interface Props {
  artifact: any
}

export default function ConfigGenerationContent({ artifact }: Props) {
  const cfg = artifact?.sim_config || {}
  const topics = cfg.topics || []
  const maxRounds = cfg.max_rounds || 0
  const simHours = cfg.simulated_hours || 0
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="最大回合" value={String(maxRounds)} />
        <Stat label="仿真小时" value={String(simHours)} />
      </div>
      {topics.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1 flex items-center gap-1">
            <ListChecks size={10} /> 推演议题
          </div>
          <div className="space-y-1">
            {topics.slice(0, 4).map((t: any, i: number) => (
              <div key={i} className="text-[11px] p-1.5 rounded bg-white/60 dark:bg-ink-900/40 truncate">
                {t.title || t.name || JSON.stringify(t).slice(0, 40)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
