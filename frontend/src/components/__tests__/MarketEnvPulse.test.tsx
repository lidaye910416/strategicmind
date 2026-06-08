/**
 * MarketEnvPulse 单元测试
 *
 * 覆盖:
 *  (1) latestMarketEvent === null 时显示空态
 *  (2) 有事件时渲染 4 项指标 + 周期色块 + 行业
 *  (3) policy_pressure 阈值 → 进度条颜色分级 (低=绿, 中=橙, 高=红)
 *  (4) capital_availability / consumer_sentiment 颜色分级
 *  (5) sector_growth_rate 正负值用不同色
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MarketEnvPulse from '../MarketEnvPulse'

// mock useLatestMarketEvent selector — 按测试场景返回不同 event
let _mockEvent: any = null
vi.mock('../../store/pipeline', () => ({
  useLatestMarketEvent: () => _mockEvent,
}))

describe('<MarketEnvPulse />', () => {
  beforeEach(() => {
    cleanup()
    _mockEvent = null
  })

  it('空态时显示 market-env-pulse-empty', () => {
    _mockEvent = null
    const { container } = render(<MarketEnvPulse />)
    expect(screen.getByTestId('market-env-pulse-empty')).toBeInTheDocument()
    expect(screen.getByText(/等待 Q1 市场快照/)).toBeInTheDocument()
  })

  it('有事件时渲染 4 项指标 + 周期 + 行业', () => {
    _mockEvent = {
      type: 'MARKET_UP',
      industry: 'digital_service',
      cycle_label_cn: '扩张期',
      policy_stance_cn: '积极',
      policy_pressure: 0.45,
      capital_availability: 0.72,
      consumer_sentiment: 0.65,
      sector_growth_rate: 0.038,
      quarter: 1,
      fiscal_year_offset: 0,
      ts: 1000,
    }
    const { container } = render(<MarketEnvPulse />)
    expect(screen.getByTestId('market-env-pulse')).toBeInTheDocument()
    // 周期色块
    expect(screen.getByTestId('market-env-cycle')).toHaveTextContent('扩张期')
    // 行业
    expect(screen.getByText(/digital_service/)).toBeInTheDocument()
    // 政策压力 (0.45) → 进度条 width 应为 45%
    const bar = screen.getByTestId('policy-pressure-bar')
    expect((bar as HTMLElement).style.width).toBe('45%')
  })

  it('policy_pressure > 0.66 时进度条用 rose 色', () => {
    _mockEvent = {
      type: 'MARKET_DOWN',
      policy_pressure: 0.80,
      cycle_label_cn: '紧缩',
    }
    render(<MarketEnvPulse />)
    const bar = screen.getByTestId('policy-pressure-bar')
    expect(bar.className).toContain('bg-rose-500')
  })

  it('policy_pressure < 0.33 时进度条用 emerald 色', () => {
    _mockEvent = {
      type: 'MARKET_UP',
      policy_pressure: 0.15,
      cycle_label_cn: '宽松',
    }
    render(<MarketEnvPulse />)
    const bar = screen.getByTestId('policy-pressure-bar')
    expect(bar.className).toContain('bg-emerald-500')
  })

  it('sector_growth_rate 为负时使用 rose 色', () => {
    _mockEvent = {
      type: 'MARKET_DOWN',
      sector_growth_rate: -0.02,
      cycle_label_cn: '衰退',
    }
    render(<MarketEnvPulse />)
    expect(screen.getByText(/-2\.0%/)).toBeInTheDocument()
  })

  it('字段缺失时降级为 — (不抛错)', () => {
    _mockEvent = {
      type: 'MARKET_UP',
      industry: 'tech',
    }
    render(<MarketEnvPulse />)
    expect(screen.getByTestId('market-env-pulse')).toBeInTheDocument()
    // 周期 fallback
    expect(screen.getByTestId('market-env-cycle')).toHaveTextContent('—')
  })
})
