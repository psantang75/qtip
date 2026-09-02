import React, { Suspense, useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/useAuth'
import { ROLE_IDS } from '../hooks/useQualityRole'
import { PageSpinner } from '../components/common/PageSpinner'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { getInsightsAccess, getInsightsNavigation } from '../services/insightsService'
import { getAppAccess, type AppAccessLevel } from '../services/appAccessService'
import { NAV_CONFIG } from '../config/navConfig'

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

// ── Access-aware training index redirect ──────────────────────────────────────
// Routes /app/training to the right coaching surface for the user's resolved
// level on `training_coaching`: editors (ALL/EDIT) → /coaching, self-viewers
// (OWN) → /my-coaching. Driven by access, not a hardcoded role check.

export function TrainingIndexRedirect(): React.ReactElement | null {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey:  ['app-access', 'training_coaching', user?.id],
    queryFn:   () => getAppAccess('training_coaching'),
    enabled:   !!user,
    staleTime: 5 * 60 * 1000,
  })

  if (!user || isLoading) return <PageSpinner />
  if (data?.canViewAll) return <Navigate to="coaching" replace />
  if (data?.canView)    return <Navigate to="my-coaching" replace />
  return <Navigate to="/app" replace />
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

// ── App page-access guard (scope model) ──────────────────────────────────────
// Drives access from the same `app_page_role_access` ladder the backend
// `authorizePage` middleware enforces. Mirrors `RequireInsightsAccess` but
// is level-aware:
//
//   minLevel='view'    → OWN+ may enter (self pages, shared list pages)
//   minLevel='viewAll' → ALL+ may enter (editor pages); OWN users hit fallback
//   minLevel='edit'    → EDIT only
//
// `redirectViewAllTo` keeps editors off the self ("My X") routes: a user who
// can see all data is bounced to the editor route instead of the self view
// (whose API would otherwise 403 them). Pair it with `fallback` pointing the
// other way on the editor route so each role lands on exactly one surface.

const SATISFIES: Record<'view' | 'viewAll' | 'edit', (l: AppAccessLevel) => boolean> = {
  view:    (l) => l === 'OWN' || l === 'ALL' || l === 'EDIT',
  viewAll: (l) => l === 'ALL' || l === 'EDIT',
  edit:    (l) => l === 'EDIT',
}

export function RequirePageAccess({
  pageKey,
  minLevel = 'view',
  fallback = '/app',
  redirectViewAllTo,
  children,
}: {
  pageKey: string
  minLevel?: 'view' | 'viewAll' | 'edit'
  fallback?: string
  redirectViewAllTo?: string
  children: React.ReactNode
}): React.ReactElement | null {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['app-access', pageKey, user?.id],
    queryFn:  () => getAppAccess(pageKey),
    enabled:  !!user,
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

  if (!data) return <Navigate to={fallback} replace />
  // Editors don't belong on the self view — send them to the editor route.
  if (redirectViewAllTo && data.canViewAll) return <Navigate to={redirectViewAllTo} replace />
  if (!SATISFIES[minLevel](data.level)) return <Navigate to={fallback} replace />
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

  // Only land on pages that still have a frontend route. The DB navigation can
  // list a page_key we've since retired from the router (e.g. ir_overview after
  // the Internal Research Overview was removed); redirecting there would dead-end.
  // Mirror the sidebar, which already filters DB keys against navConfig.
  const validKeys = new Set(
    (NAV_CONFIG.find(s => s.id === 'insights')?.items ?? [])
      .map(i => i.pageKey)
      .filter((k): k is string => !!k),
  )
  const pages = data?.flatMap(c => c.pages) ?? []
  const firstPage = pages.find(p => validKeys.has(p.page_key)) ?? pages[0]
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
