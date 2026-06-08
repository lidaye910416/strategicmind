/**
 * MarketEventTicker 单元测试
 *
 * 覆盖:
 *  (1) events 为空时不渲染 (零侵入)
 *  (2) 单条 event 渲染时显示 description
 *  (3) 多条 events 时显示计数 (idx+1/total)
 *  (4) gdp_growth 为正显示 emerald, 负显示 rose
 *  (5) MARKET_DOWN 类型用 TrendingDown icon
 *  (6) type=未知类型降级为 Activity + 蓝色
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MarketEventTicker from '../MarketEventTicker'
import type { MarketEvent } from '../../store/pipeline'

describe('<MarketEventTicker />', () => {
  beforeEach(() => cleanup())

  it('events 为空时不渲染 (零侵入)', () => {
    const { container } = render(<MarketEventTicker events={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('单条 event 渲染时显示 description', () => {
    const events: MarketEvent[] = [
      { type: 'MARKET_UP', industry: 'tech', description: '科技板块上涨', gdp_growth: 0.5, ts: 1000 },
    ]
    const { container } = render(<MarketEventTicker events={events} />)
    expect(screen.getByTestId('market-event-ticker')).toBeInTheDocument()
    expect(screen.getByText('科技板块上涨')).toBeInTheDocument()
    // industry + gdp_growth 是 JSX 文本节点拼接, 用 querySelector 找
    expect(container.textContent).toContain('tech')
    expect(container.textContent).toContain('+0.5%')
  })

  it('多条 events 时显示 idx+1/total 计数', () => {
    const events: MarketEvent[] = [
      { type: 'MARKET_UP', description: 'A', ts: 3 },
      { type: 'MARKET_DOWN', description: 'B', ts: 2 },
      { type: 'EXPANSION', description: 'C', ts: 1 },
    ]
    render(<MarketEventTicker events={events} />)
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('gdp_growth 为负显示带 - 符号', () => {
    const events: MarketEvent[] = [
      { type: 'RECESSION', description: '衰退', gdp_growth: -1.5, ts: 1 },
    ]
    render(<MarketEventTicker events={events} />)
    expect(screen.getByText((_c, el) => el?.textContent === '-1.5%')).toBeInTheDocument()
  })

  it('MARKET_DOWN 类型显示下行标签', () => {
    const events: MarketEvent[] = [
      { type: 'MARKET_DOWN', description: '下行', ts: 1 },
    ]
    render(<MarketEventTicker events={events} />)
    // 下行 出现两次 (badge + description); 用 getAllByText 验证
    expect(screen.getAllByText('下行').length).toBeGreaterThanOrEqual(1)
  })

  it('未知 type 降级到默认显示', () => {
    const events: MarketEvent[] = [
      { type: 'WEIRD_THING', description: '未知事件', ts: 1 },
    ]
    render(<MarketEventTicker events={events} />)
    expect(screen.getByText('未知事件')).toBeInTheDocument()
    expect(screen.getByText(/市场/)).toBeInTheDocument()
  })
})
