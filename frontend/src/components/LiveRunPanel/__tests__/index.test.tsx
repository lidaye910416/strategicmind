/**
 * LiveRunPanel - Bug #3 拆分测试。
 *
 * 覆盖:
 *   - 命名导出 Graph / Network / Stages 存在
 *   - default LiveRunPanel 渲染 3 个 sub-components
 *   - 旧 LiveRunPanel.tsx shim 输出 deprecation warning (1 release 兼容)
 *   - 旧 compact=true 只渲染 Graph + Network (不含 Stages)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LiveRunPanel, { Graph, Network, Stages } from '../index'
import LegacyLiveRunPanel from '../../LiveRunPanel'
import { usePipelineStore } from '../../../store/pipeline'

vi.mock('../../../services/http', () => ({ default: { get: vi.fn() } }))

// Mock heavy child components so we only test the LiveRunPanel shell
vi.mock('../../graph/RealtimeGraph', () => ({
  default: ({ title }: any) => <div data-testid="realtime-graph">{title}</div>,
}))
vi.mock('../../SimulationNetworkGraph', () => ({
  default: () => <div data-testid="simulation-network" />,
}))
vi.mock('../../StageCards', () => ({
  default: () => <div data-testid="stage-cards" />,
}))

beforeEach(() => {
  cleanup()
  usePipelineStore.setState({ runId: null })
})

describe('LiveRunPanel (split into sub-components)', () => {
  it('exports named Graph, Network, Stages', () => {
    expect(typeof Graph).toBe('function')
    expect(typeof Network).toBe('function')
    expect(typeof Stages).toBe('function')
  })

  it('default LiveRunPanel renders all 3 sub-components when runId present', () => {
    usePipelineStore.setState({ runId: 'r1' })
    render(<LiveRunPanel />)
    expect(screen.getByTestId('realtime-graph')).toBeInTheDocument()
    expect(screen.getByTestId('simulation-network')).toBeInTheDocument()
    expect(screen.getByTestId('stage-cards')).toBeInTheDocument()
  })

  it('renders nothing actionable when runId is null', () => {
    usePipelineStore.setState({ runId: null })
    render(<LiveRunPanel />)
    expect(screen.queryByTestId('realtime-graph')).not.toBeInTheDocument()
    expect(screen.queryByTestId('simulation-network')).not.toBeInTheDocument()
  })
})

describe('LiveRunPanel.tsx legacy shim (1 release deprecation)', () => {
  const wrap = ({ children }: any) => (
    <MemoryRouter>{children}</MemoryRouter>
  )

  it('console.warn on first render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    usePipelineStore.setState({ runId: 'r1' })
    render(<LegacyLiveRunPanel runId="r1" />, { wrapper: wrap })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[LiveRunPanel]'),
    )
    warn.mockRestore()
  })

  it('compact=true renders Graph + Network, NOT Stages', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    usePipelineStore.setState({ runId: 'r1' })
    render(<LegacyLiveRunPanel runId="r1" compact />, { wrapper: wrap })
    expect(screen.getByTestId('realtime-graph')).toBeInTheDocument()
    expect(screen.getByTestId('simulation-network')).toBeInTheDocument()
    expect(screen.queryByTestId('stage-cards')).not.toBeInTheDocument()
  })

  it('show=["stages"] renders all 3', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    usePipelineStore.setState({ runId: 'r1' })
    render(
      <LegacyLiveRunPanel runId="r1" show={['graph', 'network', 'stages']} />,
      { wrapper: wrap },
    )
    expect(screen.getByTestId('realtime-graph')).toBeInTheDocument()
    expect(screen.getByTestId('simulation-network')).toBeInTheDocument()
    expect(screen.getByTestId('stage-cards')).toBeInTheDocument()
  })
})
