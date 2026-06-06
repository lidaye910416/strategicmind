/**
 * 部门 Agent 迷你卡：色点（话语权色阶）+ 部门名 + 话语权 %
 *
 * 用途：公司画像区部门列表
 *
 * 来源：P1-19 抽离 Workbench.tsx 内嵌 DeptMini 组件
 */
import type { DepartmentAgent } from '../../services/companyApi'

export default function DeptMini({ dept }: { dept: DepartmentAgent }) {
  const support = dept.decision_power != null ? Math.round(dept.decision_power * 100) : 50
  return (
    <div className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50 border border-ink-200/50 dark:border-ink-800/50">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${support * 3.6}, 70%, 55%)` }} />
        <div className="text-[11px] font-semibold text-ink-900 dark:text-white truncate flex-1">
          {dept.name}
        </div>
      </div>
      <div className="text-[10px] text-ink-500">话语权 {support}%</div>
    </div>
  )
}
