import {
  NavigationSection,
  NavigationItem,
  USER_ROLES,
  UserRoleId
} from '../types/routes.types';
import {
  HiOutlineHome,
  HiOutlineUsers,
  HiOutlineClipboardList,
  HiOutlineAcademicCap,
  HiOutlineChartBar,
  HiOutlineCog,
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineExclamation,
  HiOutlineShieldCheck,
  HiOutlineChat
} from 'react-icons/hi';

/**
 * Centralized Navigation Configuration
 * 
 * Features:
 * - Type-safe role-based navigation
 * - Organized by sections and roles
 * - Icon and badge support
 * - Alphabetical ordering within groups
 * - Easy to maintain and extend
 */

/**
 * Define navigation items for each role
 */
const createNavigationItems = (): Record<UserRoleId, NavigationItem[]> => {
  return {
    [USER_ROLES.ADMIN]: [
      {
        id: 'admin-dashboard',
        label: 'Dashboard',
        path: '/admin/dashboard',
        icon: HiOutlineHome,
        roles: [USER_ROLES.ADMIN],
        group: 'main',
        order: 1
      },
      {
        id: 'admin-users',
        label: 'Users',
        path: '/admin/users',
        icon: HiOutlineUsers,
        roles: [USER_ROLES.ADMIN],
        group: 'management',
        order: 1
      },
      {
        id: 'admin-departments',
        label: 'Departments',
        path: '/admin/departments',
        icon: HiOutlineUserGroup,
        roles: [USER_ROLES.ADMIN],
        group: 'management',
        order: 2
      },
      {
        id: 'admin-forms',
        label: 'Review Forms',
        path: '/admin/forms',
        icon: HiOutlineDocumentText,
        roles: [USER_ROLES.ADMIN],
        group: 'qa',
        order: 1
      },
      {
        id: 'admin-completed-forms',
        label: 'Completed Forms',
        path: '/admin/completed-forms',
        icon: HiOutlineClipboardList,
        roles: [USER_ROLES.ADMIN],
        group: 'qa',
        order: 2
      },
      {
        id: 'admin-disputes',
        label: 'Dispute Resolution',
        path: '/admin/disputes',
        icon: HiOutlineExclamation,
        roles: [USER_ROLES.ADMIN],
        group: 'qa',
        order: 3
      },
      {
        id: 'admin-coaching',
        label: 'Coaching Sessions',
        path: '/admin/coaching',
        icon: HiOutlineChat,
        roles: [USER_ROLES.ADMIN],
        group: 'qa',
        order: 4
      },
      // TODO: POST-LAUNCH ENHANCEMENT - Audit Assignments functionality
      // This feature is not yet completed/tested and will be developed after initial launch
      // {
      //   id: 'admin-assignments',
      //   label: 'Audit Assignments',
      //   path: '/admin/audit-assignments',
      //   icon: HiOutlineClipboardList,
      //   roles: [USER_ROLES.ADMIN],
      //   group: 'qa',
      //   order: 2
      // },
      {
        id: 'admin-goals',
        label: 'Performance Goals',
        path: '/admin/goals',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.ADMIN],
        group: 'analytics',
        order: 1
      },
      {
        id: 'admin-analytics',
        label: 'Analytics',
        path: '/admin/analytics',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.ADMIN],
        group: 'analytics',
        order: 2
      }
    ],

    [USER_ROLES.QA_ANALYST]: [
      {
        id: 'qa-dashboard',
        label: 'Dashboard',
        path: '/qa/dashboard',
        icon: HiOutlineHome,
        roles: [USER_ROLES.QA_ANALYST],
        group: 'main',
        order: 1
      },
      // TODO: POST-LAUNCH ENHANCEMENT - Assigned Audits functionality
      // This feature is not yet completed/tested and will be developed after initial launch
      // {
      //   id: 'qa-assigned',
      //   label: 'Assigned Audits',
      //   path: '/qa/assigned-reviews',
      //   icon: HiOutlineClipboardList,
      //   roles: [USER_ROLES.QA_ANALYST],
      //   group: 'audits',
      //   order: 1
      // },
      {
        id: 'qa-manual',
        label: 'Manual Reviews',
        path: '/qa/manual-reviews',
        icon: HiOutlineDocumentText,
        roles: [USER_ROLES.QA_ANALYST],
        group: 'audits',
        order: 1
      },
      {
        id: 'qa-completed',
        label: 'Completed Reviews',
        path: '/qa/completed-reviews',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.QA_ANALYST],
        group: 'audits',
        order: 2
      },
      {
        id: 'qa-disputes',
        label: 'Dispute Resolution',
        path: '/qa/disputes',
        icon: HiOutlineExclamation,
        roles: [USER_ROLES.QA_ANALYST],
        group: 'audits',
        order: 3
      },
      {
        id: 'qa-analytics',
        label: 'Analytics',
        path: '/qa/analytics',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.QA_ANALYST],
        group: 'analytics',
        order: 1
      },
      // TODO: FUTURE ENHANCEMENT - Form Library functionality
      // This feature is planned for future release and will provide QA analysts with
      // read-only access to form templates for reference during audits
      // {
      //   id: 'qa-library',
      //   label: 'Form Library',
      //   path: '/qa/form-library',
      //   icon: HiOutlineDocumentText,
      //   roles: [USER_ROLES.QA_ANALYST],
      //   group: 'tools',
      //   order: 1
      // }
    ],

    [USER_ROLES.CSR]: [
      {
        id: 'csr-dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: HiOutlineHome,
        roles: [USER_ROLES.CSR],
        group: 'main',
        order: 1
      },
      {
        id: 'csr-audits',
        label: 'My Reviews',
        path: '/my-audits',
        icon: HiOutlineClipboardList,
        roles: [USER_ROLES.CSR],
        group: 'performance',
        order: 1
      },
      {
        id: 'csr-disputes',
        label: 'Dispute History',
        path: '/dispute-history',
        icon: HiOutlineExclamation,
        roles: [USER_ROLES.CSR],
        group: 'performance',
        order: 2
      },
      // TODO: FUTURE DEVELOPMENT - Training Progress
      /*
      {
        id: 'csr-training',
        label: 'Training Progress',
        path: '/training-dashboard',
        icon: HiOutlineAcademicCap,
        roles: [USER_ROLES.CSR],
        group: 'development',
        order: 1
      },
      */
      {
        id: 'csr-coaching',
        label: 'My Coaching',
        path: '/my-coaching',
        icon: HiOutlineChat,
        roles: [USER_ROLES.CSR],
        group: 'development',
        order: 2
      },
      // TODO: FUTURE DEVELOPMENT - Certificates
      /*
      {
        id: 'csr-certificates',
        label: 'Certificates',
        path: '/certificates',
        icon: HiOutlineShieldCheck,
        roles: [USER_ROLES.CSR],
        group: 'development',
        order: 3
      }
      */
    ],

    [USER_ROLES.TRAINER]: [
      {
        id: 'trainer-dashboard',
        label: 'Dashboard',
        path: '/trainer/dashboard',
        icon: HiOutlineHome,
        roles: [USER_ROLES.TRAINER],
        group: 'main',
        order: 1
      },
      // TODO: FUTURE ENHANCEMENT - Course Builder functionality
      // This feature will be added in a future release for content creation capabilities
      // {
      //   id: 'trainer-builder',
      //   label: 'Course Builder',
      //   path: '/trainer/course-builder',
      //   icon: HiOutlineAcademicCap,
      //   roles: [USER_ROLES.TRAINER],
      //   group: 'content',
      //   order: 1
      // },
      // TODO: FUTURE ENHANCEMENT - Assign Training functionality
      // This feature will be added in a future release for training assignment capabilities
      // {
      //   id: 'trainer-assign',
      //   label: 'Assign Training',
      //   path: '/trainer/assign-training',
      //   icon: HiOutlineUsers,
      //   roles: [USER_ROLES.TRAINER],
      //   group: 'management',
      //   order: 1
      // },
      {
        id: 'trainer-manager-coaching',
        label: 'Coaching Sessions',
        path: '/trainer/manager-coaching',
        icon: HiOutlineChat,
        roles: [USER_ROLES.TRAINER],
        group: 'management',
        order: 1
      },
      {
        id: 'trainer-completed',
        label: 'Completed Reviews',
        path: '/trainer/completed-reviews',
        icon: HiOutlineClipboardList,
        roles: [USER_ROLES.TRAINER],
        group: 'management',
        order: 2
      },
      {
        id: 'trainer-analytics',
        label: 'Analytics',
        path: '/trainer/analytics',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.TRAINER],
        group: 'analytics',
        order: 1
      }
    ],

    [USER_ROLES.MANAGER]: [
      {
        id: 'manager-dashboard',
        label: 'Dashboard',
        path: '/manager/dashboard',
        icon: HiOutlineHome,
        roles: [USER_ROLES.MANAGER],
        group: 'main',
        order: 1
      },
      {
        id: 'manager-audits',
        label: 'Team Reviews',
        path: '/manager/team-audits',
        icon: HiOutlineClipboardList,
        roles: [USER_ROLES.MANAGER],
        group: 'team',
        order: 1
      },
      // TODO: FUTURE ENHANCEMENT - Team Training functionality
      // This feature will be added in a future release
      // {
      //   id: 'manager-training',
      //   label: 'Team Training',
      //   path: '/manager/team-training',
      //   icon: HiOutlineAcademicCap,
      //   roles: [USER_ROLES.MANAGER],
      //   group: 'team',
      //   order: 2
      // },
      {
        id: 'manager-coaching',
        label: 'Coaching Sessions',
        path: '/manager/coaching',
        icon: HiOutlineUsers,
        roles: [USER_ROLES.MANAGER],
        group: 'team',
        order: 3
      },
      {
        id: 'manager-disputes',
        label: 'Dispute Resolution',
        path: '/manager/disputes',
        icon: HiOutlineExclamation,
        roles: [USER_ROLES.MANAGER],
        group: 'team',
        order: 2
      },
      {
        id: 'manager-analytics',
        label: 'Team Analytics',
        path: '/manager/analytics',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.MANAGER],
        group: 'analytics',
        order: 1
      }
    ],

    [USER_ROLES.DIRECTOR]: [
      {
        id: 'director-reports',
        label: 'Performance Reports',
        path: '/director/performance-reports',
        icon: HiOutlineChartBar,
        roles: [USER_ROLES.DIRECTOR],
        group: 'executive',
        order: 1
      }
    ]
  };
};

