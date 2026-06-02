/**
 * ValuationCharts - Financial projection charts
 * Implements: US-103
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface YearlyProjection {
  year: number
  base_revenue: number
  upside_revenue: number
  downside_revenue: number
}

interface Props {
  projections: YearlyProjection[]
  baseValue: number
  upsideValue: number
  downsideValue: number
}

export default function ValuationCharts({ projections, baseValue, upsideValue, downsideValue }: Props) {
  // Format currency
  const formatValue = (val: number) => {
    if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
    if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
    if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`
    return `$${val.toFixed(0)}`
  }

  return (
    <div className="valuation-charts">
      <h3>Financial Projections</h3>
      
      <div className="scenario-summary">
        <div className="scenario-card base">
          <h4>Base Case</h4>
          <p className="value">{formatValue(baseValue)}</p>
        </div>
        <div className="scenario-card upside">
          <h4>Upside Case</h4>
          <p className="value">{formatValue(upsideValue)}</p>
        </div>
        <div className="scenario-card downside">
          <h4>Downside Case</h4>
          <p className="value">{formatValue(downsideValue)}</p>
        </div>
      </div>
      
      <div className="chart-container">
        <h4>5-Year Revenue Projection</h4>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={projections}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" label={{ value: 'Year', position: 'insideBottom' }} />
            <YAxis tickFormatter={formatValue} />
            <Tooltip formatter={(value: number) => formatValue(value)} />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="upside_revenue" 
              stroke="#4caf50" 
              name="Upside" 
              strokeWidth={2}
            />
            <Line 
              type="monotone" 
              dataKey="base_revenue" 
              stroke="#2196f3" 
              name="Base" 
              strokeWidth={2}
            />
            <Line 
              type="monotone" 
              dataKey="downside_revenue" 
              stroke="#f44336" 
              name="Downside" 
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
