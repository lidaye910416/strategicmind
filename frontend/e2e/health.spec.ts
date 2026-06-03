import { test, expect } from '@playwright/test'

test('backend health endpoint is reachable', async ({ request }) => {
  const r = await request.get('http://127.0.0.1:8761/api/health')
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.status).toBe('ok')
  expect(body.llm.provider).toBeTruthy()
})

test('vite dev server returns the SPA', async ({ page }) => {
  const r = await page.goto('/')
  expect(r?.status()).toBe(200)
  await expect(page).toHaveTitle(/StrategicMind|index/i)
  // The dashboard should render
  await expect(page.locator('h1')).toContainText('StrategicMind')
})

test('dashboard shows upload zone and start button (disabled)', async ({ page }) => {
  await page.goto('/')
  // Upload zone should be visible
  await expect(page.getByText(/Drag.*drop files here/i)).toBeVisible()
  // Start button should be present but disabled (no uploads yet)
  const startBtn = page.getByRole('button', { name: /Start Pipeline/i })
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toBeDisabled()
})

test('config toggle reveals the configuration section', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Config/i }).click()
  await expect(page.getByText('Configuration')).toBeVisible()
  await expect(page.getByLabel(/Simulation hours/i)).toBeVisible()
  await expect(page.getByLabel(/Report style/i)).toBeVisible()
})
