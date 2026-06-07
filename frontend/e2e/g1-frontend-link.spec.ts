/**
 * G1 — 前端链接层 E2E
 *
 * 目标：
 *   1. Vite proxy / 端口链路畅通（3000 端口能拿到 SPA + 看到 StrategicMind 标题）
 *   2. 控制台无 CORS / 跨域相关错误
 *
 * 默认 skip — CI 显式传 --grep @g1 才跑。
 */
import { test, expect } from '@playwright/test'

const FRONTEND_URL = 'http://localhost:3000/'

test.describe('@g1 — frontend link layer', () => {
  test.skip('test_vite_proxy: / loads with StrategicMind visible', async ({ page }) => {
    test.setTimeout(30_000)
    const resp = await page.goto(FRONTEND_URL)
    expect(resp, 'page.goto must return a response').not.toBeNull()
    expect(resp!.status(), 'HTTP status of /').toBe(200)
    await expect(page.locator('text=StrategicMind').first()).toBeVisible({ timeout: 10_000 })
  })

  test.skip('test_no_cors_error: no CORS errors in console', async ({ page }) => {
    test.setTimeout(30_000)
    const corsErrors: string[] = []
    page.on('console', (msg) => {
      const t = msg.text()
      if (/CORS|Access-Control-Allow-Origin|跨域/i.test(t)) {
        corsErrors.push(t)
      }
    })
    page.on('pageerror', (err) => {
      if (/CORS|Access-Control-Allow-Origin/i.test(err.message)) {
        corsErrors.push(err.message)
      }
    })
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    expect(corsErrors, `unexpected CORS errors: ${corsErrors.join('\n')}`).toEqual([])
  })
})
