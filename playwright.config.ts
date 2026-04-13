import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

loadEnv({ path: path.join(process.cwd(), 'e2e', '.env') })

const defaultTestTimeout = parseInt(process.env.E2E_TEST_TIMEOUT_MS ?? '90000', 10)

/**
 * Quick loop: `npm run test:e2e:smoke` (~30s) while coding.
 * Full Quality UI: `npm run test:e2e:quality` (each test in that file sets a longer timeout).
 * Override: E2E_TEST_TIMEOUT_MS=300000
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: defaultTestTimeout,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
