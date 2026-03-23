import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import LoadingPage from '../ui/LoadingPage';
import ErrorDisplay from '../ui/ErrorDisplay';
import {
  RouteGuard as RouteGuardConfig,
  RouteAccessLevel,
  UserRoleId,
  DEFAULT_ROUTES
} from '../../types/routes.types';

interface RouteGuardProps {
  children: React.ReactNode;
  guard: RouteGuardConfig;
  fallback?: React.ComponentType;
}

/**
 * Enhanced Route Guard Component with TypeScript types and better UX
 * 
 * Features:
 * - Type-safe role checking
 * - Improved loading states
 * - Better error handling
 * - Flexible fallback components
 * - Comprehensive access control
 */
const RouteGuard: React.FC<RouteGuardProps> = ({ 
  children, 
  guard,
  fallback: CustomFallback 
}) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  // Show loading state while auth is being checked
  if (isLoading) {
    if (CustomFallback) {
      return <CustomFallback />;
    }
    return <LoadingPage message="Checking access permissions..." />;
  }



  // Handle public routes
  if (guard.type === RouteAccessLevel.PUBLIC) {
    return <>{children}</>;
  }

  // Check if user is authenticated for protected routes
  if (!user) {
    return (
      <Navigate 
        to={guard.redirect || DEFAULT_ROUTES.LOGIN} 
        state={{ from: location.pathname }}
        replace 
      />
    );
  }

  // Check role-specific access
  if (guard.type === RouteAccessLevel.ROLE_SPECIFIC && guard.roles) {
    const userRoleId = user.role_id as UserRoleId;
    const hasAccess = guard.roles.includes(userRoleId);

    if (!hasAccess) {
      return (
        <Navigate 
          to={guard.redirect || DEFAULT_ROUTES.UNAUTHORIZED} 
          state={{ 
            from: location.pathname,
            requiredRoles: guard.roles,
            userRole: userRoleId
          }}
          replace 
        />
      );
    }
  }

  // User has access, render children
  return <>{children}</>;
};

export default RouteGuard; 