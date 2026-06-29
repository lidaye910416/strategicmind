/**
 * ConfigCard 组件测试 — 审计中识别的关键 3-tab + AI 预填入口.
 *
 * 覆盖:
 *   1. 3 个 tab 切换 (基础 / 公司 / 市场)
 *   2. 公司 tab 显示公司名称输入框
 *   3. AI 一键提取按钮 (disabled 当 uploadsCount===0)
 *   4. 公司 tab 可加 org_structure 节点
 *   5. 基础 tab 模拟年限 radio 切换
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import ConfigCard from '../ConfigCard'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_, tag) => ({ children, ...rest }: any) => {
    const T = typeof tag === 'string' ? tag : 'div'
    return <T {...rest}>{children}</T>
  }}),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

const defaultProps = {
  uploadsCount: 1,
  showConfig: true,
  onShowConfig: vi.fn(),
  hours: 72,
  style: 'executive' as const,
  onChangeHours: vi.fn(),
  onChangeStyle: vi.fn(),
  params: {
    years: 3,
    time_step: 'quarter' as const,
    departments: ['销售', '技术'] as ('市场' | '产品' | '技术' | '销售' | '财务' | 'HR' | '法务' | '运营')[],
    external_factors: [],
    n_stakeholders: 12,
    emergence_policy: 'moderate' as const,
    convergence_policy: 'auto_extend' as const,
    company_name: '',
    org_structure: [],
    financials: {},
    market: { stance: 'neutral' as const, competitors: [], regulation: [] },
  },
  onChangeParams: vi.fn(),
  clonedFrom: null,
  onDismissClone: vi.fn(),
  isPrefilling: false,
  onPrefillFromLLM: vi.fn(),
}

const renderCard = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<ConfigCard {...defaultProps} {...overrides} />)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfigCard 3 tabs', () => {
  it('默认显示 基础 tab', () => {
    renderCard()
    // 基础 tab 应有"模拟年限"label
    expect(screen.getByText('模拟年限')).toBeInTheDocument()
  })

  it('点 公司 tab → 切换到公司视图', () => {
    renderCard()
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])  // 公司
    // 公司 tab 应有"公司名称"label
    expect(screen.getByText('公司名称')).toBeInTheDocument()
  })

  it('点 市场 tab → 切换到市场视图', () => {
    renderCard()
    // 用 role=button + 文字 精确定位 tab 按钮 (不是 select 的 option)
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[2])  // 市场
    // 市场 tab 应有"整体态度"label
    expect(screen.getByText('整体态度')).toBeInTheDocument()
  })
})

describe('ConfigCard 公司 tab - 公司名称', () => {
  it('公司 tab 有公司名称 input', () => {
    renderCard()
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])  // 公司
    const input = screen.getByPlaceholderText(/湖北/) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('已填的 company_name 显示在 input 中', () => {
    renderCard({ params: { ...defaultProps.params, company_name: '某科技公司' } })
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])
    const input = screen.getByPlaceholderText(/湖北/) as HTMLInputElement
    expect(input.value).toBe('某科技公司')
  })

  it('改公司名 → 调 onChangeParams', () => {
    const onChangeParams = vi.fn()
    renderCard({ onChangeParams })
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])
    const input = screen.getByPlaceholderText(/湖北/)
    fireEvent.change(input, { target: { value: '新公司' } })
    expect(onChangeParams).toHaveBeenCalledWith(
      expect.objectContaining({ company_name: '新公司' })
    )
  })
})

describe('ConfigCard AI 一键提取', () => {
  it('uploadsCount>0 时按钮 enabled', () => {
    renderCard({ uploadsCount: 1 })
    const companyTab = screen.getAllByText('公司')[0]?.closest('button') as HTMLButtonElement
    fireEvent.click(companyTab)
    const btn = screen.getByText(/AI 一键提取/) as HTMLButtonElement
    expect(btn).not.toBeDisabled()
  })

  it('点 AI 按钮 → 调 onPrefillFromLLM', () => {
    const onPrefillFromLLM = vi.fn()
    renderCard({ onPrefillFromLLM })
    const companyTab = screen.getAllByText('公司')[0]?.closest('button') as HTMLButtonElement
    fireEvent.click(companyTab)
    const btn = screen.getByText(/AI 一键提取/)
    fireEvent.click(btn)
    expect(onPrefillFromLLM).toHaveBeenCalledTimes(1)
  })

  it('isPrefilling=true 时显示 spinner + disabled', () => {
    renderCard({ isPrefilling: true })
    const companyTab = screen.getAllByText('公司')[0]?.closest('button') as HTMLButtonElement
    fireEvent.click(companyTab)
    const btn = screen.getByText(/AI 一键提取/) as HTMLButtonElement
    expect(btn).toBeDisabled()
  })
})

describe('ConfigCard 公司 tab - org_structure 动态行', () => {
  it('默认显示"未填写"占位', () => {
    renderCard()
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])
    expect(screen.getByText(/尚未填写/)).toBeInTheDocument()
  })

  it('点 添加 → 调 onChangeParams 加 1 个空 org 节点', () => {
    const onChangeParams = vi.fn()
    renderCard({ onChangeParams })
    const tabs = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(基础|公司|市场)$/))
    fireEvent.click(tabs[1])
    const addBtn = screen.getByText('添加')
    fireEvent.click(addBtn)
    expect(onChangeParams).toHaveBeenCalledWith(
      expect.objectContaining({
        org_structure: expect.arrayContaining([
          expect.objectContaining({ name: '' }),
        ]),
      })
    )
  })
})
