/**
 * views/Process — 5-step wizard orchestrator.
 *
 * URL contract:
 *   /process/:runId?step=N   (N ∈ {1,2,3,4,5}, default 1)
 *
 * The current step lives in the URL (not in component state) so
 * deep-links survive a page reload. We push back with
 * `setSearchParams({ step })`.
 */
import { useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import WizardShell from '../components/wizard/WizardShell'
import { type StepDef, type StepKey } from '../components/wizard/StepNav'
import Step1GraphBuild from '../components/wizard/Step1GraphBuild'
import Step2EnvSetup from '../components/wizard/Step2EnvSetup'
import Step3Simulation from '../components/wizard/Step3Simulation'
import Step4Report from '../components/wizard/Step4Report'
import Step5Interaction from '../components/wizard/Step5Interaction'

const STEPS: StepDef[] = [
  { key: 1, label: '图谱构建', shortLabel: '图谱' },
  { key: 2, label: '环境设置', shortLabel: '环境' },
  { key: 3, label: '模拟推演', shortLabel: '推演' },
  { key: 4, label: '战略报告', shortLabel: '报告' },
  { key: 5, label: 'Agent 采访', shortLabel: '采访' },
]

function parseStep(raw: string | null): StepKey {
  const n = Number(raw)
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n as StepKey
  return 1
}

export default function Process() {
  const { runId } = useParams<{ runId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const current = parseStep(searchParams.get('step'))

  const goTo = useCallback(
    (step: StepKey) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('step', String(step))
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const goPrev = useCallback(() => {
    if (current > 1) goTo((current - 1) as StepKey)
  }, [current, goTo])
  const goNext = useCallback(() => {
    if (current < 5) goTo((current + 1) as StepKey)
  }, [current, goTo])

  const stepNode = useMemo(() => {
    const props = { runId: runId ?? '' }
    switch (current) {
      case 1:
        return <Step1GraphBuild testId="step-1" />
      case 2:
        return <Step2EnvSetup testId="step-2" />
      case 3:
        return <Step3Simulation testId="step-3" />
      case 4:
        return <Step4Report testId="step-4" runId={runId} />
      case 5:
        return <Step5Interaction {...props} testId="step-5" />
      default:
        return null
    }
  }, [current, runId])

  return (
    <main
      data-testid="process-page"
      data-run-id={runId ?? ''}
      data-current-step={current}
      className="max-w-5xl mx-auto px-4 py-6"
    >
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-100">
          推演流程
        </h1>
        <p className="text-sm text-ink-600 dark:text-ink-400">
          runId: <code className="font-mono text-xs">{runId}</code>
        </p>
      </header>
      <WizardShell
        current={current}
        steps={STEPS}
        onSelect={goTo}
        onPrev={goPrev}
        onNext={goNext}
        canPrev={current > 1}
        canNext={current < 5}
      >
        {stepNode}
      </WizardShell>
    </main>
  )
}
