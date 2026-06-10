/**
 * RealtimeKnowledgeGraph — 30s polling toggle (SSE 兜底) 单元测试
 *
 * 覆盖 (3 个 case):
 *  (1) refreshIntervalMs=0 (默认) → 不启动 setInterval, 不重复调 graph-snapshot
 *  (2) refreshIntervalMs=30000 → 启动 setInterval, 每 30s 调一次 graph-snapshot
 *  (3) 卸载时 clearInterval (interval cleanup on unmount)
 *
 * 策略: 完整渲染 RealtimeKG 会触发 rAF force-simulation 但仅在 nodes.length>0 时,
 *       store 默认可控为空, 走通. 关键是用 mockApiGet 计数 + fake timer 推进.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'

// 在 import 组件前先 mock api
const mockApiGet = vi.fn()
vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

// mock framer-motion 减少动画相关副作用
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => React.createElement('div', props, children),
    g: ({ children, ...props }: any) => React.createElement('g', props, children),
    circle: ({ children, ...props }: any) => React.createElement('circle', props, children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}))

import RealtimeKnowledgeGraph from '../RealtimeKnowledgeGraph'

function makeSnapshotResponse(nodeCount = 0) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`, label: `Node ${i}`, type: 'COMPANY', index: i,
  }))
  return { data: { nodes, edges: [], stage: 'GRAPH_BUILDING' } }
}

describe('RealtimeKnowledgeGraph — 30s polling toggle (SSE 兜底)', () => {
  beforeEach(() => {
    cleanup()
    mockApiGet.mockReset()
    mockApiGet.mockResolvedValue(makeSnapshotResponse(0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshIntervalMs=0 (默认): 不启动 setInterval, 不重复调 graph-snapshot', async () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <RealtimeKnowledgeGraph runId="run_test_001" refreshIntervalMs={0} />,
    )
    // 让启动时 useEffect 拉一次的 promise resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsAfterMount = mockApiGet.mock.calls.length
    // 推 90s (远大于 30s 间隔), 若有 setInterval 早就 fire 3 次
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000)
    })
    const callsAfter90s = mockApiGet.mock.calls.length
    // 只在挂载时拉一次, 不应增长
    expect(callsAfter90s).toBe(callsAfterMount)
    unmount()
  })

  it('refreshIntervalMs=30000: 启动 setInterval, 每 30s 调一次 graph-snapshot', async () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <RealtimeKnowledgeGraph runId="run_test_002" refreshIntervalMs={30_000} />,
    )
    // 启动时 useEffect 拉一次
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = mockApiGet.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)
    // 推 30.5s → 应触发 1 次额外 polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_500)
    })
    expect(mockApiGet.mock.calls.length).toBe(initialCalls + 1)
    // 推 60s (累计 90.5s) → 应再触发 2 次 (60s / 30s = 2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockApiGet.mock.calls.length).toBe(initialCalls + 1 + 2)
    // 所有调用都打到 graph-snapshot
    for (const call of mockApiGet.mock.calls) {
      expect(call[0]).toMatch(/graph-snapshot$/)
    }
    unmount()
  })

  it('卸载时 clearInterval (cleanup on unmount)', async () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <RealtimeKnowledgeGraph runId="run_test_003" refreshIntervalMs={30_000} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsBeforeUnmount = mockApiGet.mock.calls.length
    unmount()
    // 卸载后推 60s, 调用数应不变 (interval 已 cleanup)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockApiGet.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
