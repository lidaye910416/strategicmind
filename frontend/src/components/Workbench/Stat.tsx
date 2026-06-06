/**
 * 公司画像关键参数卡：单格 label + value
 *
 * 用途：公司画像区 3 列参数（毛利率/抗冲击/市场周期）
 *
 * 来源：P1-19 抽离 Workbench.tsx 内嵌 Stat 组件
 */
export default function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50">
      <div className="text-[10px] text-ink-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold text-ink-900 dark:text-white font-mono mt-0.5">{value}</div>
    </div>
  )
}
