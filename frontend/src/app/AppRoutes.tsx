import React from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { ROLE_IDS } from '../hooks/useQualityRole'
import { useAuth } from '../contexts/AuthContext'
import { getAppAccess } from '../services/appAccessService'

// Shell components — NOT lazy (load immediately)
import AppShell from '../components/shell/AppShell'
import AdminLayout from '../components/shell/AdminLayout'
import ProtectedRoute from '../components/shell/ProtectedRoute'

// Auth pages — NOT lazy
import LoginPage          from '../pages/auth/LoginPage'
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage'
import ResetPasswordPage  from '../pages/auth/ResetPasswordPage'

// Admin pages — NOT lazy (small, load immediately)
import AdminUsersPage       from '../pages/admin/AdminUsersPage'
import AdminDepartmentsPage from '../pages/admin/AdminDepartmentsPage'
import AppPageAccessPage    from '../pages/admin/AppPageAccessPage'
import ProfilePage          from '../pages/admin/ProfilePage'
import ListManagementPage   from '../pages/admin/ListManagementPage'
import InsightsKpiManagementPage  from '../pages/admin/InsightsKpiManagementPage'
import InsightsPageManagementPage from '../pages/admin/InsightsPageManagementPage'
import InsightsIngestionLogPage   from '../pages/admin/InsightsIngestionLogPage'
import InsightsSourceReportsPage   from '../pages/admin/InsightsSourceReportsPage'
import ManualUploadPage            from '../pages/admin/ManualUploadPage'
import SystemSettingsPage         from '../pages/admin/SystemSettingsPage'
import UnlockRegisterPage         from '../pages/admin/UnlockRegisterPage'
import InsightsCalendarPage       from '../pages/admin/InsightsCalendarPage'
import AdminEmailTemplatesPage    from '../pages/admin/AdminEmailTemplatesPage'

import {
  InsightsIndexRedirect,
  PageLoader,
  RedirectWriteupsToPerformanceWarnings,
  RequireInsightsAccess,
  RequirePageAccess,
  RequireRole,
  RoleRedirect,
  TrainingIndexRedirect,
} from './guards'

/**
 * Route tree for the application.
 *
 * Extracted from `App.tsx` during the pre-production review (item #75). All
 * page-level code splitting lives here via `React.lazy`, so the top-level
 * `App.tsx` is a slim provider composition.
 */

// ── Lazy-loaded page components ──────────────────────────────────────────────

const FormsPage             = React.lazy(() => import('../pages/quality/FormsPage'))
const SubmissionsPage       = React.lazy(() => import('../pages/quality/SubmissionsPage'))
const DisputesPage          = React.lazy(() => import('../pages/quality/DisputesPage'))
const ReviewFormsPage       = React.lazy(() => import('../pages/quality/ReviewFormsPage'))
const AuditFormPage         = React.lazy(() => import('../pages/quality/AuditFormPage'))
const SubmissionDetailPage  = React.lazy(() => import('../pages/quality/SubmissionDetailPage'))
const AIReviewInbox         = React.lazy(() => import('../pages/quality/AIReviewInbox'))
const AIReviewerFormsList   = React.lazy(() => import('../pages/quality/AIReviewerFormsList'))
const AIReviewerFormDetail  = React.lazy(() => import('../pages/quality/AIReviewerFormDetail'))
const RulePackLibrary       = React.lazy(() => import('../pages/quality/ai-reviewer/RulePackLibrary'))
const BasePromptLibrary     = React.lazy(() => import('../pages/quality/ai-reviewer/BasePromptLibrary'))

const CoachingSessionsPage      = React.lazy(() => import('../pages/training/CoachingSessionsPage'))
const CoachingSessionDetailPage = React.lazy(() => import('../pages/training/CoachingSessionDetailPage'))
const CoachingSessionFormPage   = React.lazy(() => import('../pages/training/CoachingSessionFormPage'))
const MyCoachingPage            = React.lazy(() => import('../pages/training/MyCoachingPage'))
const MyCoachingDetailPage      = React.lazy(() => import('../pages/training/MyCoachingDetailPage'))
const TrainingReportsPage       = React.lazy(() => import('../pages/training/TrainingReportsPage'))
const LibraryTopicsPage         = React.lazy(() => import('../pages/training/LibraryTopicsPage'))
const LibraryQuizzesPage        = React.lazy(() => import('../pages/training/LibraryQuizzesPage'))
const LibraryQuizFormPage       = React.lazy(() => import('../pages/training/LibraryQuizFormPage'))
const LibraryResourcesPage      = React.lazy(() => import('../pages/training/LibraryResourcesPage'))

