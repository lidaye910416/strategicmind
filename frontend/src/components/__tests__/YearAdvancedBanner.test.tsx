/**
 * YearAdvancedBanner 单元测试
 *
 * 覆盖:
 *  (1) yearAdvanced === null 不渲染
 *  (2) 显示年份 + rounds_added
 *  (3) entities_count > 0 显示"本轮新涌现实体 N 个"
 *  (4) entities_count = 0 或 undefined 不显示实体计数
 *  (5) 点击 X 调用 clearYearAdvanced
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import YearAdvancedBanner from '../YearAdvancedBanner'
import { usePipelineStore } from '../../store/pipeline'
import type { YearAdvancedEvent } from '../../store/pipeline'

describe('<YearAdvancedBanner />', () => {
  beforeEach(() => {
    cleanup()
    usePipelineStore.setState({ yearAdvanced: null } as any)
    vi.restoreAllMocks()
  })

  it('yearAdvanced === null 不渲染 (零侵入)', () => {
    const { container } = render(<YearAdvancedBanner yearAdvanced={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('显示年份 + rounds_added', () => {
    const ev: YearAdvancedEvent = { year: 2, rounds_added: 12, ts: 1000 }
    render(<YearAdvancedBanner yearAdvanced={ev} />)
    expect(screen.getByTestId('year-advanced-banner')).toBeInTheDocument()
    expect(screen.getByText(/第 2 年/)).toBeInTheDocument()
    expect(screen.getByText(/12 季度市场事件/)).toBeInTheDocument()
  })

  it('entities_count > 0 显示"本轮新涌现实体 N 个"', () => {
    const ev: YearAdvancedEvent = { year: 1, rounds_added: 4, entities_count: 7, ts: 1000 }
    render(<YearAdvancedBanner yearAdvanced={ev} />)
    expect(screen.getByText(/7/)).toBeInTheDocument()
    expect(screen.getByText(/本轮新涌现实体/)).toBeInTheDocument()
  })

  it('entities_count = 0 不显示实体计数', () => {
    const ev: YearAdvancedEvent = { year: 1, rounds_added: 4, entities_count: 0, ts: 1000 }
    render(<YearAdvancedBanner yearAdvanced={ev} />)
    expect(screen.queryByText(/本轮新涌现实体/)).toBeNull()
  })

  it('entities_count = undefined 不显示实体计数', () => {
    const ev: YearAdvancedEvent = { year: 1, rounds_added: 4, ts: 1000 }
    render(<YearAdvancedBanner yearAdvanced={ev} />)
    expect(screen.queryByText(/本轮新涌现实体/)).toBeNull()
  })

  it('点击 X 调用 clearYearAdvanced (清空 store)', () => {
    const ev: YearAdvancedEvent = { year: 1, rounds_added: 4, ts: 1000 }
    const spy = vi.spyOn(usePipelineStore.getState(), 'clearYearAdvanced')
    render(<YearAdvancedBanner yearAdvanced={ev} />)
    const xButton = screen.getByLabelText('close')
    fireEvent.click(xButton)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
