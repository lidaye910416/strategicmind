/**
 * Stat - 通用数值卡（StageCards 各阶段共用）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 */

interface Props {
  label: string
  value: any
  accent?: boolean
}

export default function Stat({ label, value, accent }: Props) {
  return (
    <div className={`p-2 rounded-lg ${accent ? 'bg-brand-50 dark:bg-brand-950/30' : 'bg-white/60 dark:bg-ink-900/40'}`}>
      <div className="text-[9px] text-ink-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold font-mono mt-0.5 ${accent ? 'text-brand-700 dark:text-brand-300' : 'text-ink-900 dark:text-white'}`}>
        {value}
      </div>
    </div>
  )
}
