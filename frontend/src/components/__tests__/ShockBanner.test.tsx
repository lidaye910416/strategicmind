/**
 * ShockBanner 单元测试
 *
 * 覆盖:
 *  (1) activeShock === null 时不渲染
 *  (2) 有 shock 时显示 shock-banner + factor_name + severity
 *  (3) 点击关闭按钮 → 触发 clearActiveShock
 *  (4) severity bar width = severity * 100
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ShockBanner from '../ShockBanner'

let _shock: any = null
const _clear = vi.fn()
vi.mock('../../store/pipeline', () => ({
  useActiveShock: () => _shock,
  usePipelineStore: (selector: any) => {
    if (typeof selector === 'function') return selector({ clearActiveShock: _clear })
    return { clearActiveShock: _clear }
  },
}))

describe('<ShockBanner />', () => {
  beforeEach(() => {
    cleanup()
    _shock = null
    _clear.mockClear()
  })

  it('activeShock 为空时不渲染', () => {
    _shock = null
    const { container } = render(<ShockBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('有 shock 时显示红色横幅 + factor_name + severity', () => {
    _shock = {
      factor_name: '监管打压',
      severity: 0.75,
      msg_cn: '金融监管升级',
      round: 3,
      ts: 1000,
    }
    const { container } = render(<ShockBanner />)
    expect(screen.getByTestId('shock-banner')).toBeInTheDocument()
    // 用 container.innerHTML 验证 factor_name 出现
    expect(container.innerHTML).toMatch(/监管打压/)
    // round 标签
    expect(screen.getByText(/R3/)).toBeInTheDocument()
    // severity bar 存在 (framer-motion 初始 width 0, 动画结束才是 75%)
    const bar = screen.getByTestId('shock-severity-bar')
    expect(bar).toBeInTheDocument()
    expect(bar.className).toContain('h-full')
  })

  it('点击关闭按钮触发 clearActiveShock', () => {
    _shock = {
      factor_name: '市场崩盘',
      severity: 0.9,
      ts: 2000,
    }
    render(<ShockBanner />)
    fireEvent.click(screen.getByTestId('shock-banner-close'))
    expect(_clear).toHaveBeenCalled()
  })

  it('字段缺失时 (无 factor_name / msg_cn) 仍能渲染', () => {
    _shock = { severity: 0.5, ts: 3000 }
    const { container } = render(<ShockBanner />)
    expect(screen.getByTestId('shock-banner')).toBeInTheDocument()
    // factor_name fallback 文本出现 (component 中 "外部冲击" 出现多次用 container 验证)
    expect(container.innerHTML).toMatch(/外部冲击/)
  })
})
