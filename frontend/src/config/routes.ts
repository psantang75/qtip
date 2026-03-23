/**
 * Route Configuration for QTIP Application
 * 
 * Centralized route definitions with permissions, metadata, and navigation structure
 */

import { 
  HiOutlineHome,
  HiOutlineUsers,
  HiOutlineClipboardList,
  HiOutlineAcademicCap,
  HiOutlineChartBar,
  HiOutlineCog,
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineExclamationCircle,
  HiOutlineChatAlt,
  HiOutlineTag
} from 'react-icons/hi';

/**
 * User role constants for type safety
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
 * Route permissions interface
 */
export interface RoutePermissions {
  roles: UserRole[];
  requiresAuth: boolean;
  customCheck?: (user: any) => boolean;
}

/**
 * Breadcrumb item interface
 */
export interface BreadcrumbItem {
  label: string;
  path?: string;
  isActive?: boolean;
}

/**
 * Route configuration interface
 */
export interface RouteConfig {
  id: string;
  path: string;
  label: string;
  description?: string;
  permissions: RoutePermissions;
  parentId?: string;
  icon?: any;
  hidden?: boolean;
  category?: string;
  breadcrumbs?: BreadcrumbItem[];
}

/**
 * Complete route configuration for QTIP application
 */
export const ROUTE_CONFIG: RouteConfig[] = [
  // Authentication routes
  {
    id: 'login',
    path: '/login',
    label: 'Login',
    description: 'User authentication',
    permissions: { roles: [], requiresAuth: false },
    hidden: true,
  },

  // Admin routes
  {
    id: 'admin-dashboard',
    path: '/admin/dashboard',
    label: 'Dashboard',
    description: 'Administrative dashboard',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineHome,
    category: 'admin',
  },
  {
    id: 'admin-users',
    path: '/admin/users',
    label: 'User Management',
    description: 'Manage system users',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineUsers,
    category: 'admin',
  },
  {
    id: 'admin-departments',
    path: '/admin/departments',
    label: 'Departments',
    description: 'Manage departments',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineUserGroup,
    category: 'admin',
  },
  {
    id: 'admin-topics',
    path: '/admin/topics',
    label: 'Topics',
    description: 'Manage topics',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineTag,
    category: 'admin',
  },
  {
    id: 'admin-forms',
    path: '/admin/forms',
    label: 'Review Forms',
    description: 'Manage review forms',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineDocumentText,
    category: 'admin',
  },
  {
    id: 'admin-audit-assignments',
    path: '/admin/audit-assignments',
    label: 'Audit Assignments',
    description: 'Assign audits to QA staff',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineClipboardList,
    category: 'admin',
  },
  {
    id: 'admin-goals',
    path: '/admin/goals',
    label: 'Performance Goals',
    description: 'Set performance goals',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'admin',
  },
  {
    id: 'admin-disputes',
    path: '/admin/disputes',
    label: 'Dispute Resolution',
    description: 'Resolve audit disputes',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineExclamationCircle,
    category: 'admin',
  },
  {
    id: 'admin-coaching',
    path: '/admin/coaching',
    label: 'Coaching Sessions',
    description: 'Manage coaching sessions',
    permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
    icon: HiOutlineChatAlt,
    category: 'admin',
  },

  // QA routes
  {
    id: 'qa-dashboard',
    path: '/qa/dashboard',
    label: 'Dashboard',
    description: 'QA analyst dashboard',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineHome,
    category: 'qa',
  },
  {
    id: 'qa-assigned-reviews',
    path: '/qa/assigned-reviews',
    label: 'Assigned Audits',
    description: 'Review assigned audits',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineClipboardList,
    category: 'qa',
  },
  {
    id: 'qa-manual-reviews',
    path: '/qa/manual-reviews',
    label: 'Manual Reviews',
    description: 'Conduct manual reviews',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineDocumentText,
    category: 'qa',
  },
  {
    id: 'qa-completed-reviews',
    path: '/qa/completed-reviews',
    label: 'Completed Audits',
    description: 'View completed audits',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'qa',
  },
  {
    id: 'qa-analytics',
    path: '/qa/analytics',
    label: 'Analytics',
    description: 'View QA analytics and reports',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'qa',
  },
  {
    id: 'qa-disputes',
    path: '/qa/disputes',
    label: 'Dispute Resolution',
    description: 'Resolve audit disputes',
    permissions: { roles: [UserRole.QA], requiresAuth: true },
    icon: HiOutlineExclamationCircle,
    category: 'qa',
  },
  // TODO: FUTURE ENHANCEMENT - Form Library functionality
  // {
  //   id: 'qa-form-library',
  //   path: '/qa/form-library',
  //   label: 'Form Library',
      //   description: 'Browse review forms',
  //   permissions: { roles: [UserRole.QA], requiresAuth: true },
  //   icon: HiOutlineDocumentText,
  //   category: 'qa',
  // },

  // CSR routes
  {
    id: 'csr-dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    description: 'CSR dashboard',
    permissions: { roles: [UserRole.CSR], requiresAuth: true },
    icon: HiOutlineHome,
    category: 'csr',
  },
  {
    id: 'csr-audits',
    path: '/my-audits',
    label: 'My Reviews',
    description: 'View your review results',
    permissions: { roles: [UserRole.CSR], requiresAuth: true },
    icon: HiOutlineClipboardList,
    category: 'csr',
  },
  {
    id: 'csr-disputes',
    path: '/dispute-history',
    label: 'Dispute History',
    description: 'View dispute history',
    permissions: { roles: [UserRole.CSR], requiresAuth: true },
    icon: HiOutlineExclamationCircle,
    category: 'csr',
  },
  // TODO: FUTURE DEVELOPMENT - Training Route
  /*
  {
    id: 'csr-training',
    path: '/training-dashboard',
    label: 'Training',
    description: 'Access training materials',
    permissions: { roles: [UserRole.CSR], requiresAuth: true },
    icon: HiOutlineAcademicCap,
    category: 'csr',
  },
  */
  // TODO: FUTURE DEVELOPMENT - Certificates Route  
  /*
  {
    id: 'csr-certificates',
    path: '/certificates',
    label: 'Certificates',
    description: 'View earned certificates',
    permissions: { roles: [UserRole.CSR], requiresAuth: true },
    icon: HiOutlineAcademicCap,
    category: 'csr',
  },
  */

  // Trainer routes
  {
    id: 'trainer-dashboard',
    path: '/trainer/dashboard',
    label: 'Dashboard',
    description: 'Trainer dashboard',
    permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
    icon: HiOutlineHome,
    category: 'trainer',
  },
  // TODO: FUTURE ENHANCEMENT - Course Builder Route Config
  // This route will be enabled in a future release for content creation capabilities
  // {
  //   id: 'trainer-course-builder',
  //   path: '/trainer/course-builder',
  //   label: 'Course Builder',
  //   description: 'Create and manage courses',
  //   permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
  //   icon: HiOutlineAcademicCap,
  //   category: 'trainer',
  // },
  // TODO: FUTURE ENHANCEMENT - Assign Training Route Config
  // This route will be enabled in a future release for training assignment capabilities
  // {
  //   id: 'trainer-assign-training',
  //   path: '/trainer/assign-training',
  //   label: 'Assign Training',
  //   description: 'Assign training to users',
  //   permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
  //   icon: HiOutlineUsers,
  //   category: 'trainer',
  // },
  {
    id: 'trainer-reports',
    path: '/trainer/reports',
    label: 'Training Reports',
    description: 'View training progress reports',
    permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'trainer',
  },
  {
    id: 'trainer-analytics',
    path: '/trainer/analytics',
    label: 'Analytics',
    description: 'View comprehensive analytics and reports',
    permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'trainer',
  },
  {
    id: 'trainer-completed-reviews',
    path: '/trainer/completed-reviews',
    label: 'Completed Reviews',
    description: 'View completed quality assurance reviews',
    permissions: { roles: [UserRole.TRAINER], requiresAuth: true },
    icon: HiOutlineClipboardList,
    category: 'trainer',
  },

  // Manager routes
  {
    id: 'manager-dashboard',
    path: '/manager/dashboard',
    label: 'Dashboard',
    description: 'Manager dashboard',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineHome,
    category: 'manager',
  },
  {
    id: 'manager-team-audits',
    path: '/manager/team-audits',
    label: 'Team Reviews',
    description: 'Monitor team audit performance',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineClipboardList,
    category: 'manager',
  },
  {
    id: 'manager-team-training',
    path: '/manager/team-training',
    label: 'Team Training',
    description: 'Monitor team training progress',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineAcademicCap,
    category: 'manager',
  },
  {
    id: 'manager-disputes',
    path: '/manager/disputes',
    label: 'Dispute Resolution',
    description: 'Resolve audit disputes',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineExclamationCircle,
    category: 'manager',
  },
  {
    id: 'manager-coaching',
    path: '/manager/coaching',
    label: 'Coaching Sessions',
    description: 'Schedule and manage coaching',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineUsers,
    category: 'manager',
  },
  {
    id: 'manager-analytics',
    path: '/manager/analytics',
    label: 'Team Analytics',
    description: 'View team performance analytics',
    permissions: { roles: [UserRole.MANAGER], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'manager',
  },

  // Director routes
  {
    id: 'director-performance-reports',
    path: '/director/performance-reports',
    label: 'Performance Reports',
    description: 'View organization performance',
    permissions: { roles: [UserRole.DIRECTOR], requiresAuth: true },
    icon: HiOutlineChartBar,
    category: 'director',
  },

  // Common routes
  {
    id: 'profile',
    path: '/profile',
    label: 'Profile Settings',
    description: 'Manage your profile',
    permissions: { 
      roles: [UserRole.ADMIN, UserRole.QA, UserRole.CSR, UserRole.TRAINER, UserRole.MANAGER, UserRole.DIRECTOR], 
      requiresAuth: true 
    },
    icon: HiOutlineCog,
    category: 'common',
    hidden: true,
  },
];

/**
 * Role information mapping
 */
export const ROLE_INFO = {
  [UserRole.ADMIN]: {
    name: 'Administrator',
    displayName: 'Admin Portal',
    color: 'blue',
    routes: ROUTE_CONFIG.filter(r => r.category === 'admin' || r.category === 'common'),
  },
  [UserRole.QA]: {
    name: 'QA Analyst',
    displayName: 'QA Portal',
    color: 'green',
    routes: ROUTE_CONFIG.filter(r => r.category === 'qa' || r.category === 'common'),
  },
  [UserRole.CSR]: {
    name: 'Customer Service Representative',
    displayName: 'CSR Portal',
    color: 'purple',
    routes: ROUTE_CONFIG.filter(r => r.category === 'csr' || r.category === 'common'),
  },
  [UserRole.TRAINER]: {
    name: 'Trainer',
    displayName: 'Trainer Portal',
    color: 'orange',
    routes: ROUTE_CONFIG.filter(r => r.category === 'trainer' || r.category === 'common'),
  },
  [UserRole.MANAGER]: {
    name: 'Manager',
    displayName: 'Manager Portal',
    color: 'red',
    routes: ROUTE_CONFIG.filter(r => r.category === 'manager' || r.category === 'common'),
  },
  [UserRole.DIRECTOR]: {
    name: 'Director',
    displayName: 'Director Portal',
    color: 'indigo',
    routes: ROUTE_CONFIG.filter(r => r.category === 'director' || r.category === 'common'),
  },
};

/**
 * Helper function to get routes for a specific role
 */
export const getRoutesForRole = (roleId: UserRole): RouteConfig[] => {
  return ROUTE_CONFIG.filter(route => 
    route.permissions.roles.includes(roleId) && !route.hidden
  );
};

/**
 * Helper function to check if user can access route
 */
export const canUserAccessRoute = (route: RouteConfig, user: any): boolean => {
  if (!route.permissions.requiresAuth) return true;
  if (!user) return false;
  
  const hasRole = route.permissions.roles.includes(user.role_id);
  const customCheck = route.permissions.customCheck ? route.permissions.customCheck(user) : true;
  
  return hasRole && customCheck;
};

/**
 * Helper function to find route by path
 */
export const findRouteByPath = (path: string): RouteConfig | undefined => {
  return ROUTE_CONFIG.find(route => {
    // Exact match
    if (route.path === path) return true;
    
    // Parameter match (e.g., /admin/forms/:formId)
    const routeParts = route.path.split('/');
    const pathParts = path.split('/');
    
    if (routeParts.length !== pathParts.length) return false;
    
    return routeParts.every((part, index) => {
      return part.startsWith(':') || part === pathParts[index];
    });
  });
}; 