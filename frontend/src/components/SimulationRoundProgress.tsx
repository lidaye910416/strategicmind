/**
 * SimulationRoundProgress - Real-time round counter
 * Implements: US-063
 */
interface Props { currentRound: number; totalRounds: number; activeAgents: number }

export default function SimulationRoundProgress({ currentRound, totalRounds, activeAgents }: Props) {
  const pct = totalRounds > 0 ? (currentRound / totalRounds) * 100 : 0
  return (
    <div className="card grid grid-cols-2 md:grid-cols-3 gap-4">
      <div>
        <div className="text-xs text-gray-500">Round</div>
        <div className="text-2xl font-bold text-gray-900">{currentRound} <span className="text-base text-gray-400">/ {totalRounds}</span></div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Active agents</div>
        <div className="text-2xl font-bold text-brand-700">{activeAgents}</div>
      </div>
      <div className="col-span-2 md:col-span-1 flex items-center">
        <div className="w-full">
          <div className="text-xs text-gray-500 mb-1">Progress</div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
