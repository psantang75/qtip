/**
 * Insights — Quality validation runner.
 *
 * Authenticates as Admin (ALL scope), hits every QC Quality endpoint at the
 * golden-slice scope (department + form + month), diffs each value against
 * the hand-computed expectations from docs/insights-validation/quality.md,
 * and writes a PASS/FAIL table back into that report between the
 * <!-- API_DIFF_BEGIN --> / <!-- API_DIFF_END --> markers.
 *
 * Usage:
 *   ts-node backend/scripts/insights-validate-quality.ts
 *
 * Env (all optional — defaults match e2e/.env):
 *   E2E_BASE_API       default http://localhost:3000
 *   E2E_ADMIN_EMAIL    default e2e-admin@dm-us.com
 *   E2E_ADMIN_PASSWORD default ChangeMe123!
 *
 * No new dependencies — uses Node's built-in fetch (Node 18+).
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Slice constants (mirror docs/insights-validation/quality.md §1) ──────────

const SLICE = {
  userId:     23,
  username:   'Marc Joseph',
  deptId:     2,
  deptName:   'Tech Support',
  formId:     259,
  formName:   'Contact Call Review Form',
  start:      '2026-02-01',
  end:        '2026-02-28',
} as const

// Expected values from the hand-computed report. Keep in sync with
// docs/insights-validation/quality.md §2.
const EXPECTED = {
  kpis_dept: {
    avg_qa_score:                   94.526667,
    audits_completed:               99,
    audits_assigned:                300,
    audit_completion_rate:          33.0000,
    dispute_rate:                   10.1010,
    dispute_upheld_rate:            30.0000,
    dispute_adjusted_rate:          70.0000,
    avg_dispute_resolution_time:    4.7000,
  } as Record<string, number>,
  trends_dept_avg_qa: [
    { month: 'Sep 25', value: null },
    { month: 'Oct 25', value: null },
    { month: 'Nov 25', value: 90.3053 },
    { month: 'Dec 25', value: 96.6538 },
    { month: 'Jan 26', value: 96.7590 },
    { month: 'Feb 26', value: 94.5267 },
  ],
  trends_user_avg_qa: [
    { month: 'Sep 25', value: null },
    { month: 'Oct 25', value: null },
    { month: 'Nov 25', value: 96.0093 },
    { month: 'Dec 25', value: 97.6486 },
    { month: 'Jan 26', value: 97.9680 },
    { month: 'Feb 26', value: 96.0674 },
  ],
  scoreDist_dept: [
    { bucket: '60-69', count: 2 },
    { bucket: '70-79', count: 4 },
    { bucket: '80-89', count: 14 },
    { bucket: '90-100', count: 79 },
  ],
  scoreDist_slice: [
    { bucket: '70-79', count: 1 },
    { bucket: '90-100', count: 26 },
  ],
  categoryScores_slice: [
    { category: 'Initial Greeting / Customer Verification',                audits: 27, avgScore: 93.5 },
    { category: 'Contact Management',                                      audits: 27, avgScore: 80.0 },
    { category: 'CRM / Knowledge Base',                                    audits: 27, avgScore: 71.3 },
    { category: 'Product / Service Knowledge and Problem Solving Ability', audits: 27, avgScore: 98.1 },
    { category: 'Call Transfer / Hold Procedures',                         audits: 27, avgScore: 95.7 },
    { category: 'Wrap-Up Process',                                         audits: 27, avgScore: 95.1 },
    { category: 'Professionalism / Rapport',                               audits: 27, avgScore: 98.1 },
    { category: 'Ticket / Task Documentation',                             audits: 27, avgScore: 95.3 },
    { category: 'Work From Home Policy',                                   audits: 27, avgScore: 100.0 },
  ],
  formScores_dept: [
    { form: 'Contact Call Review Form', submissions: 99, avgScore: 94.5 },
  ],
  deptComparison_all: [
    { dept: 'Tech Support',     audits: 99,  avgScore: 94.5, disputes: 9 },
    { dept: 'Customer Service', audits: 205, avgScore: 92.9, disputes: 20 },
  ],
}

// ── HTTP helpers (built-in fetch, no axios needed) ───────────────────────────

const BASE = process.env.E2E_BASE_API || 'http://localhost:3000'
const EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@dm-us.com'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'ChangeMe123!'
const FALLBACKS: Array<{ email: string; password: string }> = [
  { email: 'petes@dm-us.com', password: 'ChangeMe123!' },
]

let cookieJar = ''
let csrfToken = ''
let bearer = ''

function mergeSetCookies(setCookies: string[] | null) {
  if (!setCookies) return
  const map = new Map<string, string>()
  if (cookieJar) {
    for (const part of cookieJar.split(';').map(s => s.trim()).filter(Boolean)) {
      const eq = part.indexOf('=')
      if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1))
    }
  }
  for (const sc of setCookies) {
    const first = sc.split(';')[0]
    const eq = first.indexOf('=')
    if (eq > 0) map.set(first.slice(0, eq), first.slice(eq + 1))
  }
  cookieJar = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function getCsrf(): Promise<void> {
  const res = await fetch(`${BASE}/api/csrf-token`, { method: 'GET' })
  // Node 18+ exposes set-cookie via headers.getSetCookie() (Node 20+) — fall
  // back to raw header parsing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (res.headers as any).getSetCookie?.() ?? res.headers.get('set-cookie')?.split(/,(?=[^;]+=)/)
  mergeSetCookies(Array.isArray(sc) ? sc : (sc ? [sc] : null))
  const body = await res.json() as { csrfToken: string }
  csrfToken = body.csrfToken
}

async function login(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': csrfToken,
      Cookie: cookieJar,
    },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.log(`  Login failed for ${email}: ${res.status} ${text.slice(0, 120)}`)
    return false
  }
  const body = await res.json() as { token: string; user: { email: string; id: number; role: string } }
  bearer = body.token
  console.log(`  Logged in as ${body.user.email} (id=${body.user.id}, role=${body.user.role})`)
  return true
}

async function authedGet<T>(pathname: string, query: Record<string, string | number | undefined>): Promise<T> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v))
  const url = `${BASE}${pathname}?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'X-XSRF-TOKEN': csrfToken,
      Cookie: cookieJar,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GET ${url} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return await res.json() as T
}

// ── Diff helpers ─────────────────────────────────────────────────────────────

interface DiffRow { area: string; field: string; expected: string; actual: string; pass: boolean }
const rows: DiffRow[] = []

function fmtNum(v: number | null | undefined, decimals = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'null'
  return Number(v).toFixed(decimals).replace(/\.?0+$/, m => m.startsWith('.') ? '' : m)
}

function approx(actual: number | null | undefined, expected: number | null, tol = 0.001): boolean {
  if (expected === null) return actual === null || actual === undefined
  if (actual === null || actual === undefined) return false
  return Math.abs(Number(actual) - expected) <= tol
}

function record(area: string, field: string, expected: number | string | null, actual: number | string | null, pass: boolean) {
  rows.push({
    area,
    field,
    expected: typeof expected === 'number' ? fmtNum(expected) : (expected === null ? 'null' : String(expected)),
    actual:   typeof actual   === 'number' ? fmtNum(actual)   : (actual   === null ? 'null' : String(actual)),
    pass,
  })
}

// ── Validation runs ──────────────────────────────────────────────────────────

interface KpiResp { current: Record<string, number | null>; prior: Record<string, number | null>; meta: { businessDays: number; paceTarget: number | null; startDate: string; endDate: string } }
interface TrendRow { label: string; [code: string]: number | string | null }
interface BucketRow { bucket: string; count: number }
interface CatRow { category: string; form: string; audits: number; avgScore: number | null; priorScore: number | null }
interface FormRow { id: number; form: string; submissions: number; avgScore: number | null }
interface DeptCmpRow { dept: string; audits: number; avgScore: number | null; disputes: number }

async function validateKpis() {
  console.log('\n─── KPIs (dept = Tech Support, Feb 2026) ───')
  const data = await authedGet<KpiResp>('/api/insights/qc/kpis', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    departments: SLICE.deptId,
  })
  for (const [code, expected] of Object.entries(EXPECTED.kpis_dept)) {
    const actual = data.current[code]
    const pass = approx(actual, expected, 0.01)
    record('KPIs (dept)', code, expected, actual ?? null, pass)
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${code}: expected ${fmtNum(expected)}, got ${fmtNum(actual)}`)
  }
  // Confirm meta
  const metaPass = data.meta.businessDays === 20 && data.meta.paceTarget === 15
  record('KPIs (dept)', 'meta.businessDays/paceTarget', '20/15', `${data.meta.businessDays}/${data.meta.paceTarget}`, metaPass)
  console.log(`  ${metaPass ? 'PASS' : 'FAIL'}  meta.businessDays/paceTarget: expected 20/15, got ${data.meta.businessDays}/${data.meta.paceTarget}`)
}

async function validateTrends() {
  console.log('\n─── Trends — dept (avg_qa_score) ───')
  const dept = await authedGet<TrendRow[]>('/api/insights/qc/trends', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    kpis: 'avg_qa_score',
    departments: SLICE.deptId,
  })
  for (const exp of EXPECTED.trends_dept_avg_qa) {
    const row = dept.find(r => r.label === exp.month)
    const actual = row ? (row['avg_qa_score'] as number | null) : undefined
    const pass = approx(actual ?? null, exp.value, 0.01)
    record('Trends (dept)', exp.month, exp.value, actual ?? null, pass)
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${exp.month}: expected ${fmtNum(exp.value)}, got ${fmtNum(actual)}`)
  }

  console.log('\n─── Trends — slice user (avg_qa_score) ───')
  const user = await authedGet<TrendRow[]>('/api/insights/qc/trends', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    kpis: 'avg_qa_score',
    departments: SLICE.deptId,
    userId: SLICE.userId,
  })
  for (const exp of EXPECTED.trends_user_avg_qa) {
    const row = user.find(r => r.label === exp.month)
    const actual = row ? (row['avg_qa_score'] as number | null) : undefined
    const pass = approx(actual ?? null, exp.value, 0.01)
    record('Trends (slice user)', exp.month, exp.value, actual ?? null, pass)
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${exp.month}: expected ${fmtNum(exp.value)}, got ${fmtNum(actual)}`)
  }
}

async function validateScoreDistribution() {
  console.log('\n─── Score distribution (dept) ───')
  const buckets = await authedGet<BucketRow[]>('/api/insights/qc/quality/score-distribution', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    departments: SLICE.deptId,
  })
  for (const exp of EXPECTED.scoreDist_dept) {
    const found = buckets.find(b => b.bucket === exp.bucket)
    const pass = !!found && found.count === exp.count
    record('Score dist (dept)', exp.bucket, exp.count, found?.count ?? null, pass)
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${exp.bucket}: expected ${exp.count}, got ${found?.count ?? 'missing'}`)
  }
}

async function validateCategoryScores() {
  console.log('\n─── Category scores (slice user) ───')
  const data = await authedGet<CatRow[]>('/api/insights/qc/quality/categories', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    departments: SLICE.deptId,
    forms: SLICE.formName,
    userId: SLICE.userId,
  })
  for (const exp of EXPECTED.categoryScores_slice) {
    const found = data.find(d => d.category === exp.category)
    const auditsPass = !!found && found.audits === exp.audits
    const scorePass  = approx(found?.avgScore ?? null, exp.avgScore, 0.05)
    record('Categories (slice)', `${exp.category} — audits`,   exp.audits,   found?.audits   ?? null, auditsPass)
    record('Categories (slice)', `${exp.category} — avgScore`, exp.avgScore, found?.avgScore ?? null, scorePass)
    console.log(`  ${auditsPass && scorePass ? 'PASS' : 'FAIL'}  ${exp.category}: audits ${exp.audits} / score ${exp.avgScore} → got ${found?.audits}/${found?.avgScore}`)
  }
}

async function validateFormScores() {
  console.log('\n─── Form scores (dept) ───')
  const data = await authedGet<FormRow[]>('/api/insights/qc/quality/forms', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
    departments: SLICE.deptId,
  })
  for (const exp of EXPECTED.formScores_dept) {
    const found = data.find(d => d.form === exp.form)
    const subsPass  = !!found && found.submissions === exp.submissions
    const scorePass = approx(found?.avgScore ?? null, exp.avgScore, 0.05)
    record('Form scores (dept)', `${exp.form} — submissions`, exp.submissions, found?.submissions ?? null, subsPass)
    record('Form scores (dept)', `${exp.form} — avgScore`,    exp.avgScore,    found?.avgScore    ?? null, scorePass)
    console.log(`  ${subsPass && scorePass ? 'PASS' : 'FAIL'}  ${exp.form}: ${exp.submissions} subs / ${exp.avgScore} → got ${found?.submissions}/${found?.avgScore}`)
  }
}

async function validateDeptComparison() {
  console.log('\n─── Department comparison (ALL scope) ───')
  const data = await authedGet<DeptCmpRow[]>('/api/insights/qc/quality/dept-comparison', {
    period: 'custom', start: SLICE.start, end: SLICE.end,
  })
  for (const exp of EXPECTED.deptComparison_all) {
    const found = data.find(d => d.dept === exp.dept)
    const auditsPass   = !!found && found.audits   === exp.audits
    const scorePass    = approx(found?.avgScore ?? null, exp.avgScore, 0.05)
    const disputesPass = !!found && found.disputes === exp.disputes
    record('Dept comparison', `${exp.dept} — audits`,   exp.audits,   found?.audits   ?? null, auditsPass)
    record('Dept comparison', `${exp.dept} — avgScore`, exp.avgScore, found?.avgScore ?? null, scorePass)
    record('Dept comparison', `${exp.dept} — disputes`, exp.disputes, found?.disputes ?? null, disputesPass)
    console.log(`  ${auditsPass && scorePass && disputesPass ? 'PASS' : 'FAIL'}  ${exp.dept}: ${exp.audits}/${exp.avgScore}/${exp.disputes} → got ${found?.audits}/${found?.avgScore}/${found?.disputes}`)
  }
}

async function validateMissedQuestions() {
  console.log('\n─── Missed questions snapshot (dept) ───')
  const data = await authedGet<Array<{ questionId: number; question: string; form: string; missed: number; total: number; missRate: number }>>(
    '/api/insights/qc/quality/missed-questions',
    { period: 'custom', start: SLICE.start, end: SLICE.end, departments: SLICE.deptId },
  )
  // No fixed expectation — we capture as a snapshot for human review.
  console.log(`  ${data.length} top-missed rows captured (snapshot only).`)
  for (const r of data.slice(0, 5)) {
    console.log(`    Q${r.questionId}: ${r.question.slice(0, 60)} — ${r.missed}/${r.total} (${r.missRate}%)`)
  }
  rows.push({
    area: 'Missed questions',
    field: 'rows returned',
    expected: '>= 0 (snapshot)',
    actual: String(data.length),
    pass: true,
  })
}

// ── Markdown writer ──────────────────────────────────────────────────────────

function buildMarkdown(): string {
  const totalChecks = rows.length
  const passed = rows.filter(r => r.pass).length
  const failed = totalChecks - passed
  const ts = new Date().toISOString()
  const lines: string[] = []
  lines.push(`_Last run: ${ts} — **${passed}/${totalChecks}** checks passed (${failed} failed)._`)
  lines.push('')
  lines.push('| Area | Field | Expected | Actual | Result |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const r of rows) {
    const result = r.pass ? '✓ PASS' : '✗ FAIL'
    lines.push(`| ${r.area} | ${r.field} | \`${r.expected}\` | \`${r.actual}\` | **${result}** |`)
  }
  return lines.join('\n')
}

function injectIntoReport(markdown: string) {
  const reportPath = path.resolve(__dirname, '..', '..', 'docs', 'insights-validation', 'quality.md')
  const begin = '<!-- API_DIFF_BEGIN -->'
  const end   = '<!-- API_DIFF_END -->'
  const original = fs.readFileSync(reportPath, 'utf8')
  const re = new RegExp(`${begin}[\\s\\S]*?${end}`, 'm')
  if (!re.test(original)) {
    throw new Error(`Markers ${begin} … ${end} not found in ${reportPath}`)
  }
  const updated = original.replace(re, `${begin}\n${markdown}\n${end}`)
  fs.writeFileSync(reportPath, updated, 'utf8')
  console.log(`\nReport updated → ${reportPath}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nQuality validation against ${BASE}`)
  console.log(`Slice: user=${SLICE.userId} (${SLICE.username}), dept=${SLICE.deptId} (${SLICE.deptName}), form=${SLICE.formId} (${SLICE.formName}), ${SLICE.start} → ${SLICE.end}`)
  console.log('\nAcquiring CSRF + admin login...')
  await getCsrf()
  let ok = await login(EMAIL, PASSWORD)
  for (const fb of FALLBACKS) {
    if (ok) break
    console.log(`  Trying fallback ${fb.email}...`)
    await getCsrf()
    ok = await login(fb.email, fb.password)
  }
  if (!ok) {
    console.error('\nFATAL: could not authenticate as an Admin. Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD.')
    process.exit(1)
  }

  await validateKpis()
  await validateTrends()
  await validateScoreDistribution()
  await validateCategoryScores()
  await validateFormScores()
  await validateDeptComparison()
  await validateMissedQuestions()

  const md = buildMarkdown()
  injectIntoReport(md)

  const failed = rows.filter(r => !r.pass).length
  console.log(`\nDone. ${rows.length - failed}/${rows.length} checks passed, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\nUnhandled error:', err.message || err)
  process.exit(1)
})