/**
 * Group definitions for organizing navigation sections
 */
const GROUP_DEFINITIONS = {
  main: { title: 'Main', order: 1 },
  management: { title: 'Management', order: 2 },
  qa: { title: 'Quality Assurance', order: 3 },
  audits: { title: 'QA Operations', order: 3 },
  performance: { title: 'Performance', order: 4 },
  team: { title: 'Team Management', order: 4 },
  content: { title: 'Content Creation', order: 4 },
  development: { title: 'Training & Development', order: 5 },
  analytics: { title: 'Analytics & Reports', order: 6 },
  tools: { title: 'Tools', order: 7 },
  executive: { title: 'Executive Overview', order: 2 },
  account: { title: 'Account', order: 99 }
} as const;

/**
 * Common navigation items available to all authenticated users
 */
const COMMON_NAVIGATION_ITEMS: NavigationItem[] = [
  // TODO: POST-LAUNCH ENHANCEMENT - Profile Settings functionality
  // This feature is not yet implemented/tested and will be added after initial launch
  // {
  //   id: 'profile',
  //   label: 'Profile Settings',
  //   path: '/profile',
  //   icon: HiOutlineCog,
  //   roles: [USER_ROLES.ADMIN, USER_ROLES.QA_ANALYST, USER_ROLES.CSR, USER_ROLES.TRAINER, USER_ROLES.MANAGER, USER_ROLES.DIRECTOR],
  //   group: 'account',
  //   order: 1
  // },
  // TODO: POST-LAUNCH ENHANCEMENT - Help Center functionality
  // This feature is not yet implemented/tested and will be added after initial launch
  // {
  //   id: 'help',
  //   label: 'Help Center',
  //   path: '/help',
  //   icon: HiOutlineDocumentText,
  //   roles: [USER_ROLES.ADMIN, USER_ROLES.QA_ANALYST, USER_ROLES.CSR, USER_ROLES.TRAINER, USER_ROLES.MANAGER, USER_ROLES.DIRECTOR],
  //   group: 'account',
  //   order: 2
  // }
];

