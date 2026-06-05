/**
 * BeliefEvolutionChart - Track belief changes over rounds
 * Implements: US-104
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { SIMULATION } from '../i18n/zh'

interface BeliefData { round: number; [agent: string]: number }
interface Props { data: BeliefData[]; agents: string[] }

const COLORS = ['#3d5cff', '#ff6b4a', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#a855f7']

export default function BeliefEvolutionChart({ data, agents }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{SIMULATION.beliefTitle}</h3>
        <span className="text-[10px] uppercase tracking-wider text-ink-400 dark:text-ink-500 font-medium">
          {SIMULATION.xRound} × {SIMULATION.yValue}
        </span>
      </div>
      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-ink-400 dark:text-ink-500
                        border border-dashed border-ink-200 dark:border-ink-800 rounded-xl">
          {SIMULATION.beliefEmpty}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(125,135,160,0.15)" />
            <XAxis dataKey="round" label={{ value: SIMULATION.xRound, position: 'insideBottom', offset: -2 }} stroke="#94a3b8" fontSize={11} />
            <YAxis domain={[-1, 1]} label={{ value: SIMULATION.yValue, angle: -90, position: 'insideLeft' }} stroke="#94a3b8" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(15,20,48,0.1)',
                borderRadius: 12,
                fontSize: 12,
                boxShadow: '0 6px 24px -8px rgba(15,20,48,0.15)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {agents.map((a, i) => (
              <Line key={a} type="monotone" dataKey={a}
                stroke={COLORS[i % COLORS.length]} strokeWidth={2.5}
                name={a} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
