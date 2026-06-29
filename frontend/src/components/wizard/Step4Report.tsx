/**
 * Step4 — Report: REPORT_GENERATING.
 *
 * Renders a lightweight report preview. The full ReportViewer lives
 * in views/Report.tsx; this is the wizard's "tease + open" surface.
 */
import { useMemo } from 'react'
import StepHeader, { type StepStatus } from './StepHeader'
import { useSnapshot, useStatus } from '../../store/pipeline'

export interface Step4ReportProps {
  testId?: string
  runId?: string
}

export default function Step4Report({ testId, runId }: Step4ReportProps) {
  const snapshot = useSnapshot() as any
  const status = useStatus()

  const derived = useMemo<StepStatus>(() => {
    if (status === 'failed') return 'failed'
    if (status === 'completed') return 'done'
    if (status === 'running') return 'running'
    return 'idle'
  }, [status])

  const reportId: string | undefined =
    snapshot?.report_id ?? snapshot?.artifacts?.REPORT_GENERATING?.reportId
  const summary: string =
    snapshot?.report_summary ??
    snapshot?.artifacts?.REPORT_GENERATING?.summary ??
    '尚未生成报告'

  return (
    <div data-testid={testId ?? 'step-4'}>
      <StepHeader
        step={4}
        title="战略报告"
        subtitle="整合推演结果，输出战略建议"
        status={derived}
        testId="step-4-header"
      />
      <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4 space-y-3">
        <div className="text-sm text-ink-700 dark:text-ink-200">
          {reportId ? (
            <>
              <span className="text-ink-500">reportId：</span>
              <code data-testid="step-4-report-id" className="font-mono text-xs">
                {reportId}
              </code>
            </>
          ) : (
            <span className="text-ink-500">尚无 reportId</span>
          )}
        </div>
        <p className="text-sm text-ink-700 dark:text-ink-200 whitespace-pre-wrap">
          {summary}
        </p>
        {reportId ? (
          <a
            href={`/report/${reportId}`}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            打开完整报告 →
          </a>
        ) : null}
        {runId ? (
          <div className="text-xs text-ink-500">runId: {runId}</div>
        ) : null}
      </div>
    </div>
  )
}
