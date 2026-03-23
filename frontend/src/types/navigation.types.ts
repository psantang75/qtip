/**
 * Navigation Types for QTIP Application
 * 
 * Defines type-safe route configuration, user roles, permissions,
 * and navigation components for the enhanced navigation system.
 */

import { ReactNode } from 'react';

/**
 * User role definitions
 */
export const UserRole = {
  ADMIN: 1,
  QA: 2,
  CSR: 3,
  TRAINER: 4,
  MANAGER: 5,
  DIRECTOR: 6
} as const;

export type UserRole = typeof UserRole[keyof typeof UserRole];

/**
 * Role display information
 */
export interface RoleInfo {
  id: UserRole;
  name: string;
  displayName: string;
  color: string;
  icon: string;
}

/**
 * Route permissions configuration
 */
export interface RoutePermissions {
  /** Required user roles to access this route */
  roles: UserRole[];
  /** Whether route requires authentication */
  requiresAuth: boolean;
  /** Custom permission check function */
  customCheck?: (user: any) => boolean;
}

/**
 * Breadcrumb item configuration
 */
export interface BreadcrumbItem {
  /** Display label for breadcrumb */
  label: string;
  /** Route path - undefined for non-clickable items */
  path?: string;
  /** Icon component for breadcrumb */
  icon?: ReactNode;
  /** Whether this is the current/active item */
  isActive?: boolean;
}

/**
 * Navigation route configuration
 */
export interface RouteConfig {
  /** Unique route identifier */
  id: string;
  /** Route path pattern */
  path: string;
  /** Display label for navigation */
  label: string;
  /** Short description of route purpose */
  description?: string;
  /** Route permissions */
  permissions: RoutePermissions;
  /** Parent route ID for hierarchical navigation */
  parentId?: string;
  /** Icon component for navigation */
  icon?: ReactNode;
  /** Whether route should be hidden from navigation */
  hidden?: boolean;
  /** Route category for grouping */
  category?: string;
  /** Breadcrumb configuration */
  breadcrumb?: {
    /** Custom label for breadcrumb (defaults to route label) */
    label?: string;
    /** Whether to show this route in breadcrumbs */
    show?: boolean;
    /** Function to generate dynamic breadcrumb */
    dynamic?: (params: any) => BreadcrumbItem;
  };
  /** Loading state configuration */
  loading?: {
    /** Custom loading message */
    message?: string;
    /** Whether to show loading spinner */
    showSpinner?: boolean;
  };
}

/**
 * Navigation menu section
 */
export interface NavigationSection {
  /** Section identifier */
  id: string;
  /** Section display label */
  label: string;
  /** Section icon */
  icon?: ReactNode;
  /** Routes in this section */
  routes: RouteConfig[];
  /** Whether section is collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Section permissions */
  permissions?: RoutePermissions;
}

/**
 * Route transition states
 */
export const RouteTransitionState = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
} as const;

export type RouteTransitionState = typeof RouteTransitionState[keyof typeof RouteTransitionState];

/**
 * Route transition information
 */
export interface RouteTransition {
  /** Current transition state */
  state: RouteTransitionState;
  /** Previous route path */
  from?: string;
  /** Target route path */
  to?: string;
  /** Transition start time */
  startTime?: number;
  /** Error information if transition failed */
  error?: Error;
}

/**
 * Navigation context state
 */
export interface NavigationState {
  /** Currently active route */
  currentRoute?: RouteConfig;
  /** Current breadcrumb trail */
  breadcrumbs: BreadcrumbItem[];
  /** Route transition state */
  transition: RouteTransition;
  /** Available routes for current user */
  availableRoutes: RouteConfig[];
  /** Navigation sections for current user */
  navigationSections: NavigationSection[];
}

/**
 * Navigation hook return type
 */
export interface UseNavigationReturn {
  /** Current navigation state */
  state: NavigationState;
  /** Navigate to a route */
  navigateTo: (path: string) => void;
  /** Check if user can access route */
  canAccess: (routeId: string) => boolean;
  /** Get route configuration by path */
  getRouteByPath: (path: string) => RouteConfig | undefined;
  /** Generate breadcrumbs for current route */
  getBreadcrumbs: () => BreadcrumbItem[];
  /** Refresh navigation state */
  refresh: () => void;
}

/**
 * Route guard result
 */
export interface RouteGuardResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Redirect path if access denied */
  redirectTo?: string;
  /** Error message if access denied */
  reason?: string;
}

/**
 * Enhanced route guard props
 */
export interface RouteGuardProps {
  /** Child components to render if access allowed */
  children: ReactNode;
  /** Required permissions */
  permissions: RoutePermissions;
  /** Custom fallback component */
  fallback?: ReactNode;
  /** Loading component */
  loadingComponent?: ReactNode;
  /** Route configuration */
  route?: RouteConfig;
} 