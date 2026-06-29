/**
 * RealtimeTabPanel — Tab 1: 实时图谱 + 实时事件流（RoundTimeline）。
 *
 * Subscribes to:
 *   - uiSlice: runId, status, currentStage
 *   - graphSlice: useCurrentGraph (via useGraphNodes fallback)
 *   - simSlice: simRounds via useSimRounds
 *
 * No props — pure slice subscriptions.
 */
import { useState } from 'react'
import {
  Network, Activity, Loader2, RefreshCw,
} from 'lucide-react'
import { WORKBENCH } from '../../../i18n/zh'
import {
  useRunId, useStatus, useStage,
  useGraphProgress,
} from '../../../store/pipeline'
import { useCurrentGraph } from '../../../store/hooks/useCurrentRunView'
import RealtimeGraph from '../../graph/RealtimeGraph'
import EntityTypeLegend from '../../EntityTypeLegend'
import RoundTimeline, { RoundTimelineMemo } from '../../RoundTimeline'

export default function RealtimeTabPanel() {
  const runId = useRunId()
  const status = useStatus()
  const stage = useStage()
  const graphProgress = useGraphProgress()
  const currentGraph = useCurrentGraph()
  const liveGraphNodeCount = currentGraph.nodes.length

  // Polling toggle lives here (local UI state, not a slice)
  const [graphRefreshIntervalMs, setGraphRefreshIntervalMs] = useState<number>(0)

  return (
    <div className="space-y-3" data-testid="tab-panel-realtime">
      {liveGraphNodeCount > 0 || runId ? (
        <section id="graph" className="card p-3 scroll-mt-28 relative">
          <RealtimeGraph
            runId={runId}
            height={360}
            title={WORKBENCH.realtimeGraphTitle}
            refreshIntervalMs={graphRefreshIntervalMs}
          />
          <EntityTypeLegend overlay />
          <div className="mt-2 flex items-center gap-2">
            <button
              data-testid="realtime-kg-polling-toggle"
              onClick={() =>
                setGraphRefreshIntervalMs((v) => (v > 0 ? 0 : 30000))
              }
              className={`btn-ghost h-7 text-[11px] ${
                graphRefreshIntervalMs > 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-300/60'
                  : ''
              }`}
              title={
                graphRefreshIntervalMs > 0
                  ? '点击关闭 30s 轮询'
                  : '点击开启 30s 轮询 (SSE 断线兜底)'
              }
            >
              <RefreshCw
                size={12}
                className={graphRefreshIntervalMs > 0 ? 'animate-spin-soft' : ''}
              />
              {graphRefreshIntervalMs > 0
                ? WORKBENCH.realtimeGraphPollingOn
                : WORKBENCH.realtimeGraphPollingOff}
            </button>
            {graphRefreshIntervalMs > 0 && (
              <span
                data-testid="realtime-kg-polling-badge"
                className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-mono font-semibold"
              >
                {WORKBENCH.realtimeGraphPollingBadge(graphRefreshIntervalMs)}
              </span>
            )}
          </div>
        </section>
      ) : runId && !['completed', 'failed', 'cancelled'].includes(status) ? (
        <section id="graph" className="card p-6 flex flex-col items-center justify-center min-h-[280px] scroll-mt-28">
          <Loader2 size={28} className="text-brand-500 animate-spin mb-2" />
          <div className="text-sm font-semibold text-ink-700 dark:text-ink-200">
            {WORKBENCH.loadingGraph}
          </div>
          <div className="text-[10px] text-ink-400 mt-1 font-mono">
            {graphProgress.phase} · {graphProgress.nodes} 节点 / {graphProgress.edges} 边
          </div>
        </section>
      ) : runId ? (
        <section id="graph" className="card p-6 text-center min-h-[280px] flex flex-col items-center justify-center scroll-mt-28">
          <Network size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">未找到该 run 的知识图谱快照</div>
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[280px] flex flex-col items-center justify-center">
          <Network size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">启动推演后, 实体图谱会实时显示在这里</div>
        </div>
      )}

      {/* 实时事件流（仅在推演时显示） */}
      {(stage === 'SIMULATION_RUNNING' || status === 'running') && runId && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-brand-500/20 inline-flex items-center justify-center text-emerald-600">
              <Activity size={13} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {WORKBENCH.timelineTitle}
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                {WORKBENCH.timelineSubtitle}
              </div>
            </div>
          </div>
          {/* Use RoundTimelineMemo (React.memo wrapper) so unrelated
              slice updates don't trigger a re-render of the timeline. */}
          <RoundTimelineMemo simulationId={runId} />
        </div>
      )}
    </div>
  )
}

// Re-export default + memo at the same module so test fixtures can pick either
export { RoundTimeline }