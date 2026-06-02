/**
 * ConvergenceChart - Display iteration convergence
 * Implements: US-064
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  data: Array<{ iteration: number; convergence: number }>
}

export default function ConvergenceChart({ data }: Props) {
  if (!data || data.length === 0) return null
  
  return (
    <div className="convergence-chart">
      <h3>Iteration Convergence</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="iteration" label={{ value: 'Iteration', position: 'insideBottom' }} />
          <YAxis domain={[0, 1]} label={{ value: 'Convergence', angle: -90 }} />
          <Tooltip />
          <Line type="monotone" dataKey="convergence" stroke="#0071e3" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
