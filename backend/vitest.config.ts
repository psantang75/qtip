import { defineConfig } from 'vitest/config'

// Tests touch the dev MySQL via the same `pool` the app uses, so they must
// run sequentially (no parallel pool contention) and share the same .env.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
