/**
 * Step1 — GraphBuild: SEED_PARSING + GRAPH_BUILDING.
 *
 * Adapts existing pipeline store selectors. Stays dumb — it does not
 * re-implement DocumentUploader; the Workbench's seed flow already
 * starts a pipeline run that drives `useGraphProgress`.
 */
import { useMemo } from 'react'
import StepHeader, { type StepStatus } from './StepHeader'
import { useStatus, useGraphProgress, useGraphNodes, useGraphPhase } from '../../store/pipeline'

export interface Step1GraphBuildProps {
  testId?: string
}

function deriveStatus(
  status: string | undefined,
  phase: string | undefined,
  nodeCount: number
): StepStatus {
  if (status === 'failed') return 'failed'
  if (phase === 'done' || phase === 'idle' || nodeCount > 0) return 'done'
  if (phase === 'building' || phase === 'extracting') return 'running'
  if (status === 'running') return 'running'
  return 'idle'
}

export default function Step1GraphBuild({ testId }: Step1GraphBuildProps) {
  const status = useStatus()
  const progress = useGraphProgress()
  const nodes = useGraphNodes()
  const phase = useGraphPhase()

  const derived = useMemo(
    () => deriveStatus(status, phase, nodes.length),
    [status, phase, nodes.length]
  )

  return (
    <div data-testid={testId ?? 'step-1'}>
      <StepHeader
        step={1}
        title="图谱构建"
        subtitle="解析种子文档，抽取实体与关系，构建知识图谱"
        status={derived}
        testId="step-1-header"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Phase</div>
          <div className="text-lg font-semibold text-ink-900 dark:text-ink-100">
            {phase ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Progress</div>
          <div className="text-lg font-semibold text-ink-900 dark:text-ink-100">
            {typeof progress?.nodes === 'number'
              ? `${progress.nodes} 节点 / ${progress?.edges ?? 0} 边`
              : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Entities</div>
          <div className="text-lg font-semibold text-ink-900 dark:text-ink-100">
            {nodes.length}
          </div>
        </div>
      </div>
    </div>
  )
}
