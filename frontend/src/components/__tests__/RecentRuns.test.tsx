/**
 * RecentRuns 组件测试 — 审计中识别的关键 affordance.
 *
 * 覆盖: (1) 卡片 body 点击 → /workbench + replay:true
 *      (2) 右侧 Report link 不冒泡触发卡片点击
 *      (3) 复制配置 → /?cloneConfig=<id>
 *      (4) 删除流程 (Trash → Check)
 *      (5) formatRelative 相对时间 (通过 DOM 时间显示验证)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()
const mockGet = vi.fn()
const mockDelete = vi.fn().mockResolvedValue({ data: { ok: true } })

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

vi.mock('../../lib/featureFlags', () => ({
  flags: { compareRuns: true },
}))

import RecentRuns from '../RecentRuns'

const RUNS_FIXTURE = [
  {
    run_id: 'run_aaa111',
    status: 'completed',
    updated_at: Math.floor(Date.now() / 1000) - 30,
    config_summary: { years: 1, departments_count: 3, external_factors_count: 0, report_style: 'executive' },
  },
  {
    run_id: 'run_bbb222',
    status: 'failed',
    updated_at: Math.floor(Date.now() / 1000) - 86400 * 3,
    config_summary: { years: 3, departments_count: 5, external_factors_count: 2, report_style: 'technical' },
  },
  {
    run_id: 'run_ccc333',
    status: 'running',
    updated_at: Math.floor(Date.now() / 1000) - 600,
    config_summary: { years: 1, departments_count: 2, external_factors_count: 0, report_style: 'narrative' },
  },
]

const renderComponent = () =>
  render(
    <MemoryRouter>
      <RecentRuns />
    </MemoryRouter>
  )

const waitForCards = async () => {
  await waitFor(() => {
    const cards = document.querySelectorAll('li[role="button"]')
    if (cards.length < 3) throw new Error('not enough cards yet')
    return true
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  mockGet.mockResolvedValue({ data: { count: 3, runs: RUNS_FIXTURE } })
})

describe('RecentRuns 渲染', () => {
  it('加载后渲染 3 张 card (role=button)', async () => {
    renderComponent()
    await waitForCards()
    expect(document.querySelectorAll('li[role="button"]').length).toBe(3)
  })
})

describe('RecentRuns 卡片点击 → Workbench', () => {
  it('点击卡片 body → 跳 /workbench/<id> + state.replay=true', async () => {
    renderComponent()
    await waitForCards()
    const cards = document.querySelectorAll('li[role="button"]')
    fireEvent.click(cards[0])

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const [path, opts] = mockNavigate.mock.calls[0]
    expect(path).toBe('/workbench/run_aaa111')
    expect(opts.state).toEqual({ replay: true })
  })

  it('右侧 Report 链接点击 → 不触发卡片导航 (closest(a) 拦截)', async () => {
    renderComponent()
    await waitForCards()
    const reportLink = document.querySelector('a[href^="/report/"]') as HTMLElement
    expect(reportLink).toBeTruthy()
    fireEvent.click(reportLink)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('复制配置图标 → 跳 /?cloneConfig=<id>', async () => {
    renderComponent()
    await waitForCards()
    const copyBtn = document.querySelector('button[title*="复制"]') as HTMLElement
    expect(copyBtn).toBeTruthy()
    fireEvent.click(copyBtn)
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('cloneConfig=run_aaa111'))
  })
})

describe('RecentRuns 删除', () => {
  it('点 Trash → 出现 Check 确认按钮', async () => {
    renderComponent()
    await waitForCards()
    const trash = document.querySelector('button[title="删除"]') as HTMLElement
    expect(trash).toBeTruthy()
    fireEvent.click(trash)
    await waitFor(() => {
      expect(document.querySelector('button[title="确认删除"]')).toBeInTheDocument()
    })
  })
})

describe('RecentRuns 相对时间', () => {
  // 用一个明确"已经过去"的安全时长, 避免测试运行时 Date.now() 漂移
  // (30s 在测试慢时可能变成 35s, 但 formatRelative 阈值是 60s, 所以 "刚刚" 仍稳定)
  it('30秒前 → "刚刚"', async () => {
    renderComponent()
    await waitForCards()
    // 至少 1 张卡片显示 "刚刚" (run_aaa111 30s ago)
    expect(screen.getAllByText('刚刚').length).toBeGreaterThan(0)
  })

  it('10分钟前 → "10 分钟前"', async () => {
    // 改 fixture: run_aaa111 改为 10 分钟前
    mockGet.mockResolvedValueOnce({
      data: {
        count: 1,
        runs: [{
          run_id: 'run_test_10min',
          status: 'completed',
          updated_at: Math.floor(Date.now() / 1000) - 600,
          config_summary: { years: 1, departments_count: 1, external_factors_count: 0, report_style: 'executive' },
        }],
      },
    })
    renderComponent()
    await waitFor(() => screen.getByText(/10 分钟前/))
  })

  it('3天前 → "3 天前"', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        count: 1,
        runs: [{
          run_id: 'run_test_3d',
          status: 'completed',
          updated_at: Math.floor(Date.now() / 1000) - 86400 * 3,
          config_summary: { years: 1, departments_count: 1, external_factors_count: 0, report_style: 'executive' },
        }],
      },
    })
    renderComponent()
    await waitFor(() => screen.getByText(/3 天前/))
  })
})
