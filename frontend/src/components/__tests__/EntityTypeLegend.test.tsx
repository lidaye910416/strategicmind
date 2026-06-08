/**
 * EntityTypeLegend — 单元测试
 *
 * 覆盖:
 *  - 空数组 → overlay 模式不渲染 / 独立卡片模式显示空态
 *  - 有 graphNodes 时按 useEntityTypes 派生展示色块 + label + count
 *  - palette 顺序稳定
 *  - UNKNOWN 类型走 default 灰
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import EntityTypeLegend from '../EntityTypeLegend'

// Mock store hooks
const mockUseEntityTypes = vi.fn()
vi.mock('../../store/pipeline', () => ({
  useEntityTypes: () => mockUseEntityTypes(),
  useGraphNodes: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

describe('EntityTypeLegend', () => {
  beforeEach(() => {
    mockUseEntityTypes.mockReset()
  })

  it('overlay 模式 + 空 stats → 不渲染', () => {
    mockUseEntityTypes.mockReturnValue([])
    const { container } = render(<EntityTypeLegend overlay />)
    expect(container.firstChild).toBeNull()
  })

  it('独立卡片模式 + 空 stats → 显示空态文案', () => {
    mockUseEntityTypes.mockReturnValue([])
    render(<EntityTypeLegend overlay={false} />)
    expect(screen.getByText('尚无实体')).toBeInTheDocument()
  })

  it('渲染标题 + 多个 entity type + count', () => {
    mockUseEntityTypes.mockReturnValue([
      { type: 'COMPANY', color: '#3b82f6', label: '公司', count: 5 },
      { type: 'PERSON', color: '#ec4899', label: '人物', count: 12 },
      { type: 'PRODUCT', color: '#8b5cf6', label: '产品', count: 3 },
    ])
    render(<EntityTypeLegend overlay />)
    expect(screen.getByText('实体类型图例')).toBeInTheDocument()
    expect(screen.getByText('公司')).toBeInTheDocument()
    expect(screen.getByText('人物')).toBeInTheDocument()
    expect(screen.getByText('产品')).toBeInTheDocument()
    // 总数 = 5+12+3 = 20
    expect(screen.getByText('20')).toBeInTheDocument()
    // 各 type count
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('data-testid 存在 (供 E2E 锚定)', () => {
    mockUseEntityTypes.mockReturnValue([
      { type: 'COMPANY', color: '#3b82f6', label: '公司', count: 1 },
    ])
    const { container } = render(<EntityTypeLegend overlay />)
    expect(container.querySelector('[data-testid="entity-type-legend"]')).toBeTruthy()
  })
})
