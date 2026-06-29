/**
 * TopicsTabPanel — Tab 6: 涌现议题 + 信念漂移 + 图谱轮次 diff。
 *
 * Subscribes to:
 *   - uiSlice: runId
 *   - configSlice.handleStartPipeline via DebateContext
 */
import { Play, Sparkles } from 'lucide-react'
import { WORKBENCH } from '../../../i18n/zh'
import { useRunId } from '../../../store/pipeline'
import EmergedTopicsTimeline from '../EmergedTopicsTimeline'
import BeliefShiftFeed from '../../BeliefShiftFeed'
import GraphRoundDiff from '../GraphRoundDiff'
import { useDebate } from '../DebateContext'

export default function TopicsTabPanel() {
  const runId = useRunId()
  const { handleStartPipeline } = useDebate()

  return (
    <div className="space-y-3" data-testid="tab-panel-topics">
      <EmergedTopicsTimeline />
      <BeliefShiftFeed />
      <GraphRoundDiff />
      {!runId && (
        <div className="card p-6 text-center bg-gradient-to-br from-brand-50/50 to-accent-50/30 dark:from-brand-950/20 dark:to-accent-950/10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 mx-auto inline-flex items-center justify-center text-white shadow-glow mb-2">
            <Sparkles size={20} />
          </div>
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
            {WORKBENCH.startTitle}
          </h3>
          <p className="text-xs text-ink-500 dark:text-ink-400 mb-3 max-w-md mx-auto">
            {WORKBENCH.startDesc}
          </p>
          <button onClick={handleStartPipeline} className="btn-primary">
            <Play size={14} /> {WORKBENCH.start}
          </button>
        </div>
      )}
    </div>
  )
}