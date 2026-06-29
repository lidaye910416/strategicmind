/**
 * AnalysisTabPanel — Tab 5: 推演分析 (信念演化 + 关系网时序 + 风险矩阵)。
 *
 * Subscribes to:
 *   - uiSlice: runId
 *   - simSlice: simRounds, networkFrames
 *   - simSlice-derived: reportRisks
 */
import { useMemo } from 'react'
import { Network, Activity, Zap } from 'lucide-react'
import { WORKBENCH } from '../../../i18n/zh'
import {
  useRunId, useSimRounds, useNetworkFrames, useReportRisks,
} from '../../../store/pipeline'
import BeliefEvolutionChart from '../../BeliefEvolutionChart'
import SimulationNetworkGraph from '../../SimulationNetworkGraph'
import RiskMatrixHeatmap from '../../RiskMatrixHeatmap'
import DeeperSimCta from '../DeeperSimCta'

export default function AnalysisTabPanel() {
  const runId = useRunId()
  const simRounds = useSimRounds()
  const networkFrames = useNetworkFrames()
  const reportRisks = useReportRisks()

  // 派生 beliefByRound 数据
  const beliefData = useMemo(() => {
    if (simRounds.length === 0) return { data: [], agents: [] }
    const beliefByRound = new Map<number, Record<string, number>>()
    const agentSet = new Set<string>()
    for (const r of simRounds) {
      const updates = Array.isArray(r.belief_updates) ? r.belief_updates : []
      const row = beliefByRound.get(r.round) ?? { round: r.round }
      for (const u of updates) {
        const aId = String((u as any).agent_id ?? (u as any).agentId ?? (u as any).agent ?? 'unknown')
        const v = typeof (u as any).value === 'number' ? (u as any).value
          : typeof (u as any).belief === 'number' ? (u as any).belief
          : 0
        row[aId] = v
        agentSet.add(aId)
      }
      beliefByRound.set(r.round, row)
    }
    const data = Array.from(beliefByRound.values()).sort((a, b) => (a.round as number) - (b.round as number)) as Array<{ round: number; [agent: string]: number }>
    return { data, agents: Array.from(agentSet) }
  }, [simRounds])

  return (
    <div className="space-y-3" data-testid="tab-panel-analysis">
      {/* 信念演化多线 LineChart — #belief 锚点 */}
      {simRounds.length > 0 && beliefData.data.length > 0 && beliefData.agents.length > 0 ? (
        <section id="belief" className="card p-4 scroll-mt-28">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500/20 to-accent-500/20 inline-flex items-center justify-center text-brand-600">
              <Activity size={13} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {WORKBENCH.beliefTitle}
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                {WORKBENCH.beliefSubtitle}
              </div>
            </div>
          </div>
          <BeliefEvolutionChart data={beliefData.data} agents={beliefData.agents} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[160px] flex flex-col items-center justify-center">
          <Activity size={24} className="text-ink-300 mb-2" />
          <div className="text-xs text-ink-500">信念演化图表会在推演推进后显示</div>
        </div>
      )}

      {/* 关系网时序图 — #net 锚点 */}
      {networkFrames.length > 0 && (
        <section id="net" className="card p-4 scroll-mt-28">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
              <Network size={13} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {WORKBENCH.networkTitle}
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                {WORKBENCH.networkSubtitle}
              </div>
            </div>
          </div>
          <SimulationNetworkGraph
            runId={runId}
            height={300}
            title={WORKBENCH.networkTitle}
          />
        </section>
      )}

      {/* 风险矩阵热力图 — #risks 锚点 */}
      {reportRisks.length > 0 ? (
        <section id="risks" className="card p-4 scroll-mt-28">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500/20 to-amber-500/20 inline-flex items-center justify-center text-rose-600">
              <Zap size={13} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {WORKBENCH.riskTitle}
              </div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                {WORKBENCH.riskSubtitle}
              </div>
            </div>
          </div>
          <RiskMatrixHeatmap risks={reportRisks} />
        </section>
      ) : (
        <div className="card p-6 text-center min-h-[120px] flex flex-col items-center justify-center">
          <Zap size={24} className="text-ink-300 mb-2" />
          <div className="text-xs text-ink-500">报告生成后, 这里会显示风险矩阵</div>
        </div>
      )}

      {/* 进一步推演 CTA — 仅 completed/failed 显示 */}
      <DeeperSimCta />
    </div>
  )
}