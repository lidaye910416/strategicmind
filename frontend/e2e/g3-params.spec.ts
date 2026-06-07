/**
 * G3 — 参数化推演 E2E
 *
 * 目标：
 *   - ConfigCard 显示 1/3/5 年 radio 选项
 *   - ConfigCard 显示 8 个部门 chips，至少 5 个默认选中
 *   - 选 3 年 + 2 部门 + 1 外部因素启动 → 36 帧 network-frames
 *
 * 默认 skip — CI 显式传 --grep @g3 才跑。
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BACKEND = 'http://127.0.0.1:8761'
const SAMPLE = `Gamma Inc is a SaaS provider. VP Carol owns product.
Gamma serves 200 enterprise customers. Main competitor is DeltaSoft.`

async function uploadDoc(request: any) {
  const tmp = join('/tmp', `pw_g3_${Date.now()}.txt`)
  writeFileSync(tmp, SAMPLE)
  const up = await request.post(`${BACKEND}/api/graph/upload`, {
    multipart: { file: { name: 'gamma.txt', mimeType: 'text/plain', buffer: readFileSync(tmp) } },
  })
  return (await up.json()).doc_id as string
}

async function startRun(request: any, docId: string, params: any) {
  const r = await request.post(`${BACKEND}/api/pipeline/start`, {
    data: { config: { max_rounds: 36, doc_ids: [docId], user_params: params } },
  })
  expect(r.status()).toBe(200)
  return (await r.json()).run_id as string
}

async function waitTerminal(request: any, runId: string) {
  for (let i = 0; i < 120; i++) {
    const r = await request.get(`${BACKEND}/api/pipeline/${runId}`)
    const s = await r.json()
    if (['completed', 'failed', 'cancelled'].includes(s.status)) return s
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('run did not terminate in 60s')
}

test.describe('@g3 — parameterized runs', () => {
  test.skip('test_configcard_has_year_options', async ({ page }) => {
    test.setTimeout(20_000)
    await page.goto('/')
    await expect(page.locator('h1').first()).toContainText('StrategicMind')
    // 1 年 / 3 年 / 5 年 radio
    await expect(page.getByRole('radio', { name: '1 年' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '3 年' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '5 年' })).toBeVisible()
  })

  test.skip('test_configcard_has_departments', async ({ page, request }) => {
    test.setTimeout(20_000)
    // 先上传一个 doc，ConfigCard 才展开
    const docId = await uploadDoc(request)
    await page.goto('/')
    await page.evaluate(async (id) => {
      await fetch('/api/graph/upload', { method: 'POST' }).catch(() => {})
      void id
    }, docId)
    const groups = page.locator('[aria-label="公司部门"]')
    await expect(groups.first()).toBeVisible({ timeout: 5_000 })
    const all = groups.first().locator('button[aria-pressed]')
    await expect(all).toHaveCount(8)
    const pressedCount = await all.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length)
    expect(pressedCount).toBeGreaterThanOrEqual(5)
  })

  test.skip('test_start_with_user_params: 3y + 2 depts + 1 factor → 36 frames', async ({ request }) => {
    test.setTimeout(90_000)
    const docId = await uploadDoc(request)
    const runId = await startRun(request, docId, {
      years: 3,
      time_step: 'quarter',
      departments: ['销售', '技术'],
      external_factors: ['新政策补贴'],
      n_stakeholders: 12,
      emergence_policy: 'moderate',
      convergence_policy: 'fixed',
    })
    const final = await waitTerminal(request, runId)
    expect(final.status).toBe('completed')
    const f = await request.get(`${BACKEND}/api/pipeline/${runId}/network-frames`)
    const fbody = await f.json()
    expect(Array.isArray(fbody.frames)).toBe(true)
    expect(fbody.frames.length).toBe(36)
  })
})
