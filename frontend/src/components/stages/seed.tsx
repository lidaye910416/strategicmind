/**
 * SeedParsingContent - 阶段 1「种子文档解析」内容。
 *
 * 展示：文档数 / 总字数 / 文档清单（前 3）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */
import { FileCode } from 'lucide-react'
import Stat from './Stat'

interface Props {
  artifact: any
}

export default function SeedParsingContent({ artifact }: Props) {
  const docs = artifact?.documents || []
  const count = artifact?.count ?? docs.length
  const totalLen = docs.reduce((s: number, d: any) => s + (d.len || 0), 0)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="文档数" value={String(count)} />
        <Stat label="总字数" value={totalLen > 1000 ? `${(totalLen/1000).toFixed(1)}k` : String(totalLen)} />
        <Stat label="状态" value={count > 0 ? '已就绪' : '等待'} />
      </div>
      {docs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">文档清单</div>
          {docs.slice(0, 3).map((d: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-white/60 dark:bg-ink-900/40">
              <FileCode size={10} className="text-amber-500 flex-shrink-0" />
              <span className="truncate flex-1">{d.title || d.doc_id}</span>
              <span className="font-mono text-ink-500">{d.len} 字</span>
            </div>
          ))}
          {docs.length > 3 && <div className="text-[10px] text-ink-400 text-center">+{docs.length - 3} 更多</div>}
        </div>
      )}
    </div>
  )
}
