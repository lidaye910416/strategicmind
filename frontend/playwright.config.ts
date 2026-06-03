import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'cd .. && STRATEGICMIND_LLM_OVERRIDE=backend.tests.mocks.mock_llm_provider.MockLLMProvider PORT=8761 python3 -m backend.run_server',
    url: 'http://127.0.0.1:8761/api/health',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
