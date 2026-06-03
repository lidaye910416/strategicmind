/**
 * NotificationToast - Pipeline completion notifications
 * Implements: US-067
 */
import toast from 'react-hot-toast'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

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
            Pipeline completed —{' '}
            <Link to={`/report/${runId}`} onClick={() => toast.dismiss(t.id)} className="underline font-semibold">
              view report
            </Link>
          </span>
        ),
        { duration: 8000 }
      )
      onCompleted?.(runId)
    } else if (status === 'failed') {
      toast.error(`Pipeline failed${stage ? ` at ${stage}` : ''}`, { duration: 8000 })
    } else if (status === 'paused') {
      toast('Pipeline paused', { icon: '⏸️', duration: 4000 })
    }
  }, [status, runId, stage, onCompleted])
  return null
}
