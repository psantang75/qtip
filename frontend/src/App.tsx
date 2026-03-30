import React, { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import { TooltipProvider } from './components/ui/tooltip'

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

const DashboardPage         = React.lazy(() => import('./pages/insights/DashboardPage'))
const TeamDashboardPage     = React.lazy(() => import('./pages/insights/TeamDashboardPage'))
const ReportBuilderPage     = React.lazy(() => import('./pages/insights/ReportBuilderPage'))
const SavedReportsPage      = React.lazy(() => import('./pages/insights/SavedReportsPage'))
const DataExplorerPage      = React.lazy(() => import('./pages/insights/DataExplorerPage'))
const ExportPage            = React.lazy(() => import('./pages/insights/ExportPage'))
const ImportCenterPage      = React.lazy(() => import('./pages/insights/ImportCenterPage'))
const ImportHistoryPage     = React.lazy(() => import('./pages/insights/ImportHistoryPage'))

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
      1: '/app/insights/dashboard',      // admin
      2: '/app/quality/submissions',     // qa
      3: '/app/quality/submissions',     // user/csr
      4: '/app/training/coaching',       // trainer
      5: '/app/quality/submissions',     // manager
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
  return <Navigate to={user?.role_id === 3 ? 'my-coaching' : 'coaching'} replace />
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

              {/* Admin area — own layout, no SectionNav */}
              <Route path="/app/admin" element={<AdminLayout />}>
                <Route path="users"            element={<AdminUsersPage />} />
                <Route path="departments"      element={<AdminDepartmentsPage />} />
                <Route path="roles"            element={<AdminRolesPage />} />
                <Route path="list-management"  element={<ListManagementPage />} />
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
                  <Route path="coaching" element={<RequireRole allowed={[1,2,4,5]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionsPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/new" element={<RequireRole allowed={[1,2,4,5]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/:id" element={<RequireRole allowed={[1,2,4,5]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionDetailPage /></PageLoader></RequireRole>} />
                  <Route path="coaching/:id/edit" element={<RequireRole allowed={[1,2,4,5]} fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequireRole>} />
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

                {/* Insights */}
                <Route path="/app/insights">
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard" element={<PageLoader><DashboardPage /></PageLoader>} />
                  <Route path="team"      element={<PageLoader><TeamDashboardPage /></PageLoader>} />
                  <Route path="builder"   element={<PageLoader><ReportBuilderPage /></PageLoader>} />
                  <Route path="reports"   element={<PageLoader><SavedReportsPage /></PageLoader>} />
                  <Route path="explorer"  element={<PageLoader><DataExplorerPage /></PageLoader>} />
                  <Route path="export"    element={<PageLoader><ExportPage /></PageLoader>} />
                  <Route path="import"    element={<PageLoader><ImportCenterPage /></PageLoader>} />
                  <Route path="history"   element={<PageLoader><ImportHistoryPage /></PageLoader>} />
                </Route>

                {/* Analytics */}
                <Route path="/app/analytics">
                  <Route index element={<Navigate to="quality" replace />} />
                  <Route path="quality" element={<PageLoader><QualityAnalyticsPage /></PageLoader>} />
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