const WriteUpsPage         = React.lazy(() => import('../pages/writeups/WriteUpsPage'))
const WriteUpFormPage      = React.lazy(() => import('../pages/writeups/WriteUpFormPage'))
const WriteUpDetailPage    = React.lazy(() => import('../pages/writeups/WriteUpDetailPage'))
const MyWriteUpsPage       = React.lazy(() => import('../pages/writeups/MyWriteUpsPage'))
const MyWriteUpDetailPage  = React.lazy(() => import('../pages/writeups/MyWriteUpDetailPage'))

// Scheduling — gated on the `sched_calendar` / `sched_exceptions` app_page rows.
const SchedulingPage           = React.lazy(() => import('../pages/scheduling/SchedulingPage'))
const MySchedulePage           = React.lazy(() => import('../pages/scheduling/MySchedulePage'))
const SchedulingExceptionsPage = React.lazy(() => import('../pages/scheduling/SchedulingExceptionsPage'))
const TimeOffImportReviewPage  = React.lazy(() => import('../pages/scheduling/TimeOffImportReviewPage'))
const CampaignSchedulePage     = React.lazy(() => import('../pages/scheduling/CampaignSchedulePage'))

const DashboardPage          = React.lazy(() => import('../pages/insights/DashboardPage'))
const TeamDashboardPage      = React.lazy(() => import('../pages/insights/TeamDashboardPage'))
const ReportBuilderPage      = React.lazy(() => import('../pages/insights/ReportBuilderPage'))
const SavedReportsPage       = React.lazy(() => import('../pages/insights/SavedReportsPage'))
const OnDemandReportsPage    = React.lazy(() => import('../pages/insights/OnDemandReportsPage'))
const OnDemandReportViewPage = React.lazy(() => import('../pages/insights/OnDemandReportViewPage'))
const DataExplorerPage       = React.lazy(() => import('../pages/insights/DataExplorerPage'))
const ExportPage             = React.lazy(() => import('../pages/insights/ExportPage'))
const ImportCenterPage       = React.lazy(() => import('../pages/insights/ImportCenterPage'))
const ImportHistoryPage      = React.lazy(() => import('../pages/insights/ImportHistoryPage'))
const QCOverviewPage         = React.lazy(() => import('../pages/insights/QCOverviewPage'))
const QCQualityPage          = React.lazy(() => import('../pages/insights/QCQualityPage'))
const QCCoachingPage         = React.lazy(() => import('../pages/insights/QCCoachingPage'))
const QCWarningsPage         = React.lazy(() => import('../pages/insights/QCWarningsPage'))
const QCAgentsPage           = React.lazy(() => import('../pages/insights/QCAgentsPage'))
const AACallActivityPage     = React.lazy(() => import('../pages/insights/AACallActivityPage'))
const AALeadsPage            = React.lazy(() => import('../pages/insights/AALeadsPage'))
const AAMarginPage           = React.lazy(() => import('../pages/insights/AAMarginPage'))
const AATicketsTasksPage     = React.lazy(() => import('../pages/insights/AATicketsTasksPage'))
const AAWorkloadPage         = React.lazy(() => import('../pages/insights/AAWorkloadPage'))
const AAEmailActivityPage    = React.lazy(() => import('../pages/insights/AAEmailActivityPage'))
const CSRAttendancePage      = React.lazy(() => import('../pages/insights/CSRAttendancePage'))
const CSRTicketsTasksPage    = React.lazy(() => import('../pages/insights/CSRTicketsTasksPage'))
const CSRWorkloadPage        = React.lazy(() => import('../pages/insights/CSRWorkloadPage'))

