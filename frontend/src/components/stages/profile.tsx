/**
 * ProfileGenerationContent - 阶段 4「生成 Agent 画像」内容。
 *
 * 展示：Agent 数量 + Agent 清单（前 6，2 列网格）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */
import { UserCircle2 } from 'lucide-react'
import Stat from './Stat'

interface Props {
  artifact: any
}

export default function ProfileGenerationContent({ artifact }: Props) {
  const agents = artifact?.agents || []
  return (
    <div className="space-y-2">
      <Stat label="Agent 数" value={String(agents.length || artifact?.count || 0)} />
      {agents.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">Agent 清单</div>
          <div className="grid grid-cols-2 gap-1.5">
            {agents.slice(0, 6).map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 p-1.5 rounded bg-white/60 dark:bg-ink-900/40 text-[10px]">
                <UserCircle2 size={10} className="text-pink-500 flex-shrink-0" />
                <span className="truncate flex-1 font-semibold">{a.name}</span>
                <span className="text-ink-500 font-mono text-[9px]">{a.type?.slice(0, 4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
