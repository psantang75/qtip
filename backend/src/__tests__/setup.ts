// Shared Vitest setup.
//
// ## Why this opt-in guard exists (pre-prod review item #49)
//
// The tests under `backend/src/**/__tests__/` are golden-slice integration
// tests: they connect through the same `pool` the app uses and compare
// service output against pinned values from a known dev-data slice
// (docs/insights-validation/quality.md). They are read-only against that
// slice, but they still **need a live MySQL** with that exact data present.
//
// Running them blindly in CI is fragile (no fixtures = no values to pin
// against) and dangerous if the env happens to point at a real shared DB.
//
// To keep them useful in dev without a CI footgun, the suite is now opt-in:
//
//   - `npm test` does nothing dangerous by default — every test in this
//     suite is reported as `skipped` unless the developer explicitly opts
//     in.
//   - Set `ENABLE_DB_TESTS=1` (and a `.env` whose `DB_NAME` actually
//     contains the golden slice) to run them locally.
//   - In CI we want this var unset, so the suite passes by short-circuit
//     and we don't accidentally hit prod data.
//
// If/when we get a dedicated test DB with seeded fixtures, drop the guard
// and let the suite run unconditionally.

import * as dotenv from 'dotenv'
import * as path from 'path'
import { beforeAll } from 'vitest'

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })

export const DB_TESTS_ENABLED = process.env.ENABLE_DB_TESTS === '1'

beforeAll(() => {
  if (!DB_TESTS_ENABLED) {
    // One-line, machine-friendly notice so devs see why nothing ran.
    // eslint-disable-next-line no-console
    console.warn(
      '[vitest] DB-backed tests skipped — set ENABLE_DB_TESTS=1 (and point .env at the golden-slice DB) to run them.',
    )
  }
})
