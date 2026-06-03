/**
 * BeliefEvolutionChart - Track belief changes over rounds
 * Implements: US-104
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface BeliefData { round: number; [agent: string]: number }
interface Props { data: BeliefData[]; agents: string[] }

const COLORS = ['#3b6bff', '#f44336', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#795548']

export default function BeliefEvolutionChart({ data, agents }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Belief Evolution</h3>
      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-400">
          No belief data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="round" label={{ value: 'Round', position: 'insideBottom', offset: -2 }} stroke="#6b7280" fontSize={11} />
            <YAxis domain={[-1, 1]} stroke="#6b7280" fontSize={11} />
            <Tooltip />
            <Legend />
            {agents.map((a, i) => (
              <Line key={a} type="monotone" dataKey={a}
                stroke={COLORS[i % COLORS.length]} strokeWidth={2} name={a} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
