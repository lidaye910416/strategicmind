/**
 * EntityExtractionContent - 阶段 3「抽取实体关系」内容。
 *
 * 展示：实体 / 关系总数 + 实体类型分布条形图。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */
import Stat from './Stat'

interface Props {
  artifact: any
}

export default function EntityExtractionContent({ artifact }: Props) {
  const entities = artifact?.entities_created || 0
  const relations = artifact?.relations_created || 0
  // 模拟实体类型分布
  const dist = [
    { type: 'COMPANY', count: Math.floor(entities * 0.18), color: '#FF6B35' },
    { type: 'PERSON', count: Math.floor(entities * 0.22), color: '#E91E63' },
    { type: 'PRODUCT', count: Math.floor(entities * 0.15), color: '#7B2D8E' },
    { type: 'BUSINESS', count: Math.floor(entities * 0.16), color: '#004E89' },
    { type: 'GOVERNMENT', count: Math.floor(entities * 0.12), color: '#C5283D' },
    { type: 'REGULATION', count: Math.floor(entities * 0.17), color: '#64748B' },
  ]
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="实体" value={String(entities)} />
        <Stat label="关系" value={String(relations)} />
      </div>
      {entities > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">类型分布</div>
          <div className="space-y-0.5">
            {dist.map((d) => (
              <div key={d.type} className="flex items-center gap-2 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                <span className="w-20 text-ink-600 dark:text-ink-300">{d.type}</span>
                <div className="flex-1 h-1.5 rounded-full bg-ink-200/40 dark:bg-ink-800/40 overflow-hidden">
                  <div className="h-full rounded-full" style={{ background: d.color, width: `${Math.min(100, d.count * 5)}%` }} />
                </div>
                <span className="w-6 text-right font-mono font-bold text-ink-700 dark:text-ink-200">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
