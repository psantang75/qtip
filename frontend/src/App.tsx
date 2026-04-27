import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import { TooltipProvider } from './components/ui/tooltip'
import { ErrorBoundary } from './components/common/ErrorBoundary'

import { queryClient } from './app/queryClient'
import { CacheResetGuard } from './app/guards'
import AppRoutes from './app/AppRoutes'

/**
 * Top-level app composition — providers + routes.
 *
 * Routing, guards, redirects, and the TanStack Query client were split out
 * during the pre-production review (item #75). See:
 *   app/AppRoutes.tsx  — the full route tree + React.lazy wiring
 *   app/guards.tsx     — RequireRole, RequireInsightsAccess, PageLoader, …
 *   app/queryClient.ts — QueryClient config
 *
 * A root `ErrorBoundary` (item #76) catches any render-time error that
 * escapes the per-page boundaries inside `PageLoader`.
 */
export default function App() {
  return (
    <ErrorBoundary scope="App">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <CacheResetGuard />
            <BrowserRouter>
              <AppRoutes />
              <Toaster />
            </BrowserRouter>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
