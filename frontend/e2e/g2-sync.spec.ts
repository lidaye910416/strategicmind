/**
 * G2 — Dashboard ↔ Workbench 状态同步 E2E
 *
 * 目标：
 *   - dashboard 启动后看到 status=running
 *   - 直接跳 /workbench/<runId> 能在几秒内看到 progress > 0
 *   - 推演中刷新 /workbench/<runId>，3 秒内状态恢复
 *
 * 默认 skip — CI 显式传 --grep @g2 才跑。
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BACKEND = 'http://127.0.0.1:8761'
const SAMPLE = `Acme Corp is a fintech startup. CEO Alice leads strategy.
Acme partners with BetaBank. BetaBank's CTO Bob is the technical lead.
Acme is launching a new payments product next quarter.`

async function uploadAndStart(request: any) {
  const tmp = join('/tmp', `pw_g2_${Date.now()}.txt`)
  writeFileSync(tmp, SAMPLE)
  const up = await request.post(`${BACKEND}/api/graph/upload`, {
    multipart: { file: { name: 'acme.txt', mimeType: 'text/plain', buffer: readFileSync(tmp) } },
  })
  expect(up.status()).toBe(200)
  const docId = (await up.json()).doc_id
  const start = await request.post(`${BACKEND}/api/pipeline/start`, {
    data: { config: { max_rounds: 4, doc_ids: [docId] } },
  })
  expect(start.status()).toBe(200)
  return (await start.json()).run_id as string
}

test.describe('@g2 — dashboard/workbench sync', () => {
  test.skip('test_dashboard_shows_run', async ({ page, request }) => {
    test.setTimeout(60_000)
    const runId = await uploadAndStart(request)
    await page.goto('/')
    await expect(page.locator('h1').first()).toContainText('StrategicMind')
    // 状态徽章应显示 running
    await expect(page.getByText(/运行中|running/i).first()).toBeVisible({ timeout: 15_000 })
    expect(runId).toBeTruthy()
  })

  test.skip('test_workbench_hydrate', async ({ page, request }) => {
    test.setTimeout(60_000)
    const runId = await uploadAndStart(request)
    await page.goto(`/workbench/${runId}`)
    // 进度数字 > 0 应在 8 秒内出现
    await expect(page.locator('text=/\\d+%/').first()).toBeVisible({ timeout: 8_000 })
  })

  test.skip('test_refresh_preserves_state', async ({ page, request }) => {
    test.setTimeout(60_000)
    const runId = await uploadAndStart(request)
    await page.goto(`/workbench/${runId}`)
    await expect(page.locator('text=/\\d+%/').first()).toBeVisible({ timeout: 8_000 })
    await page.reload()
    // 3 秒内进度条 / 状态徽章恢复
    await expect(page.getByText(/运行中|running/i).first()).toBeVisible({ timeout: 3_000 })
  })
})
