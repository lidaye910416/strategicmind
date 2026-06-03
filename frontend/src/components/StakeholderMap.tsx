/**
 * StakeholderRelationshipMap - Force-directed graph of stakeholders
 * Implements: US-100
 */
import { useEffect, useRef, useState } from 'react'
import { Users, AlertCircle } from 'lucide-react'
import api from '../services/api'

interface Stakeholder {
  stakeholder_id: string
  name: string
  stakeholder_type: string
  influence_weight: number
  relationships: Record<string, any>
}

interface Props { simulationId: string }

const COLORS: Record<string, string> = {
  SHAREHOLDER: '#f44336',
  BOARD_MEMBER: '#9c27b0',
  EXECUTIVE: '#3b6bff',
  COMPETITOR: '#ff9800',
  REGULATOR: '#4caf50',
}

export default function StakeholderMap({ simulationId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    api.get(`/simulation/${simulationId}/stakeholders`)
      .then((r) => {
        const data: Stakeholder[] = r.data?.stakeholders || []
        setCount(data.length)
        drawGraph(data)
      })
      .catch((e) => setError(e?.response?.data?.error || 'Failed to load stakeholders'))
  }, [simulationId])

  const drawGraph = (data: Stakeholder[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (data.length === 0) return

    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const radius = Math.min(180, 60 + data.length * 10)
    const positions: Record<string, { x: number; y: number }> = {}
    data.forEach((s, i) => {
      const angle = (i / data.length) * 2 * Math.PI
      positions[s.stakeholder_id] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      }
    })

    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    data.forEach((s) => {
      const start = positions[s.stakeholder_id]
      Object.keys(s.relationships).forEach((tid) => {
        const t = positions[tid]
        if (start && t) {
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
        }
      })
    })

    data.forEach((s) => {
      const pos = positions[s.stakeholder_id]
      if (!pos) return
      ctx.fillStyle = COLORS[s.stakeholder_type] || '#6b7280'
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 5 + s.influence_weight * 15, 0, 2 * Math.PI)
      ctx.fill()
      ctx.fillStyle = '#1f2937'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(s.name.substring(0, 20), pos.x, pos.y + 5 + s.influence_weight * 15 + 14)
    })
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1">
        <Users size={16} /> Stakeholder Relationships ({count})
      </h3>
      {error ? (
        <div className="flex items-center gap-2 text-sm text-red-600 py-4">
          <AlertCircle size={14} /> {error}
        </div>
      ) : (
        <div className="overflow-auto">
          <canvas ref={canvasRef} width={800} height={500} className="max-w-full" />
        </div>
      )}
    </div>
  )
}
