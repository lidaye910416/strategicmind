/**
 * DepartmentsTabPanel — Tab 2: 公司画像 + 部门列表 + 部门关系图。
 *
 * Subscribes to:
 *   - CompanyContext (provided by Workbench.tsx) — company + companyId
 *
 * No prop drilling, no local companyApi.setup call (Workbench.tsx owns that).
 */
import { Network, Users } from 'lucide-react'
import { WORKBENCH } from '../../../i18n/zh'
import Stat from '../Stat'
import DeptMini from '../DeptMini'
import DepartmentGraph from '../../DepartmentGraph'
import { useCompany } from '../CompanyContext'

export default function DepartmentsTabPanel() {
  const { company } = useCompany()

  return (
    <div className="space-y-3" data-testid="tab-panel-departments">
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
            <Network size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {WORKBENCH.companySection}
            </div>
            <div className="text-sm font-semibold text-ink-900 dark:text-white">
              {company?.company_name || '加载中…'}
            </div>
          </div>
          {company && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-semibold">
              {company.business_model.model_name_cn}
            </span>
          )}
        </div>

        {company && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={WORKBENCH.statMargin} value={`${(company.business_model.margin_baseline * 100).toFixed(0)}%`} />
              <Stat label={WORKBENCH.statShock} value={company.business_model.shock_resilience.toFixed(2)} />
              <Stat label={WORKBENCH.statCycle} value={company.market_env.cycle_label_cn} />
            </div>

            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-2">
                {WORKBENCH.departments} ({company.departments.length})
              </div>
              <div className="grid grid-cols-2 gap-2">
                {company.departments.map((d) => (
                  <DeptMini key={d.agent_id} dept={d} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {company && company.departments.length > 0 ? (
        <section id="rel" className="card p-3 scroll-mt-28">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-2">
            部门关系
          </div>
          <DepartmentGraph company={company} height={300} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[200px] flex flex-col items-center justify-center">
          <Users size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">部门关系图会在公司画像加载后显示</div>
        </div>
      )}
    </div>
  )
}