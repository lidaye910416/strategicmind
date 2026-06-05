/**
 * ConfigPanel - Pipeline configuration controls
 * Implements: US-068
 */
import { Settings } from 'lucide-react'
import { CONFIG, REPORT_STYLE_LABELS, REPORT_STYLE_DESCRIPTIONS } from '../i18n/zh'

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
        <Settings size={16} /> {CONFIG.title}
      </h3>
      <div>
        <label className="label">{CONFIG.hours}: <span className="font-bold text-brand-700">{hours}</span></label>
        <input type="range" min={24} max={168} value={hours}
          onChange={(e) => onHoursChange(Number(e.target.value))}
          className="w-full" />
        <p className="text-xs text-gray-500 mt-1">{CONFIG.hoursHint}</p>
      </div>
      <div>
        <label className="label">{CONFIG.rounds}</label>
        <input type="number" min={1} max={50} value={maxRounds}
          onChange={(e) => onMaxRoundsChange(Number(e.target.value))}
          className="input" />
        <p className="text-xs text-gray-500 mt-1">{CONFIG.roundsHint}</p>
      </div>
      <div>
        <label className="label">{CONFIG.style}</label>
        <select value={style} onChange={(e) => onStyleChange(e.target.value as any)} className="input">
          {Object.entries(REPORT_STYLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">{REPORT_STYLE_DESCRIPTIONS[style]}</p>
      </div>
    </div>
  )
}
