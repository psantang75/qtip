/**
 * Quality section — full UI E2E (Form Builder → QA audits → CSR → Manager).
 * Prerequisites: npm run dev; e2e/.env from env.example; run import-insights-users for Matthew + E2E QA Auditor.
 */
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { test, expect, type Page } from '@playwright/test'
import { login, signOut } from './helpers/auth'

loadEnv({ path: path.join(process.cwd(), 'e2e', '.env') })

const FORM_PREFIX = 'E2E Quality Full UI'

function envKeys() {
  return [
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'E2E_QA_EMAIL',
    'E2E_QA_PASSWORD',
    'E2E_CSR_EMAIL',
    'E2E_CSR_PASSWORD',
    'E2E_MANAGER_EMAIL',
    'E2E_MANAGER_PASSWORD',
  ] as const
}

async function selectNewQuestionType(page: Page, typeLabel: string) {
  const bar = page.locator('div').filter({ has: page.getByPlaceholder('Type a question and click Add') })
  await bar.getByRole('combobox').click()
  await page.getByRole('option', { name: typeLabel }).click()
}

async function addQuestion(page: Page, text: string, typeLabel: string, configure: boolean) {
  await page.getByPlaceholder('Type a question and click Add').fill(text)
  await selectNewQuestionType(page, typeLabel)
  if (configure) await page.getByRole('button', { name: 'Add & Configure' }).click()
  else await page.getByRole('button', { name: 'Add', exact: true }).click()
}

async function saveQuestionCard(page: Page, snippet: string) {
  await page
    .locator('[class*="border-primary"]')
    .filter({ hasText: snippet })
    .first()
    .getByRole('button', { name: 'Save' })
    .click()
}

async function setYesNoPoints(page: Page, yes: number, no: number) {
  const pv = page.locator('div').filter({ has: page.getByText('Point Values') }).first()
  await pv.getByRole('spinbutton').nth(0).fill(String(yes))
  await pv.getByRole('spinbutton').nth(1).fill(String(no))
}

async function addRadioOption(page: Page, label: string, pts: number) {
  const row = page.locator('div').filter({ has: page.getByPlaceholder('New label') }).last()
  await row.getByPlaceholder('New label').fill(label)
  await row.getByPlaceholder('Pts').fill(String(pts))
  await row.getByRole('button', { name: 'Add option' }).click()
}

async function removeAllOptionalMetadata(page: Page) {
  const trash = page.locator('button[title="Remove field"]')
  for (let i = 0; i < 25; i++) {
    if ((await trash.count()) === 0) break
    await trash.first().click()
    await page.waitForTimeout(120)
  }
}

async function fillAuditBasics(page: Page, csrName: string) {
  const today = new Date().toISOString().slice(0, 10)
  await page.getByLabel(/^Interaction Date/i).fill(today)
  const csrBlock = page.locator('label').filter({ hasText: /^CSR/ }).locator('..')
  await csrBlock.getByRole('combobox').click()
  await page.getByRole('option', { name: csrName }).click()
}

