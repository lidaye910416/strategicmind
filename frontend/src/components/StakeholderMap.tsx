/**
 * StakeholderRelationshipMap - Force-directed graph of stakeholders
 * Implements: US-100
 */
import { useEffect, useRef } from 'react'
import api from '../services/api'

interface Stakeholder {
  stakeholder_id: string
  name: string
  stakeholder_type: string
  influence_weight: number
  relationships: Record<string, any>
}

interface Props {
  simulationId: string
}

export default function StakeholderMap({ simulationId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    loadStakeholders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationId])

  const loadStakeholders = async () => {
    try {
      const response = await api.get(`/simulation/${simulationId}/stakeholders`)
      drawGraph(response.data.stakeholders || [])
    } catch (error) {
      console.error('Failed to load stakeholders:', error)
    }
  }

  const drawGraph = (data: Stakeholder[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Simple circular layout
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const radius = 150
    const positions: Record<string, {x: number, y: number}> = {}
    
    data.forEach((s, i) => {
      const angle = (i / data.length) * 2 * Math.PI
      positions[s.stakeholder_id] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      }
    })
    
    // Draw relationships (edges)
    ctx.strokeStyle = '#ccc'
    ctx.lineWidth = 1
    data.forEach(s => {
      const start = positions[s.stakeholder_id]
      Object.keys(s.relationships).forEach(targetId => {
        const target = positions[targetId]
        if (start && target) {
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          ctx.lineTo(target.x, target.y)
          ctx.stroke()
        }
      })
    })
    
    // Draw stakeholders (nodes)
    data.forEach(s => {
      const pos = positions[s.stakeholder_id]
      if (!pos) return
      
      const nodeRadius = 5 + s.influence_weight * 15
      
      // Color by type
      const colors: Record<string, string> = {
        'SHAREHOLDER': '#f44336',
        'BOARD_MEMBER': '#9c27b0',
        'EXECUTIVE': '#2196f3',
        'COMPETITOR': '#ff9800',
        'REGULATOR': '#4caf50',
      }
      ctx.fillStyle = colors[s.stakeholder_type] || '#757575'
      
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, nodeRadius, 0, 2 * Math.PI)
      ctx.fill()
      
      // Label
      ctx.fillStyle = '#000'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(s.name.substring(0, 20), pos.x, pos.y + nodeRadius + 14)
    })
  }

  return (
    <div className="stakeholder-map">
      <h3>Stakeholder Relationships</h3>
      <canvas ref={canvasRef} width={800} height={500} />
    </div>
  )
}
