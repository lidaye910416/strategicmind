/**
 * RightRail — Workbench redesign (T2.4) test
 *
 * Coverage per spec:
 *   - 4 sections render in the right order: controls / summary / emerging / next
 *   - An entity_emerged SSE event prepends a row in the "emerging" section
 *     with the first 80 chars of the entity label
 *   - The status badge reflects the current pipeline status
 *   - Pause / Resume / Cancel buttons appear / hide based on status
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

const { usePipelineStore } = await import('../../../store/pipeline')
const { default: RightRail } = await import('../RightRail')
const { WORKBENCH } = await import('../../../i18n/zh')

describe('Workbench/RightRail (T2.4)', () => {
  beforeEach(() => {
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('entity_emerged event prepends a row <= 40px with the first 80 chars', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    // Simulate the SSE delta: append an emergence-sourced node
    act(() => {
      usePipelineStore.getState().appendGraphNode({
        id: 'e1',
        label: 'X'.repeat(120),  // 120 chars
        entity_type: 'COMPANY',
        type: 'COMPANY',
        source: 'emergence',
        round: 5,
      } as any)
    })
    // Re-query (act already flushed)
    const items = screen.getAllByTestId('wb-rail-emerging-item')
    expect(items.length).toBeGreaterThan(0)
    const first = items[0]
    // First 80 chars
    expect(first.textContent).toContain('X'.repeat(80))
    expect(first.textContent).toContain('…')
    // Style maxHeight <= 40px (per CLAUDE.md "list-item <= 40px 高")
    const style = first.getAttribute('style') ?? ''
    expect(style).toContain('max-height: 40px')
  })

  it('shows pause / cancel when status=running', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    expect(screen.getByTestId('wb-rail-btn-pause')).toBeTruthy()
    expect(screen.getByTestId('wb-rail-btn-cancel')).toBeTruthy()
    expect(screen.queryByTestId('wb-rail-btn-resume')).toBeNull()
  })

  it('shows resume (no pause) when status=paused', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'paused' })
    render(<RightRail />)
    expect(screen.getByTestId('wb-rail-btn-resume')).toBeTruthy()
    expect(screen.queryByTestId('wb-rail-btn-pause')).toBeNull()
  })

  it('shows advance-year button when status=completed', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'completed' })
    render(<RightRail />)
    expect(screen.getByTestId('wb-rail-btn-advance')).toBeTruthy()
  })

  it('status badge reflects the current status', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'paused' })
    const { rerender } = render(<RightRail />)
    expect(screen.getByTestId('wb-rail-status-badge').textContent).toBe('暂停')
    usePipelineStore.setState({ status: 'completed' })
    rerender(<RightRail />)
    expect(screen.getByTestId('wb-rail-status-badge').textContent).toBe('完成')
  })

  it('renders 6 sections including new Active Agents + Department Activity', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(<RightRail />)
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(6)
    const ids = Array.from(sections).map((s) => s.getAttribute('data-testid'))
    expect(ids).toEqual([
      'wb-rail-controls',
      'wb-rail-summary',
      'wb-rail-emerging',
      'wb-rail-next',
      'wb-rail-active-agents',
      'wb-rail-department',
    ])
  })

  it('Active Agents section shows empty placeholder when no actions', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(<RightRail />)
    const sec = container.querySelector('[data-testid="wb-rail-active-agents"]')
    expect(sec?.textContent).toContain(WORKBENCH.railActiveAgentsEmpty)
  })

  it('Active Agents section aggregates agents from simRounds actions', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    act(() => {
      usePipelineStore.getState().appendSimRound({
        round: 1,
        actions: [
          { agent_id: 'a1', agent_name: 'CTO 张三', action_type: 'INVEST', department: 'RD' },
          { agent_id: 'a1', agent_name: 'CTO 张三', action_type: 'HIRE', department: 'RD' },
          { agent_id: 'a2', agent_name: 'CMO 李四', action_type: 'MARKET', department: 'MKT' },
        ],
      } as any)
    })
    const items = screen.getAllByTestId('wb-rail-agent-item')
    expect(items.length).toBe(2)
    // 按行动数降序: a1 (2 行动) > a2 (1 行动)
    expect(items[0].textContent).toContain('CTO 张三')
    expect(items[0].textContent).toContain(WORKBENCH.railActiveAgentActionCount(2))
  })

  it('Department Activity section aggregates by department with mini bars', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    act(() => {
      usePipelineStore.getState().appendSimRound({
        round: 1,
        actions: [
          { agent_id: 'a1', department: 'RD', action_type: 'INVEST' },
          { agent_id: 'a2', department: 'RD', action_type: 'HIRE' },
          { agent_id: 'a3', department: 'MKT', action_type: 'MARKET' },
        ],
      } as any)
    })
    const bars = screen.getAllByTestId('wb-rail-dept-bar')
    expect(bars.length).toBe(2)
    // RD 2 行动 > MKT 1 行动
    expect(bars[0].textContent).toContain('RD')
  })
})
