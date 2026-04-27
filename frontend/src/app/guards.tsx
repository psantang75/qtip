import React, { Suspense, useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../contexts/AuthContext'
import { ROLE_IDS } from '../hooks/useQualityRole'
import { PageSpinner } from '../components/common/PageSpinner'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { getInsightsAccess, getInsightsNavigation } from '../services/insightsService'

/**
 * Route guards, redirects, and the lazy-page loader.
 *
 * Extracted from `App.tsx` during the pre-production review (item #75) so
 * `App.tsx` is a slim composition of providers + routes.
 */

// ── Role-based root redirect ──────────────────────────────────────────────────

export function RoleRedirect(): null {
  const { user } = useAuth()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!user) return
    const destinations: Record<number, string> = {
      [ROLE_IDS.ADMIN]:    '/app/insights',
      [ROLE_IDS.QA]:       '/app/quality/submissions',
      [ROLE_IDS.AGENT]:    '/app/quality/submissions',
      [ROLE_IDS.TRAINER]:  '/app/training/coaching',
      [ROLE_IDS.MANAGER]:  '/app/quality/submissions',
      [ROLE_IDS.DIRECTOR]: '/app/insights',
    }
    const dest = destinations[user.role_id] ?? '/app/quality/submissions'
    navigate(dest, { replace: true })
  }, [user, navigate])

  return null
}

// ── Page suspense + error boundary wrapper ────────────────────────────────────
// Wraps every lazy page so a render error in one page shows the recovery
// fallback instead of blanking the whole app (pre-production review item #76).

export function PageLoader({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSpinner />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

// ── Cache reset on user switch ────────────────────────────────────────────────
// Clears all stale TanStack Query data whenever a different user logs in,
// so role-restricted data from a previous session never leaks through.

export function CacheResetGuard(): null {
  const { user } = useAuth()
  const qc       = useQueryClient()
  const prevId   = useRef<number | null | undefined>(undefined)

  useEffect(() => {
    const currentId = user?.id ?? null
    // undefined means "first render" — skip initial clear
    if (prevId.current !== undefined && prevId.current !== currentId) {
      qc.clear()
    }
    prevId.current = currentId
  }, [user?.id, qc])

  return null
}

// ── Role-aware training index redirect ────────────────────────────────────────

export function TrainingIndexRedirect(): React.ReactElement {
  const { user } = useAuth()
  return <Navigate to={user?.role_id === ROLE_IDS.AGENT ? 'my-coaching' : 'coaching'} replace />
}

// ── Role guard — redirects to a fallback if the user's role isn't allowed ─────

export function RequireRole({
  allowed,
  fallback,
  children,
}: {
  allowed: number[]
  fallback: string
  children: React.ReactNode
}): React.ReactElement | null {
  const { user } = useAuth()
  if (!user) return null
  if (!allowed.includes(user.role_id)) return <Navigate to={fallback} replace />
  return <>{children}</>
}

// ── Insights page-access guard ────────────────────────────────────────────────
// Drives access from the same `ie_page_role_access` / `ie_page_user_override`
// tables the backend enforces. Eliminates the "land on the page → trigger
// 403s" UX by checking access *before* the page mounts.

export function RequireInsightsAccess({
  pageKey,
  fallback = '/app',
  children,
}: {
  pageKey: string
  fallback?: string
  children: React.ReactNode
}): React.ReactElement | null {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['insights-access', pageKey, user?.id],
    queryFn: () => getInsightsAccess(pageKey),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  if (!user) return null
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }
  if (!data?.canAccess) return <Navigate to={fallback} replace />
  return <>{children}</>
}

// Sends the user to the first Insights page they actually have access to,
// instead of always defaulting to qc-overview (which most non-admins can't see).
export function InsightsIndexRedirect(): React.ReactElement | null {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['insights-navigation', user?.id],
    queryFn: getInsightsNavigation,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  if (!user || isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  const firstPage = data?.flatMap(c => c.pages)[0]
  if (!firstPage) return <Navigate to="/app" replace />
  return <Navigate to={firstPage.route_path} replace />
}

/** Bookmarks and old links used `/app/writeups`; keep them working. */
export function RedirectWriteupsToPerformanceWarnings(): React.ReactElement {
  const { pathname, search } = useLocation()
  const rest = pathname.replace(/^\/app\/writeups/, '')
  const to = `/app/performancewarnings${rest === '' ? '' : rest}${search}`
  return <Navigate to={to} replace />
}
