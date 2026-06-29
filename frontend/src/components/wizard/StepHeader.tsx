/**
 * StepHeader — per-step title, subtitle, and status pill.
 *
 * Goal G9 wizard primitive. Pure presentational; no store coupling.
 */
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react'

export type StepStatus = 'idle' | 'active' | 'running' | 'done' | 'failed'

export interface StepHeaderProps {
  step: number
  title: string
  subtitle?: string
  status?: StepStatus
  testId?: string
}

const STATUS_STYLES: Record<StepStatus, string> = {
  idle: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  active: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

const STATUS_LABEL: Record<StepStatus, string> = {
  idle: '待开始',
  active: '当前步骤',
  running: '进行中',
  done: '已完成',
  failed: '失败',
}

export default function StepHeader({
  step,
  title,
  subtitle,
  status = 'idle',
  testId,
}: StepHeaderProps) {
  const Icon =
    status === 'done'
      ? CheckCircle2
      : status === 'failed'
      ? AlertCircle
      : status === 'running'
      ? Loader2
      : Circle

  return (
    <header
      data-testid={testId ?? `step-header-${step}`}
      className="flex flex-col gap-1 border-b border-ink-200/60 dark:border-ink-700/60 pb-3 mb-4"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-white text-sm font-semibold dark:bg-ink-100 dark:text-ink-900">
          {step}
        </span>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{title}</h2>
        <span
          data-testid={`step-header-${step}-status`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
          {STATUS_LABEL[status]}
        </span>
      </div>
      {subtitle ? (
        <p className="text-sm text-ink-600 dark:text-ink-400 pl-10">{subtitle}</p>
      ) : null}
    </header>
  )
}
