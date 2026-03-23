import React from 'react';

/**
 * User role IDs as constants for type safety
 */
export const USER_ROLES = {
  ADMIN: 1,
  QA_ANALYST: 2,
  CSR: 3,
  TRAINER: 4,
  MANAGER: 5,
  DIRECTOR: 6,
} as const;

export type UserRoleId = typeof USER_ROLES[keyof typeof USER_ROLES];

/**
 * Route access levels for permissions
 */
export const RouteAccessLevel = {
  PUBLIC: 'public',           // No authentication required
  AUTHENTICATED: 'authenticated', // Authentication required, any role
  ROLE_SPECIFIC: 'role_specific', // Specific roles required
} as const;

export type RouteAccessLevel = typeof RouteAccessLevel[keyof typeof RouteAccessLevel];

/**
 * Route guard configuration
 */
export interface RouteGuard {
  type: RouteAccessLevel;
  roles?: UserRoleId[];
  redirect?: string;           // Where to redirect if access denied
  fallback?: React.ComponentType; // Component to show while checking access
}

/**
 * Route metadata for additional functionality
 */
export interface RouteMetadata {
  title: string;               // Page title for document head
  description?: string;        // Meta description
  breadcrumb?: string;         // Breadcrumb label (if different from title)
  hideFromNav?: boolean;       // Hide from navigation menus
  icon?: React.ComponentType<{ className?: string }>; // Navigation icon
  badge?: string | number;     // Navigation badge
  group?: string;              // Navigation group/section
  order?: number;              // Order within group
}

/**
 * Main route configuration interface
 */
export interface RouteConfig {
  path: string;
  component: React.ComponentType<any>;
  exact?: boolean;
  guard: RouteGuard;
  metadata: RouteMetadata;
  children?: RouteConfig[];    // Nested routes
}

/**
 * Navigation item interface (derived from routes)
 */
export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  children?: NavigationItem[];
  roles: UserRoleId[];
  group?: string;
  order?: number;
}

/**
 * Navigation section interface
 */
export interface NavigationSection {
  id: string;
  title: string;
  items: NavigationItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  order?: number;
  roles: UserRoleId[];         // Roles that can see this section
}

/**
 * Breadcrumb item interface
 */
export interface BreadcrumbItem {
  label: string;
  path?: string;              // Omit path for current page
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Route context interface for components
 */
export interface RouteContext {
  currentRoute: RouteConfig | null;
  breadcrumbs: BreadcrumbItem[];
  navigation: NavigationSection[];
  isAuthorized: (route: RouteConfig) => boolean;
  canAccess: (roles: UserRoleId[]) => boolean;
}

/**
 * Route transition types
 */
export const RouteTransition = {
  NONE: 'none',
  FADE: 'fade',
  SLIDE: 'slide',
  SCALE: 'scale',
} as const;

export type RouteTransition = typeof RouteTransition[keyof typeof RouteTransition];

/**
 * Loading state types for routes
 */
export interface RouteLoadingState {
  isLoading: boolean;
  hasError: boolean;
  error?: Error;
  progress?: number;          // 0-100 for progress indication
}

/**
 * Route change event interface
 */
export interface RouteChangeEvent {
  from: string;
  to: string;
  timestamp: Date;
  user?: {
    id: number;
    role: UserRoleId;
  };
}

/**
 * Route analytics interface
 */
export interface RouteAnalytics {
  path: string;
  visits: number;
  avgTimeSpent: number;      // in milliseconds
  bounceRate: number;        // percentage
  lastVisited: Date;
}

/**
 * Route search configuration
 */
export interface RouteSearchConfig {
  searchable?: boolean;       // Can this route be found in search
  keywords?: string[];        // Additional search keywords
  priority?: number;          // Search result priority (1-10)
}

/**
 * Enhanced route config with additional features
 */
export interface EnhancedRouteConfig extends RouteConfig {
  transition?: RouteTransition;
  preload?: boolean;          // Preload component code
  search?: RouteSearchConfig;
  analytics?: boolean;        // Track analytics for this route
}

/**
 * Route pattern matching utilities
 */
export interface RoutePattern {
  pattern: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * Route utilities type definitions
 */
export interface RouteUtils {
  matchPath: (pattern: string, path: string) => RoutePattern | null;
  buildPath: (pattern: string, params: Record<string, any>) => string;
  parseQuery: (search: string) => Record<string, string>;
  buildQuery: (params: Record<string, any>) => string;
}

/**
 * Role name mappings for display
 */
export const ROLE_NAMES: Record<UserRoleId, string> = {
  [USER_ROLES.ADMIN]: 'Administrator',
  [USER_ROLES.QA_ANALYST]: 'QA Analyst', 
  [USER_ROLES.CSR]: 'Customer Service Representative',
  [USER_ROLES.TRAINER]: 'Trainer',
  [USER_ROLES.MANAGER]: 'Manager',
  [USER_ROLES.DIRECTOR]: 'Director',
};

/**
 * Default route configurations
 */
export const DEFAULT_ROUTES = {
  LOGIN: '/login',
  DASHBOARD: '/',
  UNAUTHORIZED: '/unauthorized',
  NOT_FOUND: '/404',
  ERROR: '/error',
} as const; 