/**
 * ValuationCharts - Financial projection charts
 * Implements: US-103
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { SIMULATION } from '../i18n/zh'

interface YearlyProjection { year: number; base_revenue: number; upside_revenue: number; downside_revenue: number }
interface Props { projections: YearlyProjection[]; baseValue: number; upsideValue: number; downsideValue: number }

function formatValue(val: number): string {
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)} 亿`
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)} 百万`
  if (val >= 1e3) return `${(val / 1e3).toFixed(2)} 千`
  return `${val.toFixed(0)}`
}

export default function ValuationCharts({ projections, baseValue, upsideValue, downsideValue }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{SIMULATION.valuationTitle}</h3>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-1 text-blue-700 text-xs">
            <Minus size={14} /> {SIMULATION.valuationBase}
          </div>
          <div className="text-lg font-bold text-blue-900 mt-1">{formatValue(baseValue)}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="flex items-center gap-1 text-green-700 text-xs">
            <TrendingUp size={14} /> {SIMULATION.valuationUp}
          </div>
          <div className="text-lg font-bold text-green-900 mt-1">{formatValue(upsideValue)}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-1 text-red-700 text-xs">
            <TrendingDown size={14} /> {SIMULATION.valuationDown}
          </div>
          <div className="text-lg font-bold text-red-900 mt-1">{formatValue(downsideValue)}</div>
        </div>
      </div>
      {projections.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">{SIMULATION.valuationTitle} - 无数据</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={projections}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" stroke="#6b7280" fontSize={11} />
            <YAxis tickFormatter={formatValue} stroke="#6b7280" fontSize={11} />
            <Tooltip formatter={(v: number) => formatValue(v)} />
            <Legend />
            <Line type="monotone" dataKey="upside_revenue" stroke="#4caf50" strokeWidth={2} name={SIMULATION.upsideScenario} />
            <Line type="monotone" dataKey="base_revenue" stroke="#3b6bff" strokeWidth={2} name={SIMULATION.baseScenario} />
            <Line type="monotone" dataKey="downside_revenue" stroke="#f44336" strokeWidth={2} name={SIMULATION.downsideScenario} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
