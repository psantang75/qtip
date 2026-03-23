import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import DashboardLayout from './components/DashboardLayout';

// Lazy load components to reduce bundle size
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));
const AdminCompletedForms = React.lazy(() => import('./components/AdminCompletedForms'));
const UserManagement = React.lazy(() => import('./components/UserManagement'));
const DepartmentManagement = React.lazy(() => import('./components/DepartmentManagement'));
const TopicsManagement = React.lazy(() => import('./components/TopicsManagement'));
const DirectorAssignment = React.lazy(() => import('./components/DirectorAssignment'));
const SinglePageFormBuilder = React.lazy(() => import('./components/SinglePageFormBuilder'));
const FormManagement = React.lazy(() => import('./components/FormManagement'));
const FormPreviewScreen = React.lazy(() => import('./components/FormPreviewScreen'));
const AuditAssignmentsManagement = React.lazy(() => import('./components/AuditAssignmentsManagement'));
const AuditAssignmentCreation = React.lazy(() => import('./components/AuditAssignmentCreation'));
// Fix for named export
const EnhancedPerformanceGoals = React.lazy(() => 
  import('./components/admin/EnhancedPerformanceGoals').then(module => ({ default: module.EnhancedPerformanceGoals }))
);
const QADashboard = React.lazy(() => import('./components/QADashboard'));
const QARoute = React.lazy(() => import('./components/QARoute'));
const QAAssignedReviews = React.lazy(() => import('./components/QAAssignedReviews'));
const QAAssignedAuditsList = React.lazy(() => import('./components/QAAssignedAuditsList'));
const QACompletedReviews = React.lazy(() => import('./components/QACompletedReviews'));
const QASubmissionDetails = React.lazy(() => import('./components/QASubmissionDetails'));
const QAManualReview = React.lazy(() => import('./components/QAManualReview'));
const QAManualAuditForm = React.lazy(() => import('./components/QAManualAuditForm'));
const CSRDashboard = React.lazy(() => import('./components/CSRDashboard'));
const RoleDashboard = React.lazy(() => import('./components/RoleDashboard'));
const CSRMyAudits = React.lazy(() => import('./components/CSRMyAudits'));
const CSRDisputeHistory = React.lazy(() => import('./components/CSRDisputeHistory'));
const CSRDisputeDetails = React.lazy(() => import('./components/CSRDisputeDetails'));
const CSRTrainingDashboard = React.lazy(() => import('./components/CSRTrainingDashboard'));
const CSRCourseViewer = React.lazy(() => import('./components/CSRCourseViewer'));
const CSRCertificates = React.lazy(() => import('./components/CSRCertificates'));
const CSRCoaching = React.lazy(() => import('./components/CSRCoaching'));
const ManagerDashboard = React.lazy(() => import('./components/ManagerDashboard'));
const ManagerTeamAudits = React.lazy(() => import('./components/ManagerTeamAudits'));
const ManagerDisputeResolution = React.lazy(() => import('./components/ManagerDisputeResolution'));
const ManagerPerformanceReports = React.lazy(() => import('./components/ManagerPerformanceReports'));
const TrainerDashboard = React.lazy(() => import('./components/TrainerDashboard'));
const TrainerReports = React.lazy(() => import('./components/TrainerReports'));
const TrainerManagerCoaching = React.lazy(() => import('./components/TrainerManagerCoaching'));
const ManagerTeamTraining = React.lazy(() => import('./components/ManagerTeamTraining'));
const ManagerCoachingSessions = React.lazy(() => import('./components/ManagerCoachingSessions'));
const ComprehensiveAnalytics = React.lazy(() => import('./components/ComprehensiveAnalytics'));
const ProfileSettings = React.lazy(() => import('./components/ProfileSettings'));

// Import RouteGuard components
import { AdminGuard, QAGuard, ManagerGuard, TrainerGuard, DirectorGuard, ProtectedGuard } from './components/RouteGuard';

// Loading component for lazy loading
const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-screen bg-neutral-100">
    <div className="animate-spin h-12 w-12 text-primary-blue">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
  </div>
);

// Wrapper for lazy components
const LazyWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<LoadingSpinner />}>
    {children}
  </React.Suspense>
);

// Custom default route component that redirects based on role
const RoleBasedRedirect: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  // Redirect based on user role
  switch (user?.role_id) {
    case 1: // Admin
      return <Navigate to="/admin/dashboard" />;
    case 2: // QA
      return <Navigate to="/qa/dashboard" />;
    case 4: // Trainer
      return <Navigate to="/trainer/dashboard" />;
    case 5: // Manager
      return <Navigate to="/manager/dashboard" />;
    case 6: // Director
      return <Navigate to="/director/performance-reports" />;
    default:
      return <Navigate to="/dashboard" />;
  }
};

// Layout wrapper
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  
  if (isLoginPage) {
    return <div className="min-h-screen flex flex-col bg-neutral-100">{children}</div>;
  }
  
  return <DashboardLayout>{children}</DashboardLayout>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppLayout>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            {/* QA routes */}
            <Route 
              path="/qa/assigned-reviews" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QAAssignedAuditsList />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/assigned-reviews/:auditId" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QAAssignedReviews />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/completed-reviews" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QACompletedReviews />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/completed-reviews/:id" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QASubmissionDetails />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/manual-reviews" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QAManualReview />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/manual-reviews/form" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QAManualAuditForm />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/dashboard" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <QADashboard />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/analytics" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <ComprehensiveAnalytics />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/qa/disputes" 
              element={
                <LazyWrapper>
                  <QAGuard>
                    <ManagerDisputeResolution />
                  </QAGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Main dashboard route */}
            <Route 
              path="/dashboard" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <RoleDashboard />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Profile Settings - Available to all authenticated users */}
            <Route 
              path="/profile" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <ProfileSettings />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            
            {/* CSR routes */}
            <Route 
              path="/my-audits" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <CSRMyAudits />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/my-audits/:id" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <QASubmissionDetails />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/dispute-history" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <CSRDisputeHistory />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/disputes/:id" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <CSRDisputeDetails />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/my-coaching" 
              element={
                <LazyWrapper>
                  <ProtectedGuard>
                    <CSRCoaching />
                  </ProtectedGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Manager routes */}
            <Route 
              path="/manager/dashboard" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ManagerDashboard />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/team-audits" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ManagerTeamAudits />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/team-audits/:id" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <QASubmissionDetails />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/team-training" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ManagerTeamTraining />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/disputes" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ManagerDisputeResolution />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/coaching" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ManagerCoachingSessions />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/manager/analytics" 
              element={
                <LazyWrapper>
                  <ManagerGuard>
                    <ComprehensiveAnalytics />
                  </ManagerGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Trainer routes */}
            <Route 
              path="/trainer/dashboard" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <TrainerDashboard />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/trainer/reports" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <TrainerReports />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/trainer/analytics" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <ComprehensiveAnalytics />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/trainer/manager-coaching" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <TrainerManagerCoaching />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/trainer/completed-reviews" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <QACompletedReviews />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/trainer/completed-reviews/:id" 
              element={
                <LazyWrapper>
                  <TrainerGuard>
                    <QASubmissionDetails />
                  </TrainerGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Director routes */}
            <Route 
              path="/director/performance-reports" 
              element={
                <LazyWrapper>
                  <DirectorGuard>
                    <ManagerPerformanceReports />
                  </DirectorGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Admin routes */}
            <Route 
              path="/admin/dashboard" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <AdminDashboard />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/users" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <UserManagement />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/departments" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <DepartmentManagement />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/topics" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <TopicsManagement />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/forms" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <FormManagement />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/forms/new" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <SinglePageFormBuilder />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/forms/:formId" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <SinglePageFormBuilder />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/forms/:formId/preview" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <FormPreviewScreen />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/forms/preview" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <FormPreviewScreen />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/audit-assignments" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <AuditAssignmentsManagement />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/audit-assignments/create" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <AuditAssignmentCreation />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/completed-forms" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <AdminCompletedForms />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/completed-forms/:id" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <QASubmissionDetails />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/goals" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <EnhancedPerformanceGoals />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/disputes" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <ManagerDisputeResolution />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/coaching" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <ManagerCoachingSessions />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/analytics" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <ComprehensiveAnalytics />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            <Route 
              path="/admin/director-assignment" 
              element={
                <LazyWrapper>
                  <AdminGuard>
                    <DirectorAssignment />
                  </AdminGuard>
                </LazyWrapper>
              } 
            />
            
            {/* Root path redirects based on user role */}
            <Route path="/" element={<RoleBasedRedirect />} />
            {/* Fallback route for anything else */}
            <Route path="*" element={<RoleBasedRedirect />} />
          </Routes>
        </AppLayout>
      </Router>
    </AuthProvider>
  );
}

export default App;

