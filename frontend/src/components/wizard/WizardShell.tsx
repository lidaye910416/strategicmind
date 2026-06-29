/**
 * WizardShell — frame, step rail, Prev/Next buttons.
 *
 * Composes StepNav + Prev/Next/Re-run controls. Parent passes the
 * `current` step and the `steps` definition; WizardShell only emits
 * navigation intents.
 */
import { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import StepNav, { StepDef, StepKey } from './StepNav'

export interface WizardShellProps {
  current: StepKey
  steps: StepDef[]
  onSelect: (step: StepKey) => void
  onPrev: () => void
  onNext: () => void
  onRerun?: () => void
  canPrev?: boolean
  canNext?: boolean
  statuses?: Partial<Record<StepKey, 'idle' | 'running' | 'done'>>
  testId?: string
  children?: ReactNode
}

export default function WizardShell({
  current,
  steps,
  onSelect,
  onPrev,
  onNext,
  onRerun,
  canPrev = true,
  canNext = true,
  statuses,
  testId,
  children,
}: WizardShellProps) {
  return (
    <div
      data-testid={testId ?? 'wizard-shell'}
      data-current-step={current}
      className="flex flex-col gap-4"
    >
      <div className="rounded-xl border border-ink-200 dark:border-ink-700 bg-white/60 dark:bg-ink-900/40 px-2">
        <StepNav
          current={current}
          steps={steps}
          onSelect={onSelect}
          statuses={statuses}
        />
      </div>
      <section data-testid={`wizard-step-${current}`} className="flex-1 min-h-[420px]">
        {children}
      </section>
      <footer className="flex items-center justify-between border-t border-ink-200 dark:border-ink-700 pt-3">
        <button
          type="button"
          data-testid="wizard-prev"
          onClick={onPrev}
          disabled={!canPrev}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          <ArrowLeft size={14} /> 上一步
        </button>
        <div className="flex items-center gap-2">
          {onRerun ? (
            <button
              type="button"
              data-testid="wizard-rerun"
              onClick={onRerun}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              <RotateCcw size={14} /> 重新推演
            </button>
          ) : null}
          <button
            type="button"
            data-testid="wizard-next"
            onClick={onNext}
            disabled={!canNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一步 <ArrowRight size={14} />
          </button>
        </div>
      </footer>
    </div>
  )
}
