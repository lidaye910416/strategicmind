/**
 * SimulationRoundProgress - Real-time round counter
 * Implements: US-063
 */
interface Props {
  currentRound: number
  totalRounds: number
  activeAgents: number
}

export default function SimulationRoundProgress({ currentRound, totalRounds, activeAgents }: Props) {
  return (
    <div className="round-progress">
      <div className="round-counter">
        <span className="label">Round</span>
        <span className="value">{currentRound} / {totalRounds}</span>
      </div>
      <div className="active-agents">
        <span className="label">Active Agents</span>
        <span className="value">{activeAgents}</span>
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${(currentRound / totalRounds) * 100}%` }} 
        />
      </div>
    </div>
  )
}
