/**
 * CompareBarChart - 多 run 横向对比柱状图。
 *
 * 来源：C3 P2 #36 / D-22
 *
 * 设计：
 *   - 复用 recharts BarChart，按 run 数量自动堆叠多组柱子
 *   - X 轴：分类（如 action_type / stance / decision_keyword）
 *   - Y 轴：数值（次数 / 占比 / 计数）
 *   - 每个 run 一根柱子，组间并列；图例显示 run id
 *
 * 约束：
 *   - 必须传入 normalized 数据（每 run 一个 {name, data: [{category, value}]}）
 *   - 不做归一化（由父组件 CompareRuns.tsx 算），组件只负责渲染
 *   - < 100 行（实际 ~80 行）
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface SeriesData {
  /** 图例显示名（run_id） */
  name: string
  /** recharts 需要 long-format：[{category, run_xxx, run_yyy}] */
  data: Record<string, number | string>[]
  /** 该 series 的柱子颜色（hex / tailwind OK） */
  color: string
}

interface Props {
  series: SeriesData[]
  /** X 轴的 category 字段名（默认 'category'） */
  categoryKey?: string
  /** Y 轴标签 */
  yLabel?: string
  height?: number
  emptyText?: string
}

/** 把 series[] 合并为 recharts 所需的 long-format 行 */
function mergeSeries(
  series: SeriesData[],
  categoryKey: string,
): Record<string, number | string>[] {
  const rowMap = new Map<string, Record<string, number | string>>()
  for (const s of series) {
    for (const point of s.data) {
      const cat = String((point as any)[categoryKey] ?? '')
      if (!rowMap.has(cat)) rowMap.set(cat, { [categoryKey]: cat })
      const row = rowMap.get(cat)!
      row[s.name] = (point as any).value ?? 0
    }
  }
  return Array.from(rowMap.values())
}

export default function CompareBarChart({
  series, categoryKey = 'category', yLabel, height = 260, emptyText = '暂无数据',
}: Props) {
  if (!series || series.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-ink-400">
        {emptyText}
      </div>
    )
  }
  const rows = mergeSeries(series, categoryKey)
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-ink-400">
        {emptyText}
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
        <XAxis
          dataKey={categoryKey}
          tick={{ fontSize: 11, fill: 'currentColor' }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'currentColor' }}
          allowDecimals={false}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } } : undefined}
        />
        <Tooltip
          cursor={{ fill: 'rgba(120,120,120,0.08)' }}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {series.map((s) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            isAnimationActive
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
