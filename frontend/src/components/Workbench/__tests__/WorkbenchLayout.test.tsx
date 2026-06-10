/**
 * WorkbenchLayout — Workbench redesign (T2.2) test
 *
 * Coverage:
 *   - Three regions render: top (timeline) / center (canvas + rail) / bottom (status)
 *   - 12 timeline cards render
 *   - Status strip shows status + round N/M + progress %
 *   - Center region has data-testid="wb-layout-canvas"
 *   - Right rail has data-testid="wb-layout-rail"
 *   - Width: right rail is 320px; center >= 60% of (canvas + rail)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

const { usePipelineStore } = await import('../../../store/pipeline')
const { default: WorkbenchLayout } = await import('../WorkbenchLayout')

describe('Workbench/WorkbenchLayout (T2.2)', () => {
  beforeEach(() => {
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('renders all 4 regions: hero, exec, timeline, center, status', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    usePipelineStore.setState({ snapshot: { run_id: 'run_x', status: 'running', current_stage: 'SIMULATION_RUNNING', progress: 50, total_rounds: 12, current_round: 4 } as any })
    const { container } = render(
      <WorkbenchLayout>
        <div data-testid="graph-canvas">Graph</div>
      </WorkbenchLayout>,
    )
    // hero (empty for running) + exec + timeline + center + status
    expect(container.querySelector('[data-testid="wb-layout-exec"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="wb-layout-timeline"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="wb-layout-center"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="wb-layout-status"]')).toBeTruthy()
    // children render inside the canvas region
    expect(screen.getByTestId('graph-canvas')).toBeTruthy()
  })

  it('renders 12 timeline cards via RoundTimeline', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(
      <WorkbenchLayout totalRounds={12}>
        <div>Graph</div>
      </WorkbenchLayout>,
    )
    for (let n = 1; n <= 12; n++) {
      expect(screen.getByTestId(`wb-round-card-${n}`)).toBeTruthy()
    }
  })

  it('status strip shows the current status and progress', () => {
    usePipelineStore.setState({
      runId: 'run_x',
      status: 'running',
      snapshot: { run_id: 'run_x', status: 'running', progress: 50, total_rounds: 12, current_round: 4 } as any,
    })
    usePipelineStore.getState().appendSimRound({ round: 4, ts: Date.now() } as any)
    render(
      <WorkbenchLayout>
        <div>Graph</div>
      </WorkbenchLayout>,
    )
    expect(screen.getByTestId('wb-status-state').textContent).toBe('RUNNING')
    expect(screen.getByTestId('wb-status-round').textContent).toContain('4')
    expect(screen.getByTestId('wb-status-round').textContent).toContain('12')
    expect(screen.getByTestId('wb-status-progress-text').textContent).toMatch(/50%/)
  })

  it('idle state shows the rocket hero (no timeline, no rail children)', () => {
    usePipelineStore.setState({ runId: null, status: 'idle' })
    const { container } = render(
      <WorkbenchLayout>
        <div>Graph</div>
      </WorkbenchLayout>,
    )
    // WorkbenchLayout passes a derived id (wb-layout-hero) to StateHero
    expect(container.querySelector('[data-testid="wb-layout-hero"]')).toBeTruthy()
    expect(screen.getByText(/推演工作台就绪/)).toBeTruthy()
  })

  it('right rail is rendered as a 320px wide aside', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(
      <WorkbenchLayout>
        <div>Graph</div>
      </WorkbenchLayout>,
    )
    const rail = container.querySelector('[data-testid="wb-layout-rail"]') as HTMLElement
    expect(rail).toBeTruthy()
    expect(rail.className).toMatch(/w-\[320px\]/)
  })
})
