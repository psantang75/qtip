/**
 * User role constants
 * These should match the role_id values in the database
 */
export const USER_ROLES = {
  ADMIN: 1,
  MANAGER: 2,
  AGENT: 3,
  QA_ANALYST: 4
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

/**
 * Role name mappings
 */
export const ROLE_NAMES = {
  [USER_ROLES.ADMIN]: 'Admin',
  [USER_ROLES.MANAGER]: 'Manager', 
  [USER_ROLES.AGENT]: 'Agent',
  [USER_ROLES.QA_ANALYST]: 'QA Analyst'
} as const;

/**
 * Check if user has specific role
 */
export const hasRole = (userRoleId: number, requiredRole: UserRole): boolean => {
  return userRoleId === requiredRole;
};

/**
 * Check if user is Agent
 */
export const isAgent = (userRoleId: number): boolean => {
  return hasRole(userRoleId, USER_ROLES.AGENT);
};

/**
 * Check if user is Manager
 */
export const isManager = (userRoleId: number): boolean => {
  return hasRole(userRoleId, USER_ROLES.MANAGER);
};

/**
 * Check if user is Admin
 */
export const isAdmin = (userRoleId: number): boolean => {
  return hasRole(userRoleId, USER_ROLES.ADMIN);
};

/**
 * Role permission levels for UI features
 */
export const ROLE_PERMISSIONS = {
  [USER_ROLES.ADMIN]: {
    canManageUsers: true,
    canManageForms: true,
    canViewAllAudits: true,
    canResolveDisputes: true,
    canManageTraining: true,
    canSetGoals: true,
  },
  [USER_ROLES.QA_ANALYST]: {
    canManageUsers: false,
    canManageForms: false,
    canViewAllAudits: true,
    canResolveDisputes: false,
    canManageTraining: false,
    canSetGoals: false,
  },
  [USER_ROLES.AGENT]: {
    canManageUsers: false,
    canManageForms: false,
    canViewAllAudits: false,
    canResolveDisputes: false,
    canManageTraining: false,
    canSetGoals: false,
  },
  [USER_ROLES.MANAGER]: {
    canManageUsers: false,
    canManageForms: false,
    canViewAllAudits: true,
    canResolveDisputes: true,
    canManageTraining: false,
    canSetGoals: true,
  },
} as const;

/**
 * Check if user has specific permissions
 */
export const canManageUsers = (userRoleId: number): boolean => 
  ROLE_PERMISSIONS[userRoleId as UserRole]?.canManageUsers ?? false;

export const canResolveDisputes = (userRoleId: number): boolean => 
  ROLE_PERMISSIONS[userRoleId as UserRole]?.canResolveDisputes ?? false;

export const canViewAllAudits = (userRoleId: number): boolean => 
  ROLE_PERMISSIONS[userRoleId as UserRole]?.canViewAllAudits ?? false; 