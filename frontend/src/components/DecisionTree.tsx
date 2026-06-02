/**
 * StrategicDecisionTree - Tree visualization of decision options
 * Implements: US-101
 */
interface DecisionNode {
  name: string
  outcome: 'positive' | 'negative' | 'neutral'
  children?: DecisionNode[]
  probability?: number
}

interface Props {
  tree: DecisionNode
}

export default function DecisionTree({ tree }: Props) {
  const outcomeColor = (outcome: string) => {
    const o = outcome.toLowerCase()
    if (o === 'positive') return '#4caf50'
    if (o === 'negative') return '#f44336'
    return '#9e9e9e'
  }

  const renderNode = (node: DecisionNode, depth: number = 0): JSX.Element => (
    <div key={node.name} className="decision-node" style={{ marginLeft: depth * 20 }}>
      <div 
        className="node-content"
        style={{ borderColor: outcomeColor(node.outcome) }}
      >
        <span className="node-name">{node.name}</span>
        {node.probability !== undefined && (
          <span className="node-prob">{(node.probability * 100).toFixed(0)}%</span>
        )}
        <span className="node-outcome" style={{ color: outcomeColor(node.outcome) }}>
          {node.outcome}
        </span>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="node-children">
          {node.children.map(child => renderNode(child, depth + 1))}
        </div>
      )}
    </div>
  )

  return <div className="decision-tree">{renderNode(tree)}</div>
}
