/**
 * ConvergenceChart - Display iteration convergence
 * Implements: US-064
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Props { data: Array<{ iteration: number; convergence: number }> }

export default function ConvergenceChart({ data }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Iteration Convergence</h3>
      {!data || data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-gray-400">
          No convergence data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="iteration" label={{ value: 'Iteration', position: 'insideBottom', offset: -2 }} stroke="#6b7280" fontSize={11} />
            <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="convergence" stroke="#3b6bff" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