const NotFoundPage           = React.lazy(() => import('../pages/NotFoundPage'))

const ON_DEMAND_REPORT_ROLES = [ROLE_IDS.ADMIN, ROLE_IDS.MANAGER]

/**
 * Performance-warning detail entry point. Viewers who can see everyone's data
 * (ALL/EDIT) get the full editor detail; everyone else — notably the employee
 * the warning is about (OWN), who receives the same notification email — is
 * sent to their read-only `/my/:id` view instead of getting a 403.
 *
 * We can't do this with the guard alone because the redirect target depends
 * on the route param, so we resolve access here and branch on `canViewAll`.
 */
function PerformanceWarningDetailRoute(): React.ReactElement | null {
  const { user } = useAuth()
  const { id } = useParams()
  const { data, isLoading } = useQuery({
    queryKey: ['app-access', 'pw_list', user?.id],
    queryFn:  () => getAppAccess('pw_list'),
    enabled:  !!user,
    staleTime: 5 * 60 * 1000,
  })
  if (!user || isLoading) return null
  if (!data?.canViewAll) {
    return <Navigate to={`/app/performancewarnings/my/${id}`} replace />
  }
  return <PageLoader><WriteUpDetailPage /></PageLoader>
}

/**
 * Coaching session detail entry point. Reviewers who can see everyone's
 * sessions (ALL/EDIT) get the full session page; the CSR the session is about
 * (OWN) — who receives the coaching emails — is sent to their read-only
 * `/my-coaching/:id` view instead.
 */
function CoachingDetailRoute(): React.ReactElement | null {
  const { user } = useAuth()
  const { id } = useParams()
  const { data, isLoading } = useQuery({
    queryKey: ['app-access', 'training_coaching', user?.id],
    queryFn:  () => getAppAccess('training_coaching'),
    enabled:  !!user,
    staleTime: 5 * 60 * 1000,
  })
  if (!user || isLoading) return null
  if (!data?.canViewAll) {
    return <Navigate to={`/app/training/my-coaching/${id}`} replace />
  }
  return <PageLoader><CoachingSessionDetailPage /></PageLoader>
}

