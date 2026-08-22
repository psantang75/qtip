#!/usr/bin/env node
// lint-staged runner for this npm-workspaces monorepo.
//
// Each workspace ships its own flat config (frontend/eslint.config.js,
// backend/eslint.config.mjs) that ESLint + typescript-eslint resolve relative
// to the *process* cwd. lint-staged executes commands WITHOUT a shell, so
// `cd frontend && eslint` cannot work, and the in-process ESLint API can't fake
// a per-workspace cwd (typescript-eslint still auto-detects tsconfigRootDir from
// the real process.cwd() at the repo root and errors on the ambiguity).
//
// So we replicate exactly what `npm run lint` does: bucket the staged files by
// workspace and spawn that workspace's ESLint CLI as a child process with the
// workspace as its real cwd. Check-only: eslint exits non-zero on ERRORS (so new
// errors can't land) but stays 0 on the pre-existing warning backlog.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// eslint's package.json `exports` hides ./bin, so resolve the package dir and
// point at the physical launcher instead of the (non-exported) subpath.
const eslintBin = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')
const root = process.cwd()

const groups = { frontend: [], backend: [] }
for (const abs of process.argv.slice(2)) {
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (rel.startsWith('frontend/')) groups.frontend.push(rel.slice('frontend/'.length))
  else if (rel.startsWith('backend/')) groups.backend.push(rel.slice('backend/'.length))
}

let failed = 0
for (const ws of ['frontend', 'backend']) {
  if (groups[ws].length === 0) continue
  const res = spawnSync(process.execPath, [eslintBin, ...groups[ws]], {
    cwd: path.join(root, ws),
    stdio: 'inherit',
  })
  if (res.status !== 0) failed = 1
}

process.exit(failed)
