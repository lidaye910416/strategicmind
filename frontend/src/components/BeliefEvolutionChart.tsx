/**
 * BeliefEvolutionChart - Track belief changes over rounds
 * Implements: US-104
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface BeliefData {
  round: number
  [agent: string]: number
}

interface Props {
  data: BeliefData[]
  agents: string[]
}

const COLORS = ['#2196f3', '#f44336', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#795548']

export default function BeliefEvolutionChart({ data, agents }: Props) {
  return (
    <div className="belief-evolution-chart">
      <h3>Belief Evolution</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="round" label={{ value: 'Round', position: 'insideBottom' }} />
          <YAxis domain={[-1, 1]} label={{ value: 'Belief Position', angle: -90 }} />
          <Tooltip />
          <Legend />
          {agents.map((agent, i) => (
            <Line
              key={agent}
              type="monotone"
              dataKey={agent}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              name={agent}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
