/**
 * NotificationToast - Pipeline completion notifications
 * Implements: US-067
 */
import toast from 'react-hot-toast'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { SIMULATION, APP_ROUTES } from '../i18n/zh'

interface Props {
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
  runId: string
  stage?: string
  onCompleted?: (runId: string) => void
}

export default function NotificationToast({ status, runId, stage, onCompleted }: Props) {
  useEffect(() => {
    if (status === 'completed') {
      toast.success(
        (t) => (
          <span>
            {SIMULATION.toastCompleted} - {' '}
            <Link to={APP_ROUTES.report(runId)} onClick={() => toast.dismiss(t.id)} className="underline font-semibold">
              {SIMULATION.toastViewReport}
            </Link>
          </span>
        ),
        { duration: 8000 }
      )
      onCompleted?.(runId)
    } else if (status === 'failed') {
      toast.error(SIMULATION.toastFailed(stage), { duration: 8000 })
    } else if (status === 'paused') {
      toast(SIMULATION.toastPaused, { icon: '⏸️', duration: 4000 })
    }
  }, [status, runId, stage, onCompleted])
  return null
}
