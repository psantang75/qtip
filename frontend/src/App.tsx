import React, { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ROLE_IDS } from './hooks/useQualityRole'
import { Toaster } from './components/ui/toaster'
import { TooltipProvider } from './components/ui/tooltip'
import { getInsightsAccess, getInsightsNavigation } from './services/insightsService'

// Shell components — NOT lazy (load immediately)
import AppShell from './components/shell/AppShell'
import AdminLayout from './components/shell/AdminLayout'
import ProtectedRoute from './components/shell/ProtectedRoute'

// Auth pages — NOT lazy
import LoginPage from './pages/auth/LoginPage'

// Admin pages — NOT lazy (small, load immediately)
import AdminUsersPage       from './pages/admin/AdminUsersPage'
import AdminDepartmentsPage from './pages/admin/AdminDepartmentsPage'
import AdminRolesPage       from './pages/admin/AdminRolesPage'
import ProfilePage          from './pages/admin/ProfilePage'
import ListManagementPage   from './pages/admin/ListManagementPage'
import InsightsKpiManagementPage  from './pages/admin/InsightsKpiManagementPage'
import InsightsPageManagementPage from './pages/admin/InsightsPageManagementPage'
import InsightsIngestionLogPage   from './pages/admin/InsightsIngestionLogPage'
import InsightsCalendarPage       from './pages/admin/InsightsCalendarPage'

// Lazy-loaded page components
const FormsPage             = React.lazy(() => import('./pages/quality/FormsPage'))
const SubmissionsPage       = React.lazy(() => import('./pages/quality/SubmissionsPage'))
const DisputesPage          = React.lazy(() => import('./pages/quality/DisputesPage'))
const QualityAnalyticsPage  = React.lazy(() => import('./pages/quality/QualityAnalyticsPage'))
const ReviewFormsPage         = React.lazy(() => import('./pages/quality/ReviewFormsPage'))
const AuditFormPage           = React.lazy(() => import('./pages/quality/AuditFormPage'))
const SubmissionDetailPage    = React.lazy(() => import('./pages/quality/SubmissionDetailPage'))
const CoachingSessionsPage      = React.lazy(() => import('./pages/training/CoachingSessionsPage'))
const CoachingSessionDetailPage = React.lazy(() => import('./pages/training/CoachingSessionDetailPage'))
const CoachingSessionFormPage   = React.lazy(() => import('./pages/training/CoachingSessionFormPage'))
const MyCoachingPage            = React.lazy(() => import('./pages/training/MyCoachingPage'))
const MyCoachingDetailPage      = React.lazy(() => import('./pages/training/MyCoachingDetailPage'))
const TrainingReportsPage       = React.lazy(() => import('./pages/training/TrainingReportsPage'))
const LibraryTopicsPage         = React.lazy(() => import('./pages/training/LibraryTopicsPage'))
const LibraryQuizzesPage        = React.lazy(() => import('./pages/training/LibraryQuizzesPage'))
const LibraryQuizFormPage       = React.lazy(() => import('./pages/training/LibraryQuizFormPage'))
const LibraryResourcesPage      = React.lazy(() => import('./pages/training/LibraryResourcesPage'))

const WriteUpsPage           = React.lazy(() => import('./pages/writeups/WriteUpsPage'))
const WriteUpFormPage        = React.lazy(() => import('./pages/writeups/WriteUpFormPage'))
const WriteUpDetailPage      = React.lazy(() => import('./pages/writeups/WriteUpDetailPage'))
const MyWriteUpsPage         = React.lazy(() => import('./pages/writeups/MyWriteUpsPage'))
const MyWriteUpDetailPage    = React.lazy(() => import('./pages/writeups/MyWriteUpDetailPage'))

const DashboardPage         = React.lazy(() => import('./pages/insights/DashboardPage'))
const TeamDashboardPage     = React.lazy(() => import('./pages/insights/TeamDashboardPage'))
const ReportBuilderPage     = React.lazy(() => import('./pages/insights/ReportBuilderPage'))
const SavedReportsPage      = React.lazy(() => import('./pages/insights/SavedReportsPage'))
const DataExplorerPage      = React.lazy(() => import('./pages/insights/DataExplorerPage'))
const ExportPage            = React.lazy(() => import('./pages/insights/ExportPage'))
const ImportCenterPage      = React.lazy(() => import('./pages/insights/ImportCenterPage'))
const ImportHistoryPage     = React.lazy(() => import('./pages/insights/ImportHistoryPage'))
const QCOverviewPage        = React.lazy(() => import('./pages/insights/QCOverviewPage'))
const QCQualityPage         = React.lazy(() => import('./pages/insights/QCQualityPage'))
const QCCoachingPage        = React.lazy(() => import('./pages/insights/QCCoachingPage'))
const QCWarningsPage        = React.lazy(() => import('./pages/insights/QCWarningsPage'))
const QCAgentsPage          = React.lazy(() => import('./pages/insights/QCAgentsPage'))

