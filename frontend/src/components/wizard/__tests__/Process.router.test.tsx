/**
 * Process.router.test.tsx — G9 wizard route + step nav smoke.
 *
 * Verifies that:
 *  1. /process/:runId?step=N mounts the right step
 *  2. Clicking "下一步" pushes ?step=N+1 into the URL via setSearchParams
 *  3. Step nav rail is clickable and updates the URL
 *  4. /process/:runId with no step lands on Step 1
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Stub EventSource so Step5's SSE effect does not blow up.
class StubEventSource {
  onmessage: ((e: any) => void) | null = null
  onerror: (() => void) | null = null
  close() {}
  addEventListener() {}
  // @ts-ignore
  readyState = 1
}
// @ts-ignore
global.EventSource = StubEventSource

// Stub fetch with a deterministic response for trace/status.
const fetchMock = vi.fn(async (input: any) => {
  const url = String(input)
  if (url.includes('/trace?')) {
    return { ok: true, json: async () => [], status: 200 } as any
  }
  if (url.includes('/status')) {
    return { ok: true, json: async () => ({ status: 'completed' }), status: 200 } as any
  }
  if (url.includes('/agents/') && url.endsWith('/message')) {
    return {
      ok: true,
      json: async () => ({
        role: 'agent',
        agent_id: 'dept_product',
        content: 'fake',
        timestamp: '2026-06-29T00:00:00Z',
        metadata: { question: 'q', model: 'stub', latency_ms: 0 },
      }),
      status: 200,
    } as any
  }
  return { ok: false, json: async () => ({}), status: 404 } as any
})
// @ts-ignore
global.fetch = fetchMock

import Process from '../../../views/Process'

function renderAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/process/:runId" element={<Process />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Process wizard routing', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })
  afterEach(() => cleanup())

  it('defaults to step 1 when ?step is missing', () => {
    renderAt('/process/abc')
    expect(screen.getByTestId('step-1')).toBeTruthy()
    expect(screen.getByTestId('wizard-shell').getAttribute('data-current-step')).toBe('1')
  })

  it('mounts the requested step from ?step=N', () => {
    renderAt('/process/abc?step=2')
    expect(screen.getByTestId('step-2')).toBeTruthy()
    expect(screen.queryByTestId('step-1')).toBeNull()
    expect(screen.getByTestId('wizard-shell').getAttribute('data-current-step')).toBe('2')
  })

  it('clicking "下一步" updates the URL with ?step=N+1', () => {
    renderAt('/process/abc?step=1')
    const next = screen.getByTestId('wizard-next')
    act(() => {
      fireEvent.click(next)
    })
    // MemoryRouter will have navigated; the wizard should now show step 2.
    expect(screen.getByTestId('step-2')).toBeTruthy()
  })

  it('clicking a step rail pill updates the URL', () => {
    renderAt('/process/abc?step=1')
    const pill = screen.getByTestId('step-nav-3')
    act(() => {
      fireEvent.click(pill)
    })
    expect(screen.getByTestId('step-3')).toBeTruthy()
  })

  it('step=5 mounts the chat panel', () => {
    renderAt('/process/abc?step=5')
    expect(screen.getByTestId('step-5')).toBeTruthy()
    expect(screen.getByTestId('step-5-transcript')).toBeTruthy()
    expect(screen.getByTestId('step-5-input')).toBeTruthy()
  })

  it('disables Prev on step 1 and Next on step 5', () => {
    renderAt('/process/abc?step=1')
    expect(screen.getByTestId('wizard-prev').hasAttribute('disabled')).toBe(true)
    cleanup()
    renderAt('/process/abc?step=5')
    expect(screen.getByTestId('wizard-next').hasAttribute('disabled')).toBe(true)
  })
})
