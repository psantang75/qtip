#!/usr/bin/env node
// lint-staged runner for this npm-workspaces monorepo.
//
// ESLint's flat config resolves from a base directory, and each workspace ships
// its own config (frontend/eslint.config.js, backend/eslint.config.mjs).
// lint-staged executes commands WITHOUT a shell, so `cd frontend && eslint`
// cannot work. This helper receives the staged file paths as args, buckets them
// by workspace, and lints each bucket via the ESLint API with that workspace as
// the `cwd` so the right flat config + plugins are picked up.
//
// Check-only: exits non-zero on lint ERRORS (so new errors can't land) but does
// not auto-fix and does not block on the pre-existing warning backlog.
import { ESLint } from 'eslint'
import path from 'node:path'

const root = process.cwd()

const groups = { frontend: [], backend: [] }
for (const abs of process.argv.slice(2)) {
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (rel.startsWith('frontend/')) groups.frontend.push(rel.slice('frontend/'.length))
  else if (rel.startsWith('backend/')) groups.backend.push(rel.slice('backend/'.length))
}

let errorCount = 0
for (const ws of ['frontend', 'backend']) {
  if (groups[ws].length === 0) continue
  const eslint = new ESLint({ cwd: path.join(root, ws) })
  const results = await eslint.lintFiles(groups[ws])
  const output = await (await eslint.loadFormatter('stylish')).format(results)
  if (output.trim()) process.stdout.write(output + '\n')
  errorCount += results.reduce((n, r) => n + r.errorCount, 0)
}

process.exit(errorCount > 0 ? 1 : 0)
