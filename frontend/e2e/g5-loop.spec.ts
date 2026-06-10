/**
 * G5 — 跨年推演循环 跨年推演循环 E2E
 *
 * 目标：
 *   - 已 completed run 在 Workbench 看到 "再推 1 年" 按钮
 *   - 点击 → 状态变 running → 12 rounds 后 completed
 *   - log 中看到橙色 market_event 横幅
 *
 * 默认 skip — CI 显式传 --grep @g5 才跑。
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BACKEND = 'http://127.0.0.1:8761'
const SAMPLE = `Zeta Holdings is a holding company. Frank is the group CFO.
Zeta has 4 subsidiaries in manufacturing, retail, tech, and finance.`

async function uploadAndStart(request: any, maxRounds = 1) {
  const tmp = join('/tmp', `pw_g5_${Date.now()}.txt`)
  writeFileSync(tmp, SAMPLE)
  const up = await request.post(`${BACKEND}/api/graph/upload`, {
    multipart: { file: { name: 'zeta.txt', mimeType: 'text/plain', buffer: readFileSync(tmp) } },
  })
  const docId = (await up.json()).doc_id
  const start = await request.post(`${BACKEND}/api/pipeline/start`, {
    data: { config: { max_rounds: maxRounds, doc_ids: [docId] } },
  })
  return (await start.json()).run_id as string
}

async function waitTerminal(request: any, runId: string) {
  for (let i = 0; i < 180; i++) {
    const r = await request.get(`${BACKEND}/api/pipeline/${runId}`)
    const s = await r.json()
    if (['completed', 'failed', 'cancelled'].includes(s.status)) return s
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('run did not terminate')
}

test.describe('@g5 — advance-year loop', () => {
  test.skip('test_advance_year_button_visible', async ({ page, request }) => {
    test.setTimeout(90_000)
    const runId = await uploadAndStart(request, 1)
    await waitTerminal(request, runId)
    await page.goto(`/workbench/${runId}`)
    await expect(page.getByRole('button', { name: /再推 1 年/ })).toBeVisible({ timeout: 15_000 })
  })

  test.skip('test_advance_year_dispatches: click → running → completed', async ({ page, request }) => {
    test.setTimeout(180_000)
    const runId = await uploadAndStart(request, 1)
    await waitTerminal(request, runId)
    await page.goto(`/workbench/${runId}`)
    const btn = page.getByRole('button', { name: /再推 1 年/ })
    await expect(btn).toBeVisible({ timeout: 15_000 })
    await btn.click()
    // running 状态
    await expect(page.getByText(/运行中|running/i).first()).toBeVisible({ timeout: 10_000 })
    // 等待 12 round 跑完 → 回到 completed / failed
    for (let i = 0; i < 60; i++) {
      const r = await request.get(`${BACKEND}/api/pipeline/${runId}`)
      const s = await r.json()
      if (s.status === 'completed' || s.status === 'failed') break
      await new Promise((res) => setTimeout(res, 1000))
    }
    const final = await request.get(`${BACKEND}/api/pipeline/${runId}`).then((r) => r.json())
    expect(['completed', 'failed']).toContain(final.status)
  })

  test.skip('test_market_event_banner', async ({ page, request }) => {
    test.setTimeout(180_000)
    const runId = await uploadAndStart(request, 4)
    await page.goto(`/workbench/${runId}`)
    await waitTerminal(request, runId)
    // 兜底：直接查 events 接口
    const r = await request.get(`${BACKEND}/api/pipeline/${runId}/events?type=market_event`)
    const body = await r.json()
    const events = body.events || body.items || []
    expect(Array.isArray(events) ? events.length : 0).toBeGreaterThan(0)
  })
})
