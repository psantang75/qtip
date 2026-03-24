import React, { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import DevRoleSwitcher from './components/dev/DevRoleSwitcher'

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

// Lazy-loaded page components
const QualityOverviewPage   = React.lazy(() => import('./pages/quality/QualityOverviewPage'))
const FormsPage             = React.lazy(() => import('./pages/quality/FormsPage'))
const SubmissionsPage       = React.lazy(() => import('./pages/quality/SubmissionsPage'))
const DisputesPage          = React.lazy(() => import('./pages/quality/DisputesPage'))
const QualityAnalyticsPage  = React.lazy(() => import('./pages/quality/QualityAnalyticsPage'))
const ReviewFormsPage         = React.lazy(() => import('./pages/quality/ReviewFormsPage'))
const AuditFormPage           = React.lazy(() => import('./pages/quality/AuditFormPage'))
const SubmissionDetailPage    = React.lazy(() => import('./pages/quality/SubmissionDetailPage'))
const DisputeHistoryPage      = React.lazy(() => import('./pages/quality/DisputeHistoryPage'))

const TrainingOverviewPage  = React.lazy(() => import('./pages/training/TrainingOverviewPage'))
const CoursesPage           = React.lazy(() => import('./pages/training/CoursesPage'))
const TrainingPathsPage     = React.lazy(() => import('./pages/training/TrainingPathsPage'))
const EnrollmentsPage       = React.lazy(() => import('./pages/training/EnrollmentsPage'))
const CoachingPage          = React.lazy(() => import('./pages/training/CoachingPage'))
const CertificatesPage      = React.lazy(() => import('./pages/training/CertificatesPage'))
const QuizzesPage           = React.lazy(() => import('./pages/training/QuizzesPage'))

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
      1: '/app/insights/dashboard', // admin
      2: '/app/quality/overview',   // qa
      3: '/app/quality/overview',   // user
      4: '/app/training/overview',  // trainer
      5: '/app/quality/overview',   // manager
    }
    const dest = destinations[user.role_id] ?? '/app/quality/overview'
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>

            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected shell */}
            <Route element={<ProtectedRoute />}>

              {/* Admin area — own layout, no SectionNav */}
              <Route path="/app/admin" element={<AdminLayout />}>
                <Route path="users"       element={<AdminUsersPage />} />
                <Route path="departments" element={<AdminDepartmentsPage />} />
                <Route path="roles"       element={<AdminRolesPage />} />
              </Route>

              <Route element={<AppShell />}>

                {/* Root redirect */}
                <Route path="/" element={<RoleRedirect />} />
                <Route path="/app" element={<Navigate to="/" replace />} />

                {/* Quality */}
                <Route path="/app/quality">
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview"        element={<PageLoader><QualityOverviewPage /></PageLoader>} />
                  <Route path="forms"           element={<PageLoader><FormsPage /></PageLoader>} />
                  <Route path="submissions"     element={<PageLoader><SubmissionsPage /></PageLoader>} />
                  <Route path="submissions/:id"   element={<PageLoader><SubmissionDetailPage /></PageLoader>} />
                  <Route path="disputes"          element={<PageLoader><DisputesPage /></PageLoader>} />
                  <Route path="dispute-history"   element={<PageLoader><DisputeHistoryPage /></PageLoader>} />
                  <Route path="analytics"       element={<Navigate to="/app/analytics/quality" replace />} />
                  <Route path="review-forms"    element={<PageLoader><ReviewFormsPage /></PageLoader>} />
                  <Route path="audit"           element={<PageLoader><AuditFormPage /></PageLoader>} />
                </Route>

                {/* Training */}
                <Route path="/app/training">
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview"     element={<PageLoader><TrainingOverviewPage /></PageLoader>} />
                  <Route path="courses"      element={<PageLoader><CoursesPage /></PageLoader>} />
                  <Route path="paths"        element={<PageLoader><TrainingPathsPage /></PageLoader>} />
                  <Route path="enrollments"  element={<PageLoader><EnrollmentsPage /></PageLoader>} />
                  <Route path="coaching"     element={<PageLoader><CoachingPage /></PageLoader>} />
                  <Route path="certificates" element={<PageLoader><CertificatesPage /></PageLoader>} />
                  <Route path="quizzes"      element={<PageLoader><QuizzesPage /></PageLoader>} />
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
        {import.meta.env.DEV && <DevRoleSwitcher />}
      </AuthProvider>
    </QueryClientProvider>
  )
}
