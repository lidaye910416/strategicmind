/**
 * vitest 全局 setup：jsdom 环境 + zustand store 测试隔离
 */
import { afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

// 全局 EventSource mock（SSE 内部使用；store 测试场景不触发，但 hydrate 可能开）
class MockEventSource {
  url: string
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 1
  constructor(url: string) {
    this.url = url
  }
  close() { this.readyState = 2 }
}
// @ts-ignore
globalThis.EventSource = MockEventSource

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
