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
interface Props { tree: DecisionNode }

const OUTCOME_LABELS: Record<string, string> = {
  positive: '正向',
  negative: '负向',
  neutral: '中性',
}

const OUTCOME_STYLES = {
  positive: { border: 'border-green-400', text: 'text-green-700', bg: 'bg-green-50' },
  negative: { border: 'border-red-400', text: 'text-red-700', bg: 'bg-red-50' },
  neutral: { border: 'border-gray-300', text: 'text-gray-600', bg: 'bg-gray-50' },
}

export default function DecisionTree({ tree }: Props) {
  const renderNode = (node: DecisionNode, depth = 0): JSX.Element => {
    const s = OUTCOME_STYLES[node.outcome] || OUTCOME_STYLES.neutral
    return (
      <div key={node.name} className="my-1" style={{ marginLeft: depth * 24 }}>
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border ${s.border} ${s.bg} text-sm`}>
          <span className="font-medium text-gray-900">{node.name}</span>
          {node.probability !== undefined && (
            <span className="text-xs text-gray-500">{(node.probability * 100).toFixed(0)}%</span>
          )}
          <span className={`text-xs font-semibold ${s.text}`}>{OUTCOME_LABELS[node.outcome] || node.outcome}</span>
        </div>
        {node.children && node.children.length > 0 && (
          <div className="border-l-2 border-gray-200 ml-3 pl-2">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }
  return <div className="overflow-x-auto">{renderNode(tree)}</div>
}
