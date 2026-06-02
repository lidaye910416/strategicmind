/**
 * RiskAssessmentMatrix - 5x5 heatmap visualization
 * Implements: US-102
 */
interface Risk {
  name: string
  probability: number
  impact: number
  category: string
  mitigation_strategies?: string[]
}

interface Props {
  risks: Risk[]
}

export default function RiskMatrixHeatmap({ risks }: Props) {
  const matrix: number[][] = Array(5).fill(0).map(() => Array(5).fill(0))
  const riskMap: Record<string, Risk> = {}

  risks.forEach((risk) => {
    const x = Math.min(4, Math.floor(risk.probability * 5))
    const y = Math.min(4, Math.floor(risk.impact * 5))
    matrix[x][y]++
    riskMap[`${x},${y}`] = risk
  })

  const getColor = (count: number): string => {
    if (count === 0) return '#f5f5f5'
    if (count === 1) return '#fff9c4'
    if (count === 2) return '#ffeb3b'
    if (count === 3) return '#ff9800'
    return '#f44336'
  }

  return (
    <div className="risk-matrix-heatmap">
      <h3>Risk Assessment Matrix</h3>
      <div className="matrix-container">
        <div className="y-axis-label">Impact →</div>
        <div className="matrix-grid">
          {[4, 3, 2, 1, 0].map(y => (
            <div key={y} className="matrix-row">
              {[0, 1, 2, 3, 4].map(x => {
                const count = matrix[x][y]
                const risk = riskMap[`${x},${y}`]
                return (
                  <div
                    key={`${x},${y}`}
                    className="matrix-cell"
                    style={{ background: getColor(count) }}
                    title={risk ? `${risk.name} (P:${risk.probability.toFixed(2)}, I:${risk.impact.toFixed(2)})` : ''}
                  >
                    {count > 0 && <span className="count">{count}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="x-axis-label">Probability →</div>
      </div>
      
      <div className="risk-list">
        <h4>Identified Risks</h4>
        {risks.map((risk, i) => (
          <div key={i} className="risk-item">
            <strong>{risk.name}</strong>
            <span className="category">{risk.category}</span>
            <span className="score">
              Risk Score: {(risk.probability * risk.impact).toFixed(2)}
            </span>
            {risk.mitigation_strategies && (
              <ul>
                {risk.mitigation_strategies.map((m, j) => (
                  <li key={j}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
