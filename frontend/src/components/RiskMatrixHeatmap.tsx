/**
 * RiskAssessmentMatrix - 5x5 heatmap visualization
 * Implements: US-102
 */
import { Shield } from 'lucide-react'

interface Risk { name: string; probability: number; impact: number; category: string; mitigation_strategies?: string[] }
interface Props { risks: Risk[] }

const HEAT_COLORS = ['', 'bg-yellow-100', 'bg-yellow-300', 'bg-orange-400', 'bg-red-500', 'bg-red-700']
const HEAT_TEXT = ['', '', '', 'text-white', 'text-white', 'text-white']

export default function RiskMatrixHeatmap({ risks }: Props) {
  const matrix: number[][] = Array(5).fill(0).map(() => Array(5).fill(0))
  const riskMap: Record<string, Risk> = {}

  risks.forEach((r) => {
    const x = Math.min(4, Math.floor(r.probability * 5))
    const y = Math.min(4, Math.floor(r.impact * 5))
    matrix[x][y]++
    riskMap[`${x},${y}`] = r
  })

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1">
        <Shield size={16} /> Risk Assessment Matrix
      </h3>
      {risks.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No risks identified yet</p>
      ) : (
        <>
          <div className="flex">
            <div className="flex items-center justify-center w-6 text-xs text-gray-500" style={{ writingMode: 'vertical-rl' }}>
              Impact →
            </div>
            <div className="flex-1">
              {[4, 3, 2, 1, 0].map((y) => (
                <div key={y} className="grid grid-cols-5 gap-1 mb-1">
                  {[0, 1, 2, 3, 4].map((x) => {
                    const c = matrix[x][y]
                    const r = riskMap[`${x},${y}`]
                    return (
                      <div
                        key={`${x},${y}`}
                        className={`aspect-square ${HEAT_COLORS[c]} ${HEAT_TEXT[c]} rounded flex items-center justify-center text-xs font-semibold`}
                        title={r ? `${r.name} (P:${r.probability.toFixed(2)}, I:${r.impact.toFixed(2)})` : ''}
                      >
                        {c > 0 ? c : ''}
                      </div>
                    )
                  })}
                </div>
              ))}
              <div className="text-xs text-gray-500 text-center mt-1">Probability →</div>
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <h4 className="text-xs font-semibold text-gray-700">Identified Risks</h4>
            {risks.map((r, i) => (
              <div key={i} className="text-xs bg-gray-50 rounded p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{r.name}</span>
                  <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">{r.category}</span>
                  <span className="text-gray-500">Score: {(r.probability * r.impact).toFixed(2)}</span>
                </div>
                {r.mitigation_strategies && r.mitigation_strategies.length > 0 && (
                  <ul className="list-disc list-inside text-gray-600 mt-1">
                    {r.mitigation_strategies.map((m, j) => <li key={j}>{m}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
