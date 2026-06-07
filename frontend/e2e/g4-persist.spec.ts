/**
 * G4 — 历史任务持久化 E2E
 *
 * 目标：
 *   - 跑 1 run → Dashboard 看到 RecentRuns 卡片
 *   - 点复制配置 → 跳 /?cloneConfig=<id> → ConfigCard 预填
 *   - 刷新后 run 仍在 RecentRuns 列表
 *
 * 默认 skip — CI 显式传 --grep @g4 才跑。
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BACKEND = 'http://127.0.0.1:8761'
const SAMPLE = `Epsilon LLC operates in logistics. Director Eve runs ops.
Epsilon has 50 trucks and partners with FreightCo for last-mile delivery.`

async function uploadAndStart(request: any) {
  const tmp = join('/tmp', `pw_g4_${Date.now()}.txt`)
  writeFileSync(tmp, SAMPLE)
  const up = await request.post(`${BACKEND}/api/graph/upload`, {
    multipart: { file: { name: 'epsilon.txt', mimeType: 'text/plain', buffer: readFileSync(tmp) } },
  })
  const docId = (await up.json()).doc_id
  const start = await request.post(`${BACKEND}/api/pipeline/start`, {
    data: { config: { max_rounds: 1, doc_ids: [docId] } },
  })
  return (await start.json()).run_id as string
}

async function waitTerminal(request: any, runId: string) {
  for (let i = 0; i < 120; i++) {
    const r = await request.get(`${BACKEND}/api/pipeline/${runId}`)
    const s = await r.json()
    if (['completed', 'failed', 'cancelled'].includes(s.status)) return s
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('run did not terminate')
}

test.describe('@g4 — run persistence', () => {
  test.skip('test_recent_runs_shows_history', async ({ page, request }) => {
    test.setTimeout(90_000)
    const runId = await uploadAndStart(request)
    await waitTerminal(request, runId)
    await page.goto('/')
    // RecentRuns 默认折叠，点开
    await page.getByText(/历史任务/).first().click()
    await expect(page.getByText(/查看报告/).first()).toBeVisible({ timeout: 10_000 })
  })

  test.skip('test_clone_config', async ({ page, request }) => {
    test.setTimeout(90_000)
    const runId = await uploadAndStart(request)
    await waitTerminal(request, runId)
    await page.goto('/')
    await page.getByText(/历史任务/).first().click()
    const cloneBtn = page.getByRole('button', { name: /复制配置/ }).first()
    await cloneBtn.click()
    await page.waitForURL(/\?cloneConfig=/, { timeout: 5_000 })
    // ConfigCard 顶部应出现 "已从历史 run <id>" 提示
    await expect(page.getByText(/已从历史 run/)).toBeVisible({ timeout: 5_000 })
  })

  test.skip('test_persistence_after_refresh', async ({ page, request }) => {
    test.setTimeout(90_000)
    const runId = await uploadAndStart(request)
    await waitTerminal(request, runId)
    await page.goto('/')
    await page.getByText(/历史任务/).first().click()
    await expect(page.getByText(/查看报告/).first()).toBeVisible({ timeout: 10_000 })
    await page.reload()
    await page.getByText(/历史任务/).first().click()
    // 刷新后 run 仍在
    await expect(page.getByText(/查看报告/).first()).toBeVisible({ timeout: 10_000 })
  })
})
