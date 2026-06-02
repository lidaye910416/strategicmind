import { useState } from 'react'

export default function ConfigPanel() {
  const [hours, setHours] = useState(72)
  const [style, setStyle] = useState<'executive' | 'technical' | 'narrative'>('executive')

  return (
    <div className="config-panel">
      <h3>Simulation Config</h3>
      
      <div className="config-item">
        <label>Simulation Hours</label>
        <input
          type="range"
          min={24}
          max={168}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        />
        <span>{hours}h</span>
      </div>

      <div className="config-item">
        <label>Report Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value as any)}>
          <option value="executive">Executive Summary</option>
          <option value="technical">Technical Analysis</option>
          <option value="narrative">Narrative Report</option>
        </select>
      </div>
    </div>
  )
}
