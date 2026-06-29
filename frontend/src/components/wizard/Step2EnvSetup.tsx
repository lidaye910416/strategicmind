/**
 * Step2 — EnvSetup: ENTITY_EXTRACTION + PROFILE_GENERATION + CONFIG_GENERATION.
 *
 * Reads `useSnapshot` for the company + config payload and surfaces
 * a simple card list. No business logic — just the wizard framing.
 */
import { useMemo } from 'react'
import StepHeader, { type StepStatus } from './StepHeader'
import { useSnapshot, useStatus, useGraphNodes, useLastRunConfig } from '../../store/pipeline'

export interface Step2EnvSetupProps {
  testId?: string
}

export default function Step2EnvSetup({ testId }: Step2EnvSetupProps) {
  const snapshot = useSnapshot() as any
  const status = useStatus()
  const nodes = useGraphNodes()
  const lastRunConfig = useLastRunConfig() as any

  const derived = useMemo<StepStatus>(() => {
    if (status === 'failed') return 'failed'
    if (snapshot) return 'done'
    if (status === 'running') return 'running'
    return 'idle'
  }, [status, snapshot])

  const companyName: string = snapshot?.company_name ?? snapshot?.name ?? '—'
  const configSummary: string = lastRunConfig
    ? JSON.stringify(
        {
          years: lastRunConfig.years ?? lastRunConfig?.user_params?.years,
          time_step: lastRunConfig.time_step ?? lastRunConfig?.user_params?.time_step,
        },
        null,
        0
      )
    : '—'

  return (
    <div data-testid={testId ?? 'step-2'}>
      <StepHeader
        step={2}
        title="环境设置"
        subtitle="实体抽取、画像生成、推演配置"
        status={derived}
        testId="step-2-header"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Company</div>
          <div className="text-lg font-semibold text-ink-900 dark:text-ink-100">
            {companyName}
          </div>
          <div className="text-xs text-ink-500 mt-2">实体数：{nodes.length}</div>
        </div>
        <div className="rounded-lg border border-ink-200 dark:border-ink-700 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Config</div>
          <pre
            data-testid="step-2-config"
            className="text-xs text-ink-700 dark:text-ink-200 whitespace-pre-wrap break-all mt-1"
          >
            {configSummary}
          </pre>
        </div>
      </div>
    </div>
  )
}