export default function AppRoutes(): React.ReactElement {
  return (
    <Routes>

      {/* Public */}
      <Route path="/login"            element={<LoginPage />} />
      <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
      <Route path="/reset-password"   element={<ResetPasswordPage />} />

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
          {/* /roles was removed — its content moved to /pages-access. */}
          <Route path="roles"            element={<Navigate to="/app/admin/pages-access" replace />} />
          <Route path="pages-access"     element={<AppPageAccessPage />} />
          <Route path="list-management"  element={<ListManagementPage />} />
          <Route path="email-templates"  element={<AdminEmailTemplatesPage />} />
          <Route path="system-settings"  element={<SystemSettingsPage />} />
          {/* Moved to Quality → Unlock Register; keep old bookmarks working. */}
          <Route path="quality/unlocks"  element={<Navigate to="/app/quality/unlocks" replace />} />
          <Route path="insights/kpis"       element={<InsightsKpiManagementPage />} />
          <Route path="insights/pages"      element={<InsightsPageManagementPage />} />
          <Route path="insights/calendar"   element={<InsightsCalendarPage />} />
          <Route path="insights/ingestion"  element={<InsightsIngestionLogPage />} />
          <Route path="insights/source-reports" element={<InsightsSourceReportsPage />} />
          <Route path="insights/import"     element={<ManualUploadPage />} />
        </Route>

        <Route element={<AppShell />}>

          {/* Root redirect */}
          <Route path="/" element={<RoleRedirect />} />
          <Route path="/app" element={<Navigate to="/" replace />} />

          {/* Quality — every page is gated by app_page_role_access. Forms
              is Admin-only; Review Forms / AI Reviewer / AI Inbox are
              Admin+QA writeable; Submissions and Disputes are reachable by
              every role (the page itself self-scopes via the backend).
              Audit (`/app/quality/audit`) is the per-call audit form a CSR
              fills out — left ungated; the backend service enforces who
              can submit. */}
          <Route path="/app/quality">
            <Route index element={<Navigate to="submissions" replace />} />
            <Route path="overview"        element={<Navigate to="/app/quality/submissions" replace />} />

            <Route path="forms"               element={<RequirePageAccess pageKey="quality_forms" minLevel="edit"><PageLoader><FormsPage /></PageLoader></RequirePageAccess>} />
            <Route path="forms/new"           element={<RequirePageAccess pageKey="quality_forms" minLevel="edit"><PageLoader><FormsPage /></PageLoader></RequirePageAccess>} />
            <Route path="forms/:id/edit"      element={<RequirePageAccess pageKey="quality_forms" minLevel="edit"><PageLoader><FormsPage /></PageLoader></RequirePageAccess>} />
            <Route path="forms/:id/preview"   element={<RequirePageAccess pageKey="quality_forms" minLevel="view"><PageLoader><FormsPage /></PageLoader></RequirePageAccess>} />
            <Route path="forms/:id/duplicate" element={<RequirePageAccess pageKey="quality_forms" minLevel="edit"><PageLoader><FormsPage /></PageLoader></RequirePageAccess>} />

            <Route path="submissions"       element={<RequirePageAccess pageKey="quality_submissions"><PageLoader><SubmissionsPage /></PageLoader></RequirePageAccess>} />
            <Route path="submissions/:id"   element={<RequirePageAccess pageKey="quality_submissions"><PageLoader><SubmissionDetailPage /></PageLoader></RequirePageAccess>} />

            <Route path="disputes"          element={<RequirePageAccess pageKey="quality_disputes"><PageLoader><DisputesPage /></PageLoader></RequirePageAccess>} />
            <Route path="dispute-history"   element={<Navigate to="/app/quality/disputes" replace />} />

            <Route path="analytics"       element={<Navigate to="/app/insights/qc-quality" replace />} />

            <Route path="review-forms"    element={<RequirePageAccess pageKey="quality_review_forms"><PageLoader><ReviewFormsPage /></PageLoader></RequirePageAccess>} />
            <Route path="audit"           element={<PageLoader><AuditFormPage /></PageLoader>} />

            <Route path="ai-inbox"        element={<RequirePageAccess pageKey="quality_ai_inbox"><PageLoader><AIReviewInbox /></PageLoader></RequirePageAccess>} />

            <Route path="ai-reviewer"            element={<RequirePageAccess pageKey="quality_ai_reviewer"><PageLoader><AIReviewerFormsList /></PageLoader></RequirePageAccess>} />
            <Route path="ai-reviewer/rule-packs" element={<RequirePageAccess pageKey="quality_ai_reviewer"><PageLoader><RulePackLibrary /></PageLoader></RequirePageAccess>} />
            <Route
              path="ai-reviewer/base-prompts"
              element={
                <RequireRole allowed={[ROLE_IDS.ADMIN]} fallback="/app/quality/ai-reviewer">
                  <PageLoader><BasePromptLibrary /></PageLoader>
                </RequireRole>
              }
            />
            <Route path="ai-reviewer/:formId"    element={<RequirePageAccess pageKey="quality_ai_reviewer"><PageLoader><AIReviewerFormDetail /></PageLoader></RequirePageAccess>} />

            {/* Unlock Register — admin-only audit of reopened reviews. Lives
                under Quality; gated by the `quality_unlock_register` app_page
                (only Admin is granted, so ALL+ = admin here). */}
            <Route path="unlocks"        element={<RequirePageAccess pageKey="quality_unlock_register" minLevel="viewAll" fallback="/app/quality/submissions"><PageLoader><UnlockRegisterPage /></PageLoader></RequirePageAccess>} />
          </Route>

          {/* Training. Coaching is one logical page (`training_coaching`):
              ALL/EDIT land on the editor list, OWN (CSR) on the self view.
              The guards keep each role on exactly one surface. */}
          <Route path="/app/training">
            <Route index element={<TrainingIndexRedirect />} />
            {/* Editor surfaces — need ALL+ to read everyone's sessions, EDIT to
                mutate. OWN users are bounced to my-coaching via fallback. */}
            <Route path="coaching"          element={<RequirePageAccess pageKey="training_coaching" minLevel="viewAll" fallback="/app/training/my-coaching"><PageLoader><CoachingSessionsPage /></PageLoader></RequirePageAccess>} />
            <Route path="coaching/new"      element={<RequirePageAccess pageKey="training_coaching" minLevel="edit" fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequirePageAccess>} />
            <Route path="coaching/:id"      element={<CoachingDetailRoute />} />
            <Route path="coaching/:id/edit" element={<RequirePageAccess pageKey="training_coaching" minLevel="edit" fallback="/app/training/my-coaching"><PageLoader><CoachingSessionFormPage /></PageLoader></RequirePageAccess>} />
            {/* Self surface — OWN only. Editors (ALL/EDIT) are sent to the list. */}
            <Route path="my-coaching"       element={<RequirePageAccess pageKey="training_coaching" minLevel="view" redirectViewAllTo="/app/training/coaching"><PageLoader><MyCoachingPage /></PageLoader></RequirePageAccess>} />
            <Route path="my-coaching/:id"   element={<RequirePageAccess pageKey="training_coaching" minLevel="view" redirectViewAllTo="/app/training/coaching"><PageLoader><MyCoachingDetailPage /></PageLoader></RequirePageAccess>} />
            <Route path="reports"           element={<RequirePageAccess pageKey="training_reports" minLevel="viewAll"><PageLoader><TrainingReportsPage /></PageLoader></RequirePageAccess>} />
            <Route path="library">
              <Route index element={<Navigate to="topics" replace />} />
              <Route path="topics"           element={<RequirePageAccess pageKey="training_library_topics" minLevel="view"><PageLoader><LibraryTopicsPage /></PageLoader></RequirePageAccess>} />
              <Route path="quizzes"          element={<RequirePageAccess pageKey="training_library_quizzes" minLevel="view"><PageLoader><LibraryQuizzesPage /></PageLoader></RequirePageAccess>} />
              <Route path="quizzes/new"      element={<RequirePageAccess pageKey="training_library_quizzes" minLevel="edit"><PageLoader><LibraryQuizFormPage /></PageLoader></RequirePageAccess>} />
              <Route path="quizzes/:id/edit" element={<RequirePageAccess pageKey="training_library_quizzes" minLevel="edit"><PageLoader><LibraryQuizFormPage /></PageLoader></RequirePageAccess>} />
              <Route path="resources"        element={<RequirePageAccess pageKey="training_library_resources" minLevel="view"><PageLoader><LibraryResourcesPage /></PageLoader></RequirePageAccess>} />
            </Route>
          </Route>

          <Route path="/app/writeups/*" element={<RedirectWriteupsToPerformanceWarnings />} />

          {/* Performance Warnings — one logical page (`pw_list`). ALL/EDIT
              land on the editor list/detail; OWN (the employee the warning is
              about) lands on the self `/my*` view. The backend list/detail
              services self-scope OWN viewers as a second line of defense. */}
          <Route path="/app/performancewarnings">
            <Route index element={<Navigate to="list" replace />} />
            <Route
              path="list"
              element={
                <RequirePageAccess pageKey="pw_list" minLevel="viewAll" fallback="/app/performancewarnings/my">
                  <PageLoader><WriteUpsPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="new"
              element={
                <RequirePageAccess pageKey="pw_list" minLevel="edit" fallback="/app/performancewarnings/my">
                  <PageLoader><WriteUpFormPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route path=":id" element={<PerformanceWarningDetailRoute />} />
            <Route
              path=":id/edit"
              element={
                <RequirePageAccess pageKey="pw_list" minLevel="edit" fallback="/app/performancewarnings/my">
                  <PageLoader><WriteUpFormPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="my"
              element={
                <RequirePageAccess pageKey="pw_list" minLevel="view" redirectViewAllTo="/app/performancewarnings/list">
                  <PageLoader><MyWriteUpsPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="my/:id"
              element={
                <RequirePageAccess pageKey="pw_list" minLevel="view" redirectViewAllTo="/app/performancewarnings/list">
                  <PageLoader><MyWriteUpDetailPage /></PageLoader>
                </RequirePageAccess>
              }
            />
          </Route>

          {/* Scheduling — one logical calendar page (`sched_calendar`). ALL/EDIT
              land on the editor grid; OWN (agents) land on the self schedule.
              Backend readGrid/readMySchedule self-scope OWN viewers as defence. */}
          <Route path="/app/scheduling">
            <Route index element={<Navigate to="calendar" replace />} />
            <Route
              path="calendar"
              element={
                <RequirePageAccess pageKey="sched_calendar" minLevel="viewAll" fallback="/app/scheduling/my-schedule">
                  <PageLoader><SchedulingPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="my-schedule"
              element={
                <RequirePageAccess pageKey="sched_calendar" minLevel="view" redirectViewAllTo="/app/scheduling/calendar">
                  <PageLoader><MySchedulePage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="exceptions"
              element={
                <RequirePageAccess pageKey="sched_exceptions" minLevel="viewAll" fallback="/app/scheduling/calendar">
                  <PageLoader><SchedulingExceptionsPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="time-off-import"
              element={
                <RequirePageAccess pageKey="sched_exceptions" minLevel="viewAll" fallback="/app/scheduling/calendar">
                  <PageLoader><TimeOffImportReviewPage /></PageLoader>
                </RequirePageAccess>
              }
            />
            <Route
              path="campaigns"
              element={
                <RequirePageAccess pageKey="sched_campaigns" minLevel="view">
                  <PageLoader><CampaignSchedulePage /></PageLoader>
                </RequirePageAccess>
              }
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
            {/* Agent Activity - Sales */}
            <Route path="aa-call"     element={<RequireInsightsAccess pageKey="aa_sales_call"><PageLoader><AACallActivityPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="aa-leads"    element={<RequireInsightsAccess pageKey="aa_sales_leads"><PageLoader><AALeadsPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="aa-margin"   element={<RequireInsightsAccess pageKey="aa_sales_margin"><PageLoader><AAMarginPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="aa-tickets"  element={<RequireInsightsAccess pageKey="aa_sales_tickets"><PageLoader><AATicketsTasksPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="aa-workload" element={<RequireInsightsAccess pageKey="aa_sales_productivity"><PageLoader><AAWorkloadPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="aa-productivity" element={<Navigate to="/app/insights/aa-workload" replace />} />
            <Route path="aa-email"    element={<RequireInsightsAccess pageKey="aa_sales_email"><PageLoader><AAEmailActivityPage /></PageLoader></RequireInsightsAccess>} />
            {/* Agent Activity - CSR */}
            <Route path="csr-attendance" element={<RequireInsightsAccess pageKey="csr_attendance"><PageLoader><CSRAttendancePage /></PageLoader></RequireInsightsAccess>} />
            <Route path="csr-tickets"    element={<RequireInsightsAccess pageKey="csr_tickets"><PageLoader><CSRTicketsTasksPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="csr-workload" element={<RequireInsightsAccess pageKey="csr_productivity"><PageLoader><CSRWorkloadPage /></PageLoader></RequireInsightsAccess>} />
            <Route path="csr-productivity" element={<Navigate to="/app/insights/csr-workload" replace />} />
            <Route path="dashboard" element={<PageLoader><DashboardPage /></PageLoader>} />
            <Route path="team"      element={<PageLoader><TeamDashboardPage /></PageLoader>} />
            <Route path="builder"   element={<PageLoader><ReportBuilderPage /></PageLoader>} />
            <Route path="reports"   element={<PageLoader><SavedReportsPage /></PageLoader>} />
            <Route
              path="on-demand-reports"
              element={
                <RequireRole allowed={ON_DEMAND_REPORT_ROLES} fallback="/app/insights">
                  <PageLoader><OnDemandReportsPage /></PageLoader>
                </RequireRole>
              }
            />
            <Route
              path="on-demand-reports/:reportId"
              element={
                <RequireRole allowed={ON_DEMAND_REPORT_ROLES} fallback="/app/insights">
                  <PageLoader><OnDemandReportViewPage /></PageLoader>
                </RequireRole>
              }
            />
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
  )
}
