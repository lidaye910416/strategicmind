/**
 * DeeperSimCta 单元测试
 *
 * 覆盖：
 *   1) !runId → null
 *   2) status=running → null
 *   3) simRounds 空 + status=completed → 1 个 fallback 建议
 *   4) status=completed + simRounds>=1 → 3 个建议卡片
 *   5) 点击应用 → 调用 startPipeline 并合并 overrides 到 lastRunConfig.user_params
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('../../../services/http', () => ({
  default: {
    get: mockGet,
    post: mockPost,
  },
}))

const { usePipelineStore } = await import('../../../store/pipeline')
import DeeperSimCta from '../DeeperSimCta'

class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
}
// @ts-ignore
global.EventSource = StubEventSource

function renderCta() {
  return render(
    <MemoryRouter>
      <DeeperSimCta />
    </MemoryRouter>,
  )
}

describe('DeeperSimCta', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    usePipelineStore.getState().reset()
    usePipelineStore.getState().resetGraphStream()
  })

  it('!runId → 渲染 null', () => {
    const { container } = renderCta()
    expect(container.querySelector('[data-testid="deeper-sim-cta"]')).toBeNull()
  })

  it('status=running → 渲染 null', () => {
    usePipelineStore.setState({
      runId: 'r1',
      status: 'running',
    })
    const { container } = renderCta()
    expect(container.querySelector('[data-testid="deeper-sim-cta"]')).toBeNull()
  })

  it('status=completed + simRounds 空 → 1 个 fallback 建议', () => {
    usePipelineStore.setState({
      runId: 'r1',
      status: 'completed',
    })
    renderCta()
    const cards = screen.getAllByTestId(/^deeper-sim-card-/)
    expect(cards).toHaveLength(1)
    expect(screen.getByTestId('deeper-sim-card-fallback')).toBeTruthy()
  })

  it('status=completed + simRounds>=1 → focus + iterate 卡片 (无 risk 实体时)', () => {
    usePipelineStore.setState({
      runId: 'r1',
      status: 'completed',
      simRounds: [
        { round: 1, belief_updates: [{ entity_id: 'e1', delta: 0.5 }], ts: Date.now() } as any,
      ],
    })
    renderCta()
    const cards = screen.getAllByTestId(/^deeper-sim-card-/)
    // focus (因 belief 有 shift) + iterate (总是) = 2; risk 需新风险因子
    expect(cards).toHaveLength(2)
    expect(screen.getByTestId('deeper-sim-card-focus')).toBeTruthy()
    expect(screen.getByTestId('deeper-sim-card-iterate')).toBeTruthy()
  })

  it('点击应用 → 调用 startPipeline, overrides 合并到 lastRunConfig.user_params', async () => {
    usePipelineStore.setState({
      runId: 'r1',
      status: 'completed',
      simRounds: [
        { round: 1, belief_updates: [{ entity_id: 'e1', delta: 0.5 }], ts: Date.now() } as any,
      ],
      lastRunConfig: { user_params: { years: 1 }, simulation_hours: 72 },
    })
    mockPost.mockResolvedValueOnce({ data: { run_id: 'r2' } })

    renderCta()
    // 找到 focus 卡片的 apply 按钮
    const focusApply = screen.getByTestId('deeper-sim-apply-focus')
    fireEvent.click(focusApply)

    // 等待异步 startPipeline 完成
    await new Promise((r) => setTimeout(r, 50))

    expect(mockPost).toHaveBeenCalled()
    // 验证 startPipeline 被传入合并后的 config
    const s = usePipelineStore.getState()
    expect(s.lastRunConfig).toBeDefined()
    expect((s.lastRunConfig as any).user_params.focus_entity).toBe('e1')
  })
})
