import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Do not poll: reading the tree every second wakes OneDrive and Cursor
    // reloads the window. Ignore non-source paths so office/sync noise is skipped.
    watch: {
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/logs/**',
        '**/backend/**',
        '**/*.docx',
        '**/*.xlsx',
        '**/*.xls',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // AI Reviewer manual runs can take 60–180s end-to-end (Sonnet
        // trace x N + Opus synthesis + KB link expansion). The browser
        // sets a 5-minute axios timeout per-request, but the Vite dev
        // proxy's default socket timeouts will close the connection
        // before then, surfacing as a spurious "timeout error" in the
        // UI even though the backend saved the draft. Match the 10-min
        // ceiling so the proxy is never the bottleneck in dev.
        timeout: 600000,
        proxyTimeout: 600000,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
