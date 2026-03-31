import { useState, useCallback } from 'react';
import { useAuth as useAuthContext } from '../contexts/AuthContext';
import authService from '../services/authService';
import type { User, LoginFormData } from '../services/authService';

/**
 * Enhanced authentication hook
 * Works alongside existing AuthContext to provide additional auth utilities
 */
export const useAuth = () => {
  const context = useAuthContext();
  const [isValidating, setIsValidating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Enhanced login with additional features
  const enhancedLogin = useCallback(async (
    credentials: LoginFormData, 
    options?: { rememberMe?: boolean; redirectTo?: string }
  ) => {
    try {
      await context.login(credentials);
      
      // Handle remember me functionality
      if (options?.rememberMe) {
        localStorage.setItem('qtip_remember_user', credentials.email);
      } else {
        localStorage.removeItem('qtip_remember_user');
      }
      
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Login failed' 
      };
    }
  }, [context]);

  // Enhanced logout with cleanup
  const enhancedLogout = useCallback(async (clearRemembered = false) => {
    try {
      context.logout();
      
      if (clearRemembered) {
        localStorage.removeItem('qtip_remember_user');
      }
      
      // Clear any cached data
      sessionStorage.clear();
      
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Logout failed' 
      };
    }
  }, [context]);

  // Validate current session
  const validateSession = useCallback(async () => {
    if (isValidating) return context.isAuthenticated;
    
    setIsValidating(true);
    try {
      const token = authService.getToken();
      if (!token) {
        return false;
      }

      // TODO: Add token validation API call when available
      // For now, check if token exists and user is stored
      const user = authService.getCurrentUser();
      return !!(token && user);
    } catch (error) {
      console.error('Session validation failed:', error);
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [context.isAuthenticated, isValidating]);

  // Refresh token/session
  const refreshSession = useCallback(async () => {
    if (refreshing) return { success: false, error: 'Already refreshing' };
    
    setRefreshing(true);
    try {
      // TODO: Implement token refresh when backend supports it
      const isValid = await validateSession();
      
      if (!isValid) {
        context.logout();
        return { success: false, error: 'Session expired' };
      }
      
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Session refresh failed' 
      };
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, validateSession, context]);

  // Check if user has specific permission
  const hasPermission = useCallback((permission: string) => {
    const user = context.user;
    if (!user) return false;
    
    // TODO: Implement proper permission checking when permissions are available
    // For now, basic role-based checks
    switch (permission) {
      case 'admin':
        return user.role_id === 1;
      case 'manager':
        return user.role_id === 2;
      case 'qa':
        return user.role_id === 3;
      case 'csr':
        return user.role_id === 4;
      default:
        return false;
    }
  }, [context.user]);

  // Check if user has any of the specified roles
  const hasAnyRole = useCallback((roles: string[]) => {
    return roles.some(role => hasPermission(role));
  }, [hasPermission]);

  // Get remembered email
  const getRememberedEmail = useCallback(() => {
    return localStorage.getItem('qtip_remember_user') || '';
  }, []);

  // Get user role name
  const getUserRole = useCallback(() => {
    const user = context.user;
    if (!user) return null;
    
    // Map role IDs to names (based on existing patterns)
    const roleMap: Record<number, string> = {
      1: 'Admin',
      2: 'Manager', 
      3: 'QA',
      4: 'CSR',
      5: 'Director',
      6: 'Trainer'
    };
    
    return roleMap[user.role_id] || 'Unknown';
  }, [context.user]);

  // Get user department info
  const getUserDepartment = useCallback(() => {
    const user = context.user;
    if (!user) return null;
    
    return {
      id: user.department_id,
      name: (user as typeof user & { department_name?: string }).department_name || null
    };
  }, [context.user]);

  // Check if user is in specific department
  const isInDepartment = useCallback((departmentId: number) => {
    const user = context.user;
    return user?.department_id === departmentId;
  }, [context.user]);

  return {
    // Original context properties
    ...context,
    
    // Enhanced authentication methods
    enhancedLogin,
    enhancedLogout,
    
    // Session management
    validateSession,
    refreshSession,
    isValidating,
    refreshing,
    
    // Permission and role utilities
    hasPermission,
    hasAnyRole,
    getUserRole,
    getUserDepartment,
    isInDepartment,
    
    // Utility methods
    getRememberedEmail,
    
    // User info shortcuts
    isAdmin: hasPermission('admin'),
    isManager: hasPermission('manager'),
    isQA: hasPermission('qa'),
    isCSR: hasPermission('csr'),
    
    // Session info
    sessionExpiry: null, // TODO: Implement when backend provides token expiry
    timeUntilExpiry: null // TODO: Calculate from token expiry
  };
}; 