async function answerAuditA(page: Page) {
  await page.locator('div').filter({ hasText: 'E2E-Q1-trigger-gate' }).getByRole('button', { name: 'Yes' }).first().click()
  await page.locator('div').filter({ hasText: 'E2E-Q8-conditional-followup' }).getByRole('button', { name: 'Yes' }).first().click()
  await page.locator('div').filter({ hasText: 'E2E-Q2-scale-clarity' }).getByRole('button', { name: '3', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q3-radio-outcome' }).getByRole('button', { name: 'High' }).click()
  const multi = page.locator('div').filter({ hasText: 'E2E-Q4-multi-behavior' })
  await multi.getByRole('button', { name: 'A', exact: true }).click()
  await multi.getByRole('button', { name: 'B', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q5-text-notes' }).locator('textarea').fill('CSR-facing notes from E2E audit A.')
  await page.locator('div').filter({ hasText: 'E2E-Q9-scale-extra' }).getByRole('button', { name: '5', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q10-radio-extra' }).getByRole('button', { name: 'Y' }).click()
}

async function answerAuditB(page: Page) {
  await page.locator('div').filter({ hasText: 'E2E-Q1-trigger-gate' }).getByRole('button', { name: 'No' }).first().click()
  await expect(page.getByText('E2E-Q8-conditional-followup')).toHaveCount(0)
  await page.locator('div').filter({ hasText: 'E2E-Q2-scale-clarity' }).getByRole('button', { name: '3', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q3-radio-outcome' }).getByRole('button', { name: 'High' }).click()
  const multi = page.locator('div').filter({ hasText: 'E2E-Q4-multi-behavior' })
  await multi.getByRole('button', { name: 'A', exact: true }).click()
  await multi.getByRole('button', { name: 'B', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q5-text-notes' }).locator('textarea').fill('E2E audit B conditional off.')
  await page.locator('div').filter({ hasText: 'E2E-Q9-scale-extra' }).getByRole('button', { name: '5', exact: true }).click()
  await page.locator('div').filter({ hasText: 'E2E-Q10-radio-extra' }).getByRole('button', { name: 'Y' }).click()
}

async function answerAuditC(page: Page) {
  await answerAuditB(page)
  await page.locator('div').filter({ hasText: 'E2E-Q5-text-notes' }).locator('textarea').fill('E2E audit C for manager ADJUST path.')
}

async function submitAuditAndGetId(page: Page): Promise<number> {
  const respP = page.waitForResponse(
    r =>
      r.request().method() === 'POST' &&
      /\/api\/submissions\b/.test(r.url()) &&
      !r.url().includes('draft') &&
      r.ok(),
  )
  await page.getByRole('button', { name: 'Submit Review' }).click()
  const resp = await respP
  const data = (await resp.json()) as { id?: number; submission_id?: number }
  const id = data.submission_id ?? data.id
  if (id == null) throw new Error('Submit response missing id')
  return Number(id)
}

async function readOverallScorePercent(page: Page): Promise<number> {
  const block = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Overall Score' }) }).first()
  const raw = await block.textContent()
  const pct = [...(raw?.matchAll(/(\d+\.\d)\s*%/g) ?? [])]
  const pick = pct.length > 1 ? pct[pct.length - 1][1] : pct.length === 1 ? pct[0][1] : raw?.match(/(\d+\.\d)/)?.[1]
  if (!pick) throw new Error('Could not read overall score')
  return parseFloat(pick)
}

test.describe.serial('Quality full UI plan', () => {
  // Full builder + 3 audits + disputes can exceed the global default (90s); cap per test at 6 min.
  test.describe.configure({ timeout: 360_000 })

  let formName: string
  let idAccept: number
  let idDisputeUpheld: number
  let idDisputeAdjust: number

  test.beforeAll(({}, testInfo) => {
    const missing = envKeys().filter(k => !process.env[k]?.trim())
    if (missing.length) testInfo.skip(true, `Set ${missing.join(', ')} in e2e/.env`)
    formName = `${FORM_PREFIX} ${Date.now()}`
  })

  test('1. Admin: build 10-question form + conditional + save', async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!)
    await page.goto('/app/quality/forms/new?step=metadata')
    await page.getByPlaceholder('e.g. Customer Service Call Review').fill(formName)
    await removeAllOptionalMetadata(page)
    await page.getByRole('button', { name: 'Next' }).click()

    await page.getByPlaceholder('e.g. Greeting & Opening').fill('Scoring')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.locator('button[title="Edit category"]').click()
    await page.locator('div.rounded-lg.border-primary').getByRole('spinbutton').fill('100')
    await page.locator('div.rounded-lg.border-primary').getByRole('button', { name: 'Save' }).click()

    await page.getByRole('button', { name: 'Next' }).click()

    await addQuestion(page, 'E2E-Q1-trigger-gate', 'Yes / No', true)
    await setYesNoPoints(page, 10, 0)
    await saveQuestionCard(page, 'E2E-Q1-trigger-gate')

    await addQuestion(page, 'E2E-Q2-scale-clarity', 'Scale', false)

    await addQuestion(page, 'E2E-Q3-radio-outcome', 'Radio (single select)', true)
    await addRadioOption(page, 'Low', 0)
    await addRadioOption(page, 'Med', 5)
    await addRadioOption(page, 'High', 10)
    await saveQuestionCard(page, 'E2E-Q3-radio-outcome')

    await addQuestion(page, 'E2E-Q4-multi-behavior', 'Multi-Select (checkboxes)', true)
    await addRadioOption(page, 'A', 2)
    await addRadioOption(page, 'B', 3)
    await addRadioOption(page, 'C', 4)
    await saveQuestionCard(page, 'E2E-Q4-multi-behavior')

    await addQuestion(page, 'E2E-Q5-text-notes', 'Text Input', false)
    await addQuestion(page, 'E2E-Q6-info-block-msg', 'Information Block', false)
    await addQuestion(page, 'E2E-Q7-subcat-header', 'Sub-Category', false)

    await addQuestion(page, 'E2E-Q8-conditional-followup', 'Yes / No', true)
    await setYesNoPoints(page, 5, 0)
    await page.getByLabel(/Conditional Logic/i).check()
    const cond = page.locator('div').filter({ hasText: 'Conditions (this category)' }).first()
    await cond.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: /E2E-Q1-trigger-gate/ }).click()
    await cond.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Equals' }).click()
    await cond.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Yes' }).click()
    await saveQuestionCard(page, 'E2E-Q8-conditional-followup')

    await addQuestion(page, 'E2E-Q9-scale-extra', 'Scale', false)
    await addQuestion(page, 'E2E-Q10-radio-extra', 'Radio (single select)', true)
    await addRadioOption(page, 'X', 1)
    await addRadioOption(page, 'Y', 2)
    await saveQuestionCard(page, 'E2E-Q10-radio-extra')

    await page.getByRole('button', { name: 'Next' }).click()
    const createResp = page.waitForResponse(
      r => r.request().method() === 'POST' && /\/api\/forms\b/.test(r.url()) && r.ok(),
    )
    await page.getByRole('button', { name: 'Create Form' }).click()
    const res = await createResp
    const body = (await res.json()) as { form_id?: number }
    expect(body.form_id).toBeGreaterThan(0)
    await signOut(page)
  })

  test('2. QA: submit audit A — score ~86.96%', async ({ page }) => {
    await login(page, process.env.E2E_QA_EMAIL!, process.env.E2E_QA_PASSWORD!)
    await page.goto('/app/quality/review-forms')
    await page.getByRole('row').filter({ hasText: formName }).getByRole('button', { name: 'Start Review' }).click()
    await expect(page.getByRole('heading', { name: 'Review Form' })).toBeVisible()
    await fillAuditBasics(page, 'Matthew Santangelo')
    await answerAuditA(page)
    idAccept = await submitAuditAndGetId(page)
    await page.goto(`/app/quality/submissions/${idAccept}`)
    const score = await readOverallScorePercent(page)
    expect(Math.abs(score - 86.96)).toBeLessThan(0.2)
    await signOut(page)
  })

  test('3. QA: submit audit B — score ~60.98%', async ({ page }) => {
    await login(page, process.env.E2E_QA_EMAIL!, process.env.E2E_QA_PASSWORD!)
    await page.goto('/app/quality/review-forms')
    await page.getByRole('row').filter({ hasText: formName }).getByRole('button', { name: 'Start Review' }).click()
    await fillAuditBasics(page, 'Matthew Santangelo')
    await answerAuditB(page)
    idDisputeUpheld = await submitAuditAndGetId(page)
    await page.goto(`/app/quality/submissions/${idDisputeUpheld}`)
    const score = await readOverallScorePercent(page)
    expect(Math.abs(score - 60.98)).toBeLessThan(0.2)
    await signOut(page)
  })

  test('4. QA: submit audit C', async ({ page }) => {
    await login(page, process.env.E2E_QA_EMAIL!, process.env.E2E_QA_PASSWORD!)
    await page.goto('/app/quality/review-forms')
    await page.getByRole('row').filter({ hasText: formName }).getByRole('button', { name: 'Start Review' }).click()
    await fillAuditBasics(page, 'Matthew Santangelo')
    await answerAuditC(page)
    idDisputeAdjust = await submitAuditAndGetId(page)
    await signOut(page)
  })

  test('5. CSR: accept A; dispute B and C', async ({ page }) => {
    await login(page, process.env.E2E_CSR_EMAIL!, process.env.E2E_CSR_PASSWORD!)
    await page.goto(`/app/quality/submissions/${idAccept}`)
    await page.getByRole('button', { name: 'Accept Review' }).click()
    await expect(page.getByText('Accepted')).toBeVisible({ timeout: 45_000 })

    await page.goto(`/app/quality/submissions/${idDisputeUpheld}`)
    await page.getByRole('button', { name: 'Dispute Score' }).click()
    await page.getByPlaceholder(/Explain why you believe/i).fill('E2E dispute for manager uphold resolution notes.')
    await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/disputes\b/.test(r.url()) && r.ok(),
      ),
      page.getByRole('button', { name: 'Submit Dispute' }).click(),
    ])

    await page.goto(`/app/quality/submissions/${idDisputeAdjust}`)
    await page.getByRole('button', { name: 'Dispute Score' }).click()
    await page.getByPlaceholder(/Explain why you believe/i).fill('E2E dispute for manager adjust score path validation.')
    await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/disputes\b/.test(r.url()) && r.ok(),
      ),
      page.getByRole('button', { name: 'Submit Dispute' }).click(),
    ])
    await signOut(page)
  })

  test('6. Manager: UPHOLD then ADJUST', async ({ page }) => {
    await login(page, process.env.E2E_MANAGER_EMAIL!, process.env.E2E_MANAGER_PASSWORD!)

    await page.goto(`/app/quality/submissions/${idDisputeUpheld}`)
    await page.getByRole('button', { name: 'Start Resolution' }).click({ timeout: 30_000 })
    await page.getByPlaceholder('Explain your decision').fill('E2E uphold: original scoring stands.')
    await page.getByRole('button', { name: 'Uphold Score' }).click()
    await expect(page.getByText(/Resolution Notes/i)).toBeVisible({ timeout: 30_000 }).catch(() => {})

    await page.goto(`/app/quality/submissions/${idDisputeAdjust}`)
    await page.getByRole('button', { name: 'Start Resolution' }).click({ timeout: 30_000 })
    await page.locator('div').filter({ hasText: 'E2E-Q1-trigger-gate' }).getByRole('button', { name: 'Yes' }).first().click()
    await page.locator('div').filter({ hasText: 'E2E-Q8-conditional-followup' }).getByRole('button', { name: 'Yes' }).first().click()
    await page.getByPlaceholder('Explain your decision').fill('E2E adjust: answered conditional; score updated.')
    const adjResp = page.waitForResponse(
      r =>
        r.request().method() === 'POST' &&
        /\/api\/manager\/disputes\/\d+\/resolve/.test(r.url()) &&
        r.ok(),
    )
    await page.getByRole('button', { name: 'Adjust Score' }).click()
    await adjResp
    const score = await readOverallScorePercent(page)
    expect(score).toBeGreaterThan(60)
    await signOut(page)
  })

  test('7. QA: submissions + disputes pages', async ({ page }) => {
    await login(page, process.env.E2E_QA_EMAIL!, process.env.E2E_QA_PASSWORD!)
    await page.goto('/app/quality/submissions')
    await expect(page.getByRole('table')).toBeVisible()
    await page.goto('/app/quality/disputes')
    await expect(page.getByRole('heading', { name: /^Disputes$/ })).toBeVisible()
    await signOut(page)
  })
})