const NotFoundPage          = React.lazy(() => import('./pages/NotFoundPage'))

// ── TanStack Query client ─────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// ── Role-based root redirect ──────────────────────────────────────────────────

function RoleRedirect() {
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

// ── Page suspense wrapper ─────────────────────────────────────────────────────

function PageLoader({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-40">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

// ── Cache reset on user switch ────────────────────────────────────────────────
// Clears all stale TanStack Query data whenever a different user logs in,
// so role-restricted data from a previous session never leaks through.

function CacheResetGuard() {
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

function TrainingIndexRedirect() {
  const { user } = useAuth()
  return <Navigate to={user?.role_id === ROLE_IDS.AGENT ? 'my-coaching' : 'coaching'} replace />
}

// ── Role guard — redirects to a fallback if the user's role isn't allowed ─────

function RequireRole({
  allowed,
  fallback,
  children,
}: {
  allowed: number[]
  fallback: string
  children: React.ReactNode
}) {
  const { user } = useAuth()
  if (!user) return null
  if (!allowed.includes(user.role_id)) return <Navigate to={fallback} replace />
  return <>{children}</>
}

// ── Insights page-access guard ────────────────────────────────────────────────
// Drives access from the same `ie_page_role_access` / `ie_page_user_override`
// tables the backend enforces. Eliminates the "land on the page → trigger
// 403s" UX by checking access *before* the page mounts.

function RequireInsightsAccess({
  pageKey,
  fallback = '/app',
  children,
}: {
  pageKey: string
  fallback?: string
  children: React.ReactNode
}) {
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
function InsightsIndexRedirect() {
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
function RedirectWriteupsToPerformanceWarnings() {
  const { pathname, search } = useLocation()
  const rest = pathname.replace(/^\/app\/writeups/, '')
  const to = `/app/performancewarnings${rest === '' ? '' : rest}${search}`
  return <Navigate to={to} replace />
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
      <AuthProvider>
        <CacheResetGuard />
        <BrowserRouter>
          <Routes>

            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected shell */}
            <Route element={<ProtectedRoute />}>

              {/* Admin area — own layout, Admin-only */}
              <Route path="/app/admin" element={
                <RequireRole allowed={[ROLE_IDS.ADMIN]} fallback="/app">
                  <AdminLayout />
                </RequireRole>
              }>
                <Route path="users"            element={<AdminUsersPage />} />
                <Route path="departments"      element={<AdminDepartmentsPage />} />
                <Route path="roles"            element={<AdminRolesPage />} />
                <Route path="list-management"  element={<ListManagementPage />} />
                <Route path="insights/kpis"       element={<InsightsKpiManagementPage />} />
                <Route path="insights/pages"      element={<InsightsPageManagementPage />} />
                <Route path="insights/calendar"   element={<InsightsCalendarPage />} />
                <Route path="insights/ingestion"  element={<InsightsIngestionLogPage />} />
              </Route>

              <Route element={<AppShell />}>

                {/* Root redirect */}
                <Route path="/" element={<RoleRedirect />} />
                <Route path="/app" element={<Navigate to="/" replace />} />

                {/* Quality */}
                <Route path="/app/quality">
                  <Route index element={<Navigate to="submissions" replace />} />
                  <Route path="overview"        element={<Navigate to="/app/quality/submissions" replace />} />
                  <Route path="forms"           element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="forms/new"       element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="forms/:id/edit"  element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="forms/:id/preview" element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="forms/:id/duplicate" element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="submissions"     element={<PageLoader><SubmissionsPage /></PageLoader>} />
                  <Route path="submissions/:id"   element={<PageLoader><SubmissionDetailPage /></PageLoader>} />
                  <Route path="disputes"          element={<PageLoader><DisputesPage /></PageLoader>} />
                  <Route path="dispute-history"   element={<Navigate to="/app/quality/disputes" replace />} />
                  <Route path="analytics"       element={<Navigate to="/app/analytics/quality" replace />} />
                  <Route path="review-forms"    element={<PageLoader><ReviewFormsPage /></PageLoader>} />
                  <Route path="audit"           element={<PageLoader><AuditFormPage /></PageLoader>} />
                </Route>

                {/* Training */}
                <Route path="/app/training">
                  <Route index element={<TrainingIndexRedirect />} />
                  {/* Trainer/manager/admin routes — CSRs are redirected to my-coaching */}
                  <Route path="coaching" element={<RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.TRAINER,ROLE_IDS.MANAGER]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionsPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/new" element={<RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.TRAINER,ROLE_IDS.MANAGER]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/:id" element={<RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.TRAINER,ROLE_IDS.MANAGER]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionDetailPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/:id/edit" element={<RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.TRAINER,ROLE_IDS.MANAGER]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequireRole>} />
                  <Route path="my-coaching"       element={<PageLoader><MyCoachingPage /></PageLoader>} />
                  <Route path="my-coaching/:id"   element={<PageLoader><MyCoachingDetailPage /></PageLoader>} />
                  <Route path="reports"           element={<PageLoader><TrainingReportsPage /></PageLoader>} />
                  <Route path="library">
                    <Route index element={<Navigate to="topics" replace />} />
                    <Route path="topics"    element={<PageLoader><LibraryTopicsPage /></PageLoader>} />
                    <Route path="quizzes"         element={<PageLoader><LibraryQuizzesPage /></PageLoader>} />
                    <Route path="quizzes/new"     element={<PageLoader><LibraryQuizFormPage /></PageLoader>} />
                    <Route path="quizzes/:id/edit" element={<PageLoader><LibraryQuizFormPage /></PageLoader>} />
                    <Route path="resources" element={<PageLoader><LibraryResourcesPage /></PageLoader>} />
                  </Route>
                </Route>

                <Route path="/app/writeups/*" element={<RedirectWriteupsToPerformanceWarnings />} />

                {/* Performance Warnings (write-up documents) */}
                <Route path="/app/performancewarnings">
                  <Route index element={<Navigate to="list" replace />} />
                  <Route
                    path="list"
                    element={
                      <RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.MANAGER]} fallback="/app/performancewarnings/my">
                        <PageLoader><WriteUpsPage /></PageLoader>
                      </RequireRole>
                    }
                  />
                  <Route
                    path="new"
                    element={
                      <RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.MANAGER]} fallback="/app">
                        <PageLoader><WriteUpFormPage /></PageLoader>
                      </RequireRole>
                    }
                  />
                  <Route
                    path=":id"
                    element={
                      <RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.MANAGER]} fallback="/app">
                        <PageLoader><WriteUpDetailPage /></PageLoader>
                      </RequireRole>
                    }
                  />
                  <Route
                    path=":id/edit"
                    element={
                      <RequireRole allowed={[ROLE_IDS.ADMIN,ROLE_IDS.QA,ROLE_IDS.MANAGER]} fallback="/app">
                        <PageLoader><WriteUpFormPage /></PageLoader>
                      </RequireRole>
                    }
                  />
                  <Route
                    path="my"
                    element={<PageLoader><MyWriteUpsPage /></PageLoader>}
                  />
                  <Route
                    path="my/:id"
                    element={<PageLoader><MyWriteUpDetailPage /></PageLoader>}
                  />
                </Route>

                {/* Insights */}
                <Route path="/app/insights">
                  <Route index element={<InsightsIndexRedirect />} />
                  <Route path="qc-overview" element={<RequireInsightsAccess pageKey="qc_overview"><PageLoader><QCOverviewPage /></PageLoader></RequireInsightsAccess>} />
                  <Route path="qc-quality"  element={<RequireInsightsAccess pageKey="qc_quality"><PageLoader><QCQualityPage /></PageLoader></RequireInsightsAccess>} />
                  <Route path="qc-coaching" element={<RequireInsightsAccess pageKey="qc_coaching"><PageLoader><QCCoachingPage /></PageLoader></RequireInsightsAccess>} />
                  <Route path="qc-warnings" element={<RequireInsightsAccess pageKey="qc_warnings"><PageLoader><QCWarningsPage /></PageLoader></RequireInsightsAccess>} />
                  <Route path="qc-agents"   element={<RequireInsightsAccess pageKey="qc_agents"><PageLoader><QCAgentsPage /></PageLoader></RequireInsightsAccess>} />
                  <Route path="dashboard" element={<PageLoader><DashboardPage /></PageLoader>} />
                  <Route path="team"      element={<PageLoader><TeamDashboardPage /></PageLoader>} />
                  <Route path="builder"   element={<PageLoader><ReportBuilderPage /></PageLoader>} />
                  <Route path="reports"   element={<PageLoader><SavedReportsPage /></PageLoader>} />
                  <Route path="explorer"  element={<PageLoader><DataExplorerPage /></PageLoader>} />
                  <Route path="export"    element={<PageLoader><ExportPage /></PageLoader>} />
                  <Route path="import"    element={<PageLoader><ImportCenterPage /></PageLoader>} />
                  <Route path="history"   element={<PageLoader><ImportHistoryPage /></PageLoader>} />
                </Route>

                {/* Analytics — legacy routes redirect to Insights equivalents */}
                <Route path="/app/analytics">
                  <Route index element={<Navigate to="/app/insights/qc-quality" replace />} />
                  <Route path="quality" element={<Navigate to="/app/insights/qc-quality" replace />} />
                </Route>

                {/* Profile — all authenticated users */}
                <Route path="/app/profile" element={<ProfilePage />} />

                {/* 404 within shell */}
                <Route path="*" element={<PageLoader><NotFoundPage /></PageLoader>} />

              </Route>
            </Route>

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/login" replace />} />

          </Routes>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
