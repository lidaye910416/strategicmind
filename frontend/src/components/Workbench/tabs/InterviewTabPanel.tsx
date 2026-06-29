/**
 * InterviewTabPanel — Tab 4: 智能体采访。
 *
 * Subscribes to:
 *   - CompanyContext (provided by Workbench.tsx): companyId
 */
import { MessageSquare } from 'lucide-react'
import AgentInterview from '../../AgentInterview'
import { useCompany } from '../CompanyContext'

export default function InterviewTabPanel() {
  const { companyId } = useCompany()

  return (
    <div className="space-y-3" data-testid="tab-panel-interview">
      {companyId ? (
        <section id="interview" className="scroll-mt-28">
          <AgentInterview companyId={companyId} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[200px] flex flex-col items-center justify-center">
          <MessageSquare size={28} className="text-ink-300 mb-2" />
          <div className="text-sm text-ink-500">启动推演后, 可对部门 Agent 发起智能体采访</div>
        </div>
      )}
    </div>
  )
}