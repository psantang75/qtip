import React, { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from './ui/LoadingSpinner';

/**
 * User role mapping for consistent role identification
 */
const ROLE_MAP = {
  1: 'Admin',
  2: 'QA', 
  3: 'CSR',
  4: 'Trainer',
  5: 'Manager',
  6: 'Director'
} as const;

/**
 * Props for QARoute component
 */
interface QARouteProps {
  /** Child components to render when access is granted */
  children: React.ReactNode;
  /** Optional fallback redirect path for non-QA users */
  fallbackPath?: string;
  /** Optional custom loading message */
  loadingMessage?: string;
}

/**
 * QARoute Component
 * 
 * Route protection component that ensures only QA users can access certain routes.
 * Provides loading states and automatic redirects for unauthorized users.
 * 
 * Features:
 * - QA role verification (role_id === 2)
 * - Loading state management
 * - Automatic redirects for unauthorized access
 * - Customizable fallback paths
 * - Modern UI components
 * - Type-safe role checking
 * 
 * @example
 * ```tsx
 * <QARoute fallbackPath="/dashboard">
 *   <QADashboard />
 * </QARoute>
 * ```
 */
const QARoute: React.FC<QARouteProps> = ({ 
  children, 
  fallbackPath = '/dashboard',
  loadingMessage = 'Verifying QA access...'
}) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Memoized role checking for performance
  const userRole = useMemo(() => {
    if (!user?.role_id) return null;
    return ROLE_MAP[user.role_id as keyof typeof ROLE_MAP] || null;
  }, [user?.role_id]);

  const isQA = userRole === 'QA';

  // Show loading state while authentication is being verified
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-100">
        <div className="text-center">
          <LoadingSpinner size="lg" color="primary" />
          <p className="mt-4 text-sm text-gray-600">{loadingMessage}</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Redirect to fallback path if user is not QA
  if (!isQA) {
    return <Navigate to={fallbackPath} replace />;
  }

  // Render protected content for QA users
  return <>{children}</>;
};

export default QARoute; 