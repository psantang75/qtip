export type NavSection = 'quality' | 'training' | 'insights' | 'analytics'

export interface NavItem {
  label: string
  path: string
  icon: string
  roles: number[]
  badge?: string
}

export interface SectionConfig {
  id: NavSection
  label: string
  icon: string
  color: string
  defaultPath: string
  items: NavItem[]
}

export const NAV_CONFIG: SectionConfig[] = [
  {
    id: 'quality',
    label: 'Quality',
    icon: 'Shield',
    color: '#00aeef',
    defaultPath: '/app/quality/overview',
    items: [
      { label: 'Overview',         path: '/app/quality/overview',          icon: 'LayoutDashboard', roles: [1,2,3,4,5] },
      { label: 'Review Forms',     path: '/app/quality/review-forms',      icon: 'ClipboardCheck',  roles: [1,2] },
      { label: 'Form Builder',     path: '/app/quality/forms',             icon: 'ClipboardList',   roles: [1,2] },
      { label: 'Submissions',        path: '/app/quality/submissions',       icon: 'FileCheck',       roles: [1,2] },
      { label: 'Team Reviews',      path: '/app/quality/submissions',       icon: 'FileCheck',       roles: [5] },
      { label: 'My Reviews',        path: '/app/quality/submissions',       icon: 'FileCheck',       roles: [3] },
      { label: 'Disputes',          path: '/app/quality/disputes',          icon: 'AlertTriangle',   roles: [1,2] },
      { label: 'Dispute Resolution',path: '/app/quality/disputes',          icon: 'AlertTriangle',   roles: [5] },
      { label: 'Dispute History',   path: '/app/quality/dispute-history',   icon: 'History',         roles: [3] },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    icon: 'GraduationCap',
    color: '#00aeef',
    defaultPath: '/app/training/overview',
    items: [
      { label: 'Overview',          path: '/app/training/overview',     icon: 'LayoutDashboard', roles: [1,2,3,4,5] },
      { label: 'Course Library',    path: '/app/training/courses',      icon: 'BookOpen',        roles: [1,2,3,4,5] },
      { label: 'Training Paths',    path: '/app/training/paths',        icon: 'Map',             roles: [1,4] },
      { label: 'Enrollments',       path: '/app/training/enrollments',  icon: 'Users',           roles: [1,4,5] },
      { label: 'Coaching Sessions', path: '/app/training/coaching',     icon: 'MessageSquare',   roles: [1,4,5] },
      { label: 'Certificates',      path: '/app/training/certificates', icon: 'Award',           roles: [1,2,3,4,5] },
      { label: 'Quizzes',           path: '/app/training/quizzes',      icon: 'HelpCircle',      roles: [1,4] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'BarChart2',
    color: '#00aeef',
    defaultPath: '/app/insights/dashboard',
    items: [
      { label: 'My Dashboard',  path: '/app/insights/dashboard', icon: 'LayoutDashboard', roles: [1,2,3,4,5] },
      { label: 'Team Dashboard',path: '/app/insights/team',      icon: 'Users',           roles: [1,5] },
      { label: 'Report Builder',path: '/app/insights/builder',   icon: 'PenSquare',       roles: [1] },
      { label: 'Saved Reports', path: '/app/insights/reports',   icon: 'FileBarChart',    roles: [1,5] },
      { label: 'Data Explorer', path: '/app/insights/explorer',  icon: 'Search',          roles: [1,5] },
      { label: 'Raw Export',    path: '/app/insights/export',    icon: 'Download',        roles: [1,3,5] },
      { label: 'Import Center', path: '/app/insights/import',    icon: 'Upload',          roles: [1] },
      { label: 'Import History',path: '/app/insights/history',   icon: 'History',         roles: [1] },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'BarChart3',
    color: '#00aeef',
    defaultPath: '/app/analytics/quality',
    items: [
      { label: 'QA Analytics', path: '/app/analytics/quality', icon: 'BarChart3', roles: [1,2,5] },
    ],
  },
]

export function getSectionConfig(id: NavSection): SectionConfig {
  return NAV_CONFIG.find(s => s.id === id)!
}

export function getNavItemsForRole(section: NavSection, roleId: number): NavItem[] {
  const config = getSectionConfig(section)
  return config.items.filter(item => item.roles.includes(roleId))
}

export function getSectionFromPath(pathname: string): NavSection | null {
  if (pathname.startsWith('/app/quality')) return 'quality'
  if (pathname.startsWith('/app/training')) return 'training'
  if (pathname.startsWith('/app/insights')) return 'insights'
  if (pathname.startsWith('/app/analytics')) return 'analytics'
  return null
}

// Role display names — role 3 is "User", role 6 removed
export const ROLE_DISPLAY: Record<number, string> = {
  1: 'ADMIN',
  2: 'QA',
  3: 'USER',
  4: 'TRAINER',
  5: 'MANAGER',
}
