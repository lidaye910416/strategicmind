/**
 * StepNav — numbered step rail with deep-link clicks.
 *
 * Clicking a step pushes `?step=N` via the parent's setSearchParams.
 * The parent owns the URL — StepNav is dumb and only emits.
 */
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'

export type StepKey = 1 | 2 | 3 | 4 | 5

export interface StepDef {
  key: StepKey
  label: string
  shortLabel?: string
}

export interface StepNavProps {
  current: StepKey
  steps: StepDef[]
  onSelect: (step: StepKey) => void
  /** Map of stepKey -> status (done/running/...) for the rail's icons. */
  statuses?: Partial<Record<StepKey, 'idle' | 'running' | 'done'>>
  testId?: string
}

export default function StepNav({
  current,
  steps,
  onSelect,
  statuses = {},
  testId,
}: StepNavProps) {
  return (
    <nav
      data-testid={testId ?? 'step-nav'}
      className="flex items-center gap-2 overflow-x-auto py-3 px-1"
      aria-label="Wizard steps"
    >
      {steps.map((s, idx) => {
        const status = statuses[s.key] ?? (s.key === current ? 'running' : 'idle')
        const Icon = status === 'done' ? CheckCircle2 : status === 'running' ? Loader2 : Circle
        const isCurrent = s.key === current
        return (
          <button
            key={s.key}
            type="button"
            data-testid={`step-nav-${s.key}`}
            data-current={isCurrent ? 'true' : 'false'}
            data-status={status}
            onClick={() => onSelect(s.key)}
            className={[
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition',
              isCurrent
                ? 'border-ink-900 dark:border-ink-100 bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900'
                : 'border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800',
            ].join(' ')}
          >
            <Icon
              size={14}
              className={status === 'running' ? 'animate-spin' : ''}
            />
            <span className="font-medium">{s.key}</span>
            <span className="hidden sm:inline">{s.shortLabel ?? s.label}</span>
            {idx < steps.length - 1 ? (
              <span aria-hidden="true" className="ml-1 text-ink-400">
                ›
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
