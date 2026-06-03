/**
 * ConfigPanel - Pipeline configuration controls
 * Implements: US-068
 */
import { Settings } from 'lucide-react'

interface Props {
  hours: number
  onHoursChange: (h: number) => void
  style: 'executive' | 'technical' | 'narrative'
  onStyleChange: (s: 'executive' | 'technical' | 'narrative') => void
  maxRounds: number
  onMaxRoundsChange: (r: number) => void
}

export default function ConfigPanel({
  hours, onHoursChange, style, onStyleChange, maxRounds, onMaxRoundsChange,
}: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1">
        <Settings size={16} /> Configuration
      </h3>
      <div>
        <label className="label">Simulation hours: <span className="font-bold text-brand-700">{hours}h</span></label>
        <input type="range" min={24} max={168} value={hours}
          onChange={(e) => onHoursChange(Number(e.target.value))}
          className="w-full" />
      </div>
      <div>
        <label className="label">Max rounds</label>
        <input type="number" min={1} max={50} value={maxRounds}
          onChange={(e) => onMaxRoundsChange(Number(e.target.value))}
          className="input" />
      </div>
      <div>
        <label className="label">Report style</label>
        <select value={style} onChange={(e) => onStyleChange(e.target.value as any)} className="input">
          <option value="executive">Executive Summary</option>
          <option value="technical">Technical Analysis</option>
          <option value="narrative">Narrative Report</option>
        </select>
      </div>
    </div>
  )
}
