#!/usr/bin/env node
/**
 * check-error-messages.mjs
 * ────────────────────────
 * Light drift check between `docs/error-messages-catalog.md` and the
 * code-side registry in `frontend/src/lib/errorMessages.ts` /
 * `errorMessages.bespoke.ts` / `t.ts`.
 *
 * What it checks (intentionally conservative — fast to run, low false-positive):
 *   1. The 15 canonical patterns (P1–P15) referenced in the catalog all
 *      have a matching `eX` factory exported from `errorMessages.ts`.
 *   2. The `t` shim re-exports every pattern AND `msg` (bespoke registry).
 *   3. The pre-catalog wording the ESLint rule forbids does not appear
 *      in any non-registry source file (catches contributors who
 *      bypass eslint with `// eslint-disable-next-line`).
 *
 * Exit code:
 *   0 — clean
 *   1 — drift detected (CI fails)
 *
 * Run:
 *   npm --prefix frontend run check:errors
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = join(__dirname, '..')
const REPO_ROOT    = join(FRONTEND_ROOT, '..')

const CATALOG_PATH  = join(REPO_ROOT, 'docs', 'error-messages-catalog.md')
const PATTERNS_PATH = join(FRONTEND_ROOT, 'src', 'lib', 'errorMessages.ts')
const TSHIM_PATH    = join(FRONTEND_ROOT, 'src', 'lib', 't.ts')
const SRC_DIR       = join(FRONTEND_ROOT, 'src')

const REGISTRY_FILES = new Set([
  'src/lib/errorMessages.ts',
  'src/lib/errorMessages.bespoke.ts',
  'src/lib/t.ts',
])

const FORBIDDEN_TITLES = [
  'Failed to load',
  'Failed to save',
  'Failed to update',
  'Failed to delete',
  'Failed to create',
  'Save failed',
  'Update failed',
  'Delete failed',
  'Run failed',
  'Submit failed',
  'Test failed',
  'Resend failed',
  'Archive failed',
  'Restore failed',
  'Download failed',
  'PDF generation failed',
]

const errors = []

// ── 1. Catalog references P1–P15, code exports them ─────────────────────────
const patternsSrc = readFileSync(PATTERNS_PATH, 'utf8')
const expectedPatterns = [
  'eLoad', 'eSave', 'eDelete', 'eSubmit', 'eValidation',
  'eForbidden', 'eNotFound', 'eConflict', 'eSessionExpired', 'eRateLimit',
  'eTimeout', 'eNetwork', 'eServer', 'eUpload',
]
for (const name of expectedPatterns) {
  if (!new RegExp(`export const ${name}\\b`).test(patternsSrc)) {
    errors.push(`Missing canonical pattern export: ${name} in src/lib/errorMessages.ts`)
  }
}

const catalogExists = (() => {
  try { return readFileSync(CATALOG_PATH, 'utf8') } catch { return null }
})()
if (!catalogExists) {
  errors.push(`Catalog not found at ${relative(REPO_ROOT, CATALOG_PATH)} — patterns can't be cross-checked.`)
} else {
  for (let i = 1; i <= 15; i++) {
    if (!new RegExp(`P${i}\\.\\s`, 'm').test(catalogExists)) {
      errors.push(`Catalog is missing pattern P${i} — code exports it but doc doesn't.`)
    }
  }
}

// ── 2. t.ts re-exports patterns and msg ──────────────────────────────────────
const tshimSrc = readFileSync(TSHIM_PATH, 'utf8')
for (const name of expectedPatterns) {
  if (!new RegExp(`\\b${name}\\b`).test(tshimSrc)) {
    errors.push(`Pattern ${name} is exported from errorMessages.ts but not surfaced in t.ts`)
  }
}
if (!/\bmsg:\s*errMsg\b/.test(tshimSrc)) {
  errors.push('t.ts must surface the bespoke registry as `msg: errMsg`')
}
if (!/\bfromError:\s*mapErrorToToast\b/.test(tshimSrc)) {
  errors.push('t.ts must surface the auto-mapper as `fromError: mapErrorToToast`')
}

// ── 3. Forbidden wording outside registry files ──────────────────────────────
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(FRONTEND_ROOT, full).replaceAll('\\', '/')
    if (rel.includes('node_modules') || rel.includes('dist')) continue
    const s = statSync(full)
    if (s.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry)) yield full
  }
}

const titleRe = /title:\s*["'`]([^"'`\n]+)["'`]/g

// ── 4. Raw-error leak patterns ───────────────────────────────────────────────
// These surface the raw axios message ("Request failed with status code 401")
// or a backend machine label to end users. Everything must go through
// `getErrorMessage(err, …)` / `t.fromError(err)` instead. A few files are
// allowed to read `.message` directly (the util that does the safe mapping,
// react-hook-form field errors, and a service that throws curated Errors).
const LEAK_ALLOWED = new Set([
  'src/utils/errorHandling.ts',
  'src/lib/errorMessages.ts',
  'src/components/ui/form.tsx',
  'src/services/formService.ts',
])
const LEAK_PATTERNS = [
  /\?\.message\s*(\?\?|\|\|)\s*['"]Try again/,
  /\?\.message\s*(\?\?|\|\|)\s*['"]Unknown error/,
  /\.data\?\.(error|message)\s*(\?\?|\|\|)\s*\w+\?\.message/,
  /Request failed with status code/,
]

let scanned = 0
for (const file of walk(SRC_DIR)) {
  const rel = relative(FRONTEND_ROOT, file).replaceAll('\\', '/')
  if (REGISTRY_FILES.has(rel)) continue
  scanned++
  const src = readFileSync(file, 'utf8')

  let m
  while ((m = titleRe.exec(src))) {
    const title = m[1]
    for (const bad of FORBIDDEN_TITLES) {
      if (title === bad || title.startsWith(bad + ' ') || title.startsWith(bad + ':')) {
        const line = src.slice(0, m.index).split('\n').length
        errors.push(`${rel}:${line}  forbidden title  "${title}"  — use t.eX(...) or canonical wording`)
      }
    }
  }

  if (!LEAK_ALLOWED.has(rel)) {
    const lines = src.split('\n')
    lines.forEach((text, i) => {
      for (const re of LEAK_PATTERNS) {
        if (re.test(text)) {
          errors.push(`${rel}:${i + 1}  raw-error leak  — use getErrorMessage(err, '…') or t.fromError(err) instead of a bare .message fallback`)
          break
        }
      }
    })
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (errors.length === 0) {
  console.log(`error-messages drift check: clean (${expectedPatterns.length} patterns, ${scanned} files scanned)`)
  process.exit(0)
}
console.error(`error-messages drift check: ${errors.length} issue(s)\n`)
for (const e of errors) {
  console.error(`  • ${e}`)
}
process.exit(1)
