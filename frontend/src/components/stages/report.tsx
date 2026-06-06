/**
 * ReportGeneratingContent - 阶段 7「生成战略报告」内容。
 *
 * 展示：报告字数 + 报告生成路径。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */
import Stat from './Stat'

interface Props {
  artifact: any
}

export default function ReportGeneratingContent({ artifact }: Props) {
  const contentLen = artifact?.content_length || 0
  const path = artifact?.path || ''
  return (
    <div className="space-y-2">
      <Stat label="报告字数" value={contentLen > 1000 ? `${(contentLen/1000).toFixed(1)}k` : String(contentLen)} accent />
      {path && (
        <div className="text-[10px] text-ink-500 italic">
          报告已生成于 {path}
        </div>
      )}
      {!contentLen && !path && (
        <div className="text-[10px] text-ink-400 italic">等待报告生成…</div>
      )}
    </div>
  )
}
