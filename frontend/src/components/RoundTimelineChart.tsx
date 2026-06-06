/**
 * RoundTimelineChart - 顶部趋势线 LineChart（P2-2）
 *
 * 职责：
 *   - 渲染每个回合的"行动数 + 信念更新数"双线趋势
 *   - X 轴：回合号（round_num）
 *   - Y 轴：事件数量
 *   - 数据为空时回退空态
 *
 * 来源：C3 #39 / C4 §4 PR-3 P2-2
 * 默认关闭：flags.timelineTrendline
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp } from 'lucide-react'

export interface RoundTimelineChartPoint {
  round: number
  actions: number
  beliefUpdates: number
}

interface Props {
  data: RoundTimelineChartPoint[]
  /** 当前 scrubber 拖到的回合（高亮该回合及之前的点） */
  highlightToRound?: number
}

export function buildRoundTimelineChartData(
  rounds: Array<{
    round_num: number
    actions: any[]
    belief_updates: any[]
  }>,
): RoundTimelineChartPoint[] {
  return rounds.map((r) => ({
    round: r.round_num,
    actions: r.actions?.length ?? 0,
    beliefUpdates: r.belief_updates?.length ?? 0,
  }))
}

export default function RoundTimelineChart({ data, highlightToRound }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center gap-2 text-[11px] text-ink-400 dark:text-ink-500
                      border border-dashed border-ink-200/60 dark:border-ink-800/60 rounded-lg mb-4">
        <TrendingUp size={12} /> 暂无趋势数据（推演第一轮尚未完成）
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-ink-200/50 dark:border-ink-800/50
                    bg-ink-50/40 dark:bg-ink-900/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold
                        text-ink-500 dark:text-ink-400">
          <TrendingUp size={11} /> 趋势 · 行动数 vs 信念更新
        </div>
        <div className="text-[10px] text-ink-400 dark:text-ink-500 font-mono">
          R1 – R{data[data.length - 1].round}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(125,135,160,0.12)" />
          <XAxis
            dataKey="round"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={(v) => `R${v}`}
            stroke="#cbd5e1"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            allowDecimals={false}
            width={28}
            stroke="#cbd5e1"
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(255,255,255,0.96)',
              border: '1px solid rgba(15,20,48,0.1)',
              borderRadius: 8,
              fontSize: 11,
              boxShadow: '0 4px 16px -6px rgba(15,20,48,0.18)',
            }}
            labelFormatter={(v) => `回合 R${v}`}
            formatter={(v: number, name: string) => [v, name === 'actions' ? '行动数' : '信念更新数']}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 2 }}
            formatter={(v) => (v === 'actions' ? '行动数' : '信念更新数')}
          />
          <Line
            type="monotone"
            dataKey="actions"
            stroke="#3d5cff"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 1.5, fill: '#fff' }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="beliefUpdates"
            stroke="#ff6b4a"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 1.5, fill: '#fff' }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {highlightToRound !== undefined && (
        <div className="mt-1 text-[10px] text-ink-500 dark:text-ink-400 font-mono">
          当前回放：R0 – R{highlightToRound}
        </div>
      )}
    </div>
  )
}
