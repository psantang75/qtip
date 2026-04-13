/**
 * Fast sanity check: auth + Quality routes (~30s). Run: npm run test:e2e:smoke
 */
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { test, expect } from '@playwright/test'
import { login, signOut } from './helpers/auth'

loadEnv({ path: path.join(process.cwd(), 'e2e', '.env') })

test.describe('Quality smoke', () => {
  test.beforeEach(({}, testInfo) => {
    const need = ['E2E_QA_EMAIL', 'E2E_QA_PASSWORD'] as const
    const miss = need.filter(k => !process.env[k]?.trim())
    if (miss.length) testInfo.skip(true, `Set ${miss.join(', ')} in e2e/.env`)
  })

  test('QA can open Review Forms and Submissions', async ({ page }) => {
    test.setTimeout(45_000)
    await login(page, process.env.E2E_QA_EMAIL!, process.env.E2E_QA_PASSWORD!)

    await page.goto('/app/quality/review-forms', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Review Forms' })).toBeVisible()

    await page.goto('/app/quality/submissions', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('table')).toBeVisible()

    await signOut(page)
  })
})
