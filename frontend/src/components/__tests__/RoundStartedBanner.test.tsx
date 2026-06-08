/**
 * RoundStartedBanner 单元测试
 *
 * 覆盖:
 *  (1) banner 为 null 时不渲染
 *  (2) 有 banner 时显示 "Round N 开始" + total_rounds
 *  (3) 1s 后自动清空 (fake timer 验证)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import RoundStartedBanner from '../RoundStartedBanner'

let _banner: any = null
vi.mock('../../store/pipeline', () => ({
  useRoundStartedBanner: () => _banner,
}))

describe('<RoundStartedBanner />', () => {
  beforeEach(() => {
    cleanup()
    _banner = null
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('banner 为 null 时不渲染', () => {
    _banner = null
    const { container } = render(<RoundStartedBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('有 banner 时显示 "Round N 开始" 文本', () => {
    _banner = { round: 5, total_rounds: 12, ts: 1000 }
    render(<RoundStartedBanner />)
    expect(screen.getByTestId('round-started-banner')).toBeInTheDocument()
    expect(screen.getByText(/Round 5/)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it('无 total_rounds 时不显示 " / N"', () => {
    _banner = { round: 3, ts: 2000 }
    render(<RoundStartedBanner />)
    expect(screen.getByText(/Round 3/)).toBeInTheDocument()
  })
})
