/**
 * ShockToast 单元测试
 *
 * 覆盖:
 *  (1) shocks 为空时不渲染
 *  (2) 单条 shock 渲染时显示 factor_name + description
 *  (3) severity >= 0.7 显示"高" 严重度
 *  (4) severity 0.3-0.7 显示"中" 严重度
 *  (5) severity < 0.3 显示"低" 严重度
 *  (6) 点击 X 按钮消失
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ShockToast from '../ShockToast'
import type { ShockEvent } from '../../store/pipeline'

describe('<ShockToast />', () => {
  beforeEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shocks 为空时不渲染 (零侵入)', () => {
    const { container } = render(<ShockToast shocks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('单条 shock 渲染时显示 factor_name + description', () => {
    const shocks: ShockEvent[] = [
      { factor_name: '汇率波动', severity: 0.5, description: '美元对人民币汇率上升 5%', ts: 1000 },
    ]
    render(<ShockToast shocks={shocks} />)
    expect(screen.getByTestId('shock-toast')).toBeInTheDocument()
    expect(screen.getByText('汇率波动')).toBeInTheDocument()
    expect(screen.getByText('美元对人民币汇率上升 5%')).toBeInTheDocument()
  })

  it('severity >= 0.7 显示"高" 严重度', () => {
    const shocks: ShockEvent[] = [
      { factor_name: '重大事件', severity: 0.85, ts: 1 },
    ]
    const { container } = render(<ShockToast shocks={shocks} />)
    expect(screen.getByText(/严重度 高/)).toBeInTheDocument()
    expect(container.textContent).toContain('85')
  })

  it('severity 0.3-0.7 显示"中" 严重度', () => {
    const shocks: ShockEvent[] = [
      { factor_name: '中等事件', severity: 0.5, ts: 1 },
    ]
    render(<ShockToast shocks={shocks} />)
    expect(screen.getByText(/严重度 中/)).toBeInTheDocument()
  })

  it('severity < 0.3 显示"低" 严重度', () => {
    const shocks: ShockEvent[] = [
      { factor_name: '轻微事件', severity: 0.1, ts: 1 },
    ]
    render(<ShockToast shocks={shocks} />)
    expect(screen.getByText(/严重度 低/)).toBeInTheDocument()
  })

  it('点击 X 按钮消失 (dismiss)', () => {
    const shocks: ShockEvent[] = [
      { factor_name: 'X-test', severity: 0.5, ts: 1 },
    ]
    const { container } = render(<ShockToast shocks={shocks} />)
    expect(screen.getByTestId('shock-toast')).toBeInTheDocument()
    const xButton = screen.getByLabelText('dismiss')
    fireEvent.click(xButton)
    expect(container.firstChild).toBeNull()
  })
})
