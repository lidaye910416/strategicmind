/**
 * InnerWorkbenchContent — Workbench tab-router shell (G8).
 *
 * Before G8: 22+ props drilled from Workbench.tsx. After G8: this is a thin
 * shell that owns nothing but the active tab id (via WorkbenchTabContext).
 * Each of the 6 tab panels subscribes to its own slice(s) — no prop drilling.
 *
 * The shell still accepts a tiny prop bag for backward compat with the parent
 * (Workbench.tsx) — but the bag is small (≤4 props) and most consumers are
 * satisfied by contexts (CompanyContext, DebateContext, WorkbenchTabContext)
 * instead of props.
 */
import { memo } from 'react'
import { motion } from 'framer-motion'
import { Network, Zap, Activity, Users, MessageSquare, Lightbulb } from 'lucide-react'
import { fadeUp } from '../../lib/motion'
import { WorkbenchTabProvider, useWorkbenchTab, type TabId } from './WorkbenchTabContext'
import RealtimeTabPanel from './tabs/RealtimeTabPanel'
import DepartmentsTabPanel from './tabs/DepartmentsTabPanel'
import DebateTabPanel from './tabs/DebateTabPanel'
import InterviewTabPanel from './tabs/InterviewTabPanel'
import AnalysisTabPanel from './tabs/AnalysisTabPanel'
import TopicsTabPanel from './tabs/TopicsTabPanel'

const TABS = [
  { id: 'realtime',    label: '实时图谱', icon: Network },
  { id: 'departments', label: '部门',     icon: Users },
  { id: 'debate',      label: '议题推演', icon: Zap },
  { id: 'interview',   label: '采访',     icon: MessageSquare },
  { id: 'analysis',    label: '分析',     icon: Activity },
  { id: 'topics',      label: '涌现议题', icon: Lightbulb },
] as const

export interface InnerWorkbenchContentProps {
  /** Optional override (URL deep link / tests). Default: 'realtime'. */
  initialTab?: TabId
  /** Optional data-testid for shell root */
  dataTestId?: string
}

function InnerWorkbenchContentImpl({
  initialTab,
  dataTestId = 'wb-inner',
}: InnerWorkbenchContentProps) {
  return (
    <WorkbenchTabProvider initialTab={initialTab ?? 'realtime'}>
      <InnerWorkbenchShell dataTestId={dataTestId} />
    </WorkbenchTabProvider>
  )
}

function InnerWorkbenchShell({ dataTestId }: { dataTestId: string }) {
  const { activeTab, setActiveTab } = useWorkbenchTab()
  return (
    <div
      data-testid={dataTestId}
      className="h-full w-full flex flex-col"
    >
      {/* ===== Tab bar ===== */}
      <div
        data-testid="wb-inner-tabs"
        className="flex-shrink-0 flex gap-1 border-b border-ink-200/60 dark:border-ink-800/60 mb-2 px-1 overflow-x-auto nice-scroll"
        role="tablist"
      >
        {TABS.map((t) => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              data-testid={`wb-tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`flex-shrink-0 px-3 h-8 text-[11px] font-medium rounded-t-md flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                active
                  ? 'bg-brand-500 text-white'
                  : 'text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-white hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ===== Tab content — only the active panel is mounted ===== */}
      <motion.div
        variants={fadeUp}
        className="flex-1 min-h-0 overflow-y-auto nice-scroll pr-1"
        data-testid={`wb-tab-panel-${activeTab}`}
      >
        {activeTab === 'realtime'    && <RealtimeTabPanel />}
        {activeTab === 'departments' && <DepartmentsTabPanel />}
        {activeTab === 'debate'      && <DebateTabPanel />}
        {activeTab === 'interview'   && <InterviewTabPanel />}
        {activeTab === 'analysis'    && <AnalysisTabPanel />}
        {activeTab === 'topics'      && <TopicsTabPanel />}
      </motion.div>
    </div>
  )
}

const InnerWorkbenchContent = memo(InnerWorkbenchContentImpl)
export default InnerWorkbenchContent