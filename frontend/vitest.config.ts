/**
 * Vitest config for the frontend — pre-production review item #46.
 *
 * Scoped to pure helpers under `src/utils/`, `src/constants/`, and any
 * `__tests__` folder. We deliberately omit `jsdom` / DOM libraries here
 * because the existing tests are framework-agnostic (date math, label
 * lookups, scoring). Add `environment: 'jsdom'` if/when component tests
 * land.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    fileParallelism: true,
  },
})
