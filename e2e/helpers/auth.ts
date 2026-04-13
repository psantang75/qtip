import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const LOGIN_WAIT_MS = 15_000

/**
 * Login via /login. Password field cannot use getByLabel: FormControl wraps Input in a div,
 * so htmlFor points at the div and Playwright never resolves the real input.
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: LOGIN_WAIT_MS })
}

export async function signOut(page: Page) {
  await page.locator('header').getByRole('button').last().click()
  await page.getByRole('menuitem', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: LOGIN_WAIT_MS })
}