/**
 * Generate navigation sections for a specific user role
 */
export const generateNavigationSections = (userRoleId: UserRoleId): NavigationSection[] => {
  const allItems = createNavigationItems();
  const roleItems = allItems[userRoleId] || [];
  const allUserItems = [...roleItems, ...COMMON_NAVIGATION_ITEMS];

  // Group items by their group property
  const itemsByGroup = allUserItems.reduce((acc, item) => {
    const group = item.group || 'main';
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(item);
    return acc;
  }, {} as Record<string, NavigationItem[]>);

  // Create sections from groups
  const sections: NavigationSection[] = Object.entries(itemsByGroup)
    .map(([groupKey, items]) => {
      const groupDef = GROUP_DEFINITIONS[groupKey as keyof typeof GROUP_DEFINITIONS];
      
      // Sort items within group by order property
      const sortedItems = items.sort((a, b) => (a.order || 0) - (b.order || 0));

      return {
        id: groupKey,
        title: groupDef?.title || groupKey,
        items: sortedItems,
        roles: [userRoleId],
        order: groupDef?.order || 99,
        collapsible: groupKey === 'issues' || groupKey === 'account',
        defaultCollapsed: groupKey === 'account'
      };
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return sections;
};

/**
 * Get all navigation items for a user role (flattened)
 */
export const getNavigationItems = (userRoleId: UserRoleId): NavigationItem[] => {
  const allItems = createNavigationItems();
  const roleItems = allItems[userRoleId] || [];
  return [...roleItems, ...COMMON_NAVIGATION_ITEMS];
};

/**
 * Check if a user has access to a specific navigation item
 */
export const canAccessItem = (item: NavigationItem, userRoleId: UserRoleId): boolean => {
  return item.roles.includes(userRoleId);
};

/**
 * Find navigation item by path
 */
export const findNavigationItem = (path: string, userRoleId: UserRoleId): NavigationItem | null => {
  const items = getNavigationItems(userRoleId);
  return items.find(item => item.path === path) || null;
};

/**
 * Generate breadcrumbs for a given path
 */
export const generateBreadcrumbs = (path: string, userRoleId: UserRoleId) => {
  const item = findNavigationItem(path, userRoleId);
  if (!item) return [];

  const breadcrumbs = [
    { label: 'Home', path: '/' },
    { label: item.label, path: item.path }
  ];

  return breadcrumbs;
}; 