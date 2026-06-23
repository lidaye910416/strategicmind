/**
 * AgentListView - Bug #3 N5 修复测试。
 *
 * 覆盖:
 *   - runId=null → "推演尚未启动"
 *   - variant=compact + 0 agents → empty placeholder
 *   - variant=full + 0 agents → empty placeholder
 *   - variant=compact + 5 agents → 最多渲染 8 条
 *   - variant=full + agents → 完整列表 (含 name/type/influence)
 *   - 单一来源: 不调 /simulation/<id>/clusters (旧 N5 endpoint)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import AgentListView from '../AgentListView'
import { usePipelineStore, type GraphNodeData } from '../../../store/pipeline'

vi.mock('../../../services/http', () => ({
  default: { get: vi.fn() },
}))

beforeEach(() => {
  cleanup()
  usePipelineStore.setState({
    runId: null,
    graphNodes: [],
    graphEdges: [],
    simRounds: [],
  })
})

describe('AgentListView', () => {
  it('shows "推演尚未启动" when runId is null', () => {
    render(<AgentListView runId={null} variant="full" />)
    expect(screen.getByText(/推演尚未启动/)).toBeInTheDocument()
  })

  it('shows compact empty placeholder when no agents (compact)', () => {
    render(<AgentListView runId="r1" variant="compact" />)
    expect(screen.getByTestId('agent-list-empty')).toBeInTheDocument()
  })

  it('shows full empty placeholder when no agents (full)', () => {
    render(<AgentListView runId="r1" variant="full" />)
    expect(screen.getByTestId('agent-list-empty')).toBeInTheDocument()
  })

  it('renders compact list (max 8 items)', () => {
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        type: 'PERSON',
        label: `Agent ${i}`,
        influence: 0.5,
      })) as GraphNodeData[],
    })
    render(<AgentListView runId="r1" variant="compact" />)
    const items = screen.getAllByTestId('agent-list-compact-item')
    expect(items).toHaveLength(8)
  })

  it('renders full list with all fields', () => {
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [
        { id: 'p1', type: 'PERSON', label: 'Alice', influence: 0.7 } as GraphNodeData,
        { id: 'p2', type: 'PERSON', label: 'Bob', influence: 0.4 } as GraphNodeData,
      ],
    })
    render(<AgentListView runId="r1" variant="full" />)
    const items = screen.getAllByTestId('agent-list-full-item')
    expect(items).toHaveLength(2)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // 含 type/influence (Alice + Bob 都是 PERSON type, 用 getAllByText)
    expect(screen.getAllByText(/PERSON/).length).toBeGreaterThan(0)
    expect(screen.getByText(/0\.70/)).toBeInTheDocument()
  })

  it('does NOT fetch /simulation/<id>/clusters (N5 修复)', async () => {
    const http = (await import('../../../services/http')).default
    usePipelineStore.setState({
      runId: 'r1',
      graphNodes: [
        { id: 'p1', type: 'PERSON', label: 'Alice' } as GraphNodeData,
      ],
    })
    render(<AgentListView runId="r1" variant="full" />)
    expect(http.get).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/simulation\/.*\/clusters/),
    )
  })
})
