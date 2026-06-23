/**
 * frontend/src/components/agent/AgentListView.tsx
 *
 * 单一来源的 agent 列表, 替代 AgentClusterView / RightRail / mini-card 3 处实现。
 * 渲染数据来自 useCurrentAgents() — 与 Simulation / Workbench / Dashboard 一致。
 *
 * N5 修复: 不再独立 fetch /simulation/<id>/clusters (那是另一份独立数据源), 全部
 * 走 useCurrentAgents(), 与其它页面的 agent list 完全一致。
 */
import { Loader2, Users } from 'lucide-react'
import {
  useCurrentAgents,
  type AgentSummary,
} from '../../store/hooks/useCurrentRunView'

export interface AgentListViewProps {
  runId: string | null
  variant: 'compact' | 'full'
}

export default function AgentListView({ runId, variant }: AgentListViewProps) {
  const agents = useCurrentAgents()

  if (!runId) {
    return <div className="text-sm text-ink-500 italic">推演尚未启动</div>
  }
  if (variant === 'compact') return <CompactAgentList agents={agents} />
  return <FullAgentList agents={agents} />
}

function CompactAgentList({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) {
    return (
      <div className="text-xs text-ink-500" data-testid="agent-list-empty">
        暂无 agents
      </div>
    )
  }
  return (
    <ul className="space-y-1" data-testid="agent-list-compact">
      {agents.slice(0, 8).map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-2 text-xs"
          data-testid="agent-list-compact-item"
        >
          <Users size={11} className="text-ink-400" />
          <span className="font-medium text-ink-700 dark:text-ink-200">{a.name}</span>
          {typeof a.influence === 'number' && (
            <span className="ml-auto text-ink-500">
              inf={(a.influence ?? 0).toFixed(2)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function FullAgentList({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-ink-500 py-8 justify-center"
        data-testid="agent-list-empty"
      >
        <Loader2 size={14} className="animate-spin" /> 暂无 agents
      </div>
    )
  }
  return (
    <ul
      className="divide-y divide-ink-200/40 dark:divide-ink-800/40"
      data-testid="agent-list-full"
    >
      {agents.map((a) => (
        <li
          key={a.id}
          className="py-2 flex items-center gap-3"
          data-testid="agent-list-full-item"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center text-violet-600 text-xs font-bold">
            {(a.name ?? a.id).slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-900 dark:text-white truncate">
              {a.name}
            </div>
            <div className="text-[11px] text-ink-500">
              {a.type ?? 'agent'} · last_round={a.last_action_round ?? '—'} · inf=
              {(a.influence ?? 0).toFixed(2)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
