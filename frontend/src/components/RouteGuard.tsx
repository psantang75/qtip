import React, { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from './ui/LoadingSpinner';

interface RouteGuardProps {
  children: React.ReactNode;
  allowedRoles: number[];
  fallbackPath?: string;
  loadingComponent?: React.ReactNode;
  requiresAuth?: boolean;
  routeName?: string;
}

/**
 * Enhanced Route Guard Component
 * 
 * Features:
 * - Role-based access control
 * - Loading states during authentication checks
 * - Custom fallback components
 * - Better error handling
 * - Route transition animations
 */
const RouteGuard: React.FC<RouteGuardProps> = ({
  children,
  allowedRoles,
  fallbackPath = '/login',
  loadingComponent,
  requiresAuth = true,
  routeName
}) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [routeLoading, setRouteLoading] = useState(true);

  useEffect(() => {
    // Simulate route loading delay for better UX and smooth transitions
    const timer = setTimeout(() => {
      setRouteLoading(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [location.pathname]);

  // Show loading state during auth check or route transition
  if (isLoading || routeLoading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }

    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-50">
        <div className="text-center">
          <LoadingSpinner size="lg" color="primary" />
          <p className="mt-4 text-sm text-gray-600">
            {routeName ? `Loading ${routeName}...` : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  // Check authentication if required
  if (requiresAuth && !isAuthenticated) {
    return <Navigate to={fallbackPath} state={{ from: location }} replace />;
  }

  // Check role permissions
  if (requiresAuth && user && !allowedRoles.includes(user.role_id)) {
    // Debug logging for role permission issues
    console.log('RouteGuard - User role_id:', user.role_id);
    console.log('RouteGuard - Allowed roles:', allowedRoles);
    console.log('RouteGuard - User has access?', allowedRoles.includes(user.role_id));
    console.log('RouteGuard - Redirecting to:', getUserDashboardPath(user.role_id));
    
    // Redirect to appropriate dashboard based on user role
    const redirectPath = getUserDashboardPath(user.role_id);
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
};

/**
 * Get default dashboard path for user role
 */
const getUserDashboardPath = (roleId: number): string => {
  switch (roleId) {
    case 1: return '/admin/dashboard';
    case 2: return '/qa/dashboard';
    case 3: return '/dashboard';
    case 4: return '/trainer/dashboard';
    case 5: return '/manager/dashboard';
    case 6: return '/director/performance-reports';
    default: return '/dashboard';
  }
};

/**
 * Enhanced Admin Route Guard
 */
export const AdminGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  
  // Debug logging for Admin access
  console.log('AdminGuard - User:', user);
  console.log('AdminGuard - User role_id:', user?.role_id);
  console.log('AdminGuard - Is Admin?', user?.role_id === 1);
  
  return (
    <RouteGuard allowedRoles={[1]} routeName="Admin Panel">
      {children}
    </RouteGuard>
  );
};

/**
 * Enhanced QA Route Guard
 */
export const QAGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteGuard allowedRoles={[2]} routeName="QA Dashboard">
    {children}
  </RouteGuard>
);

/**
 * Enhanced Manager Route Guard
 */
export const ManagerGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteGuard allowedRoles={[5]} routeName="Manager Dashboard">
    {children}
  </RouteGuard>
);

/**
 * Enhanced Trainer Route Guard
 */
export const TrainerGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteGuard allowedRoles={[4]} routeName="Trainer Portal">
    {children}
  </RouteGuard>
);

/**
 * Enhanced Director Route Guard
 */
export const DirectorGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteGuard allowedRoles={[6]} routeName="Director Portal">
    {children}
  </RouteGuard>
);

/**
 * Enhanced Protected Route (any authenticated user)
 */
export const ProtectedGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RouteGuard allowedRoles={[1, 2, 3, 4, 5, 6]} routeName="Dashboard">
    {children}
  </RouteGuard>
);

export default RouteGuard; 