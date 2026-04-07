export type NavSection = 'quality' | 'training' | 'writeups' | 'insights'

export interface NavItem {
  label: string
  path: string
  icon: string
  roles: number[]
  badge?: string
  group?: string
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
    defaultPath: '/app/quality/submissions',
    items: [
      { label: 'Form Builder',      path: '/app/quality/forms',           icon: 'ClipboardList',   roles: [1] },
      { label: 'Review Forms',      path: '/app/quality/review-forms',    icon: 'ClipboardCheck',  roles: [1,2] },
      { label: 'Completed Forms',    path: '/app/quality/submissions',     icon: 'FileCheck',       roles: [1,2,4] },
      { label: 'Completed Reviews',  path: '/app/quality/submissions',     icon: 'FileCheck',       roles: [5] },
      { label: 'My Reviews',        path: '/app/quality/submissions',     icon: 'FileCheck',       roles: [3] },
      { label: 'Disputes',          path: '/app/quality/disputes',        icon: 'AlertTriangle',   roles: [1,2] },
      { label: 'Disputes',          path: '/app/quality/disputes',        icon: 'AlertTriangle',   roles: [5] },
      { label: 'Dispute History',   path: '/app/quality/disputes',        icon: 'History',         roles: [3] },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    icon: 'GraduationCap',
    color: '#00aeef',
    defaultPath: '/app/training',
    items: [
      { label: 'Coaching Sessions', path: '/app/training/coaching',          icon: 'MessageSquare',   roles: [1,2,4,5]   },
      { label: 'My Coaching',       path: '/app/training/my-coaching',       icon: 'BookOpen',        roles: [3]         },
      { label: 'Training Topics',   path: '/app/training/library/topics',    icon: 'Tag',             roles: [1,4]       },
      { label: 'Quizzes',           path: '/app/training/library/quizzes',   icon: 'HelpCircle',      roles: [1,4]       },
      { label: 'Resources',         path: '/app/training/library/resources', icon: 'BookMarked',      roles: [1,4]       },
    ],
  },
  {
    id: 'writeups',
    label: 'Write-Ups',
    icon: 'FileWarning',
    color: '#00aeef',
    defaultPath: '/app/writeups',
    items: [
      { label: 'Write-Ups',    path: '/app/writeups',     icon: 'FileWarning', roles: [1, 2, 5] },
      { label: 'My Write-Ups', path: '/app/writeups/my',  icon: 'FileText',    roles: [3] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'BarChart2',
    color: '#00aeef',
    defaultPath: '/app/insights/qc-overview',
    items: [
      // ── Quality, Coaching & Performance Warnings ──
      { label: 'Overview',             path: '/app/insights/qc-overview', icon: 'LayoutDashboard', roles: [1,2,4,5], group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Quality Deep Dive',    path: '/app/insights/qc-quality',  icon: 'Target',          roles: [1,2,5],   group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Coaching',             path: '/app/insights/qc-coaching', icon: 'BookOpen',        roles: [1,2,4,5], group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Performance Warnings', path: '/app/insights/qc-warnings', icon: 'AlertTriangle',   roles: [1,2,5],   group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Agent Performance',    path: '/app/insights/qc-agents',   icon: 'Users',           roles: [1,2,4,5], group: 'Quality, Coaching & Performance Warnings' },
      // ── Data Management ──
      { label: 'Report Builder', path: '/app/insights/builder',  icon: 'PenSquare',    roles: [1],     group: 'Data Management' },
      { label: 'Saved Reports',  path: '/app/insights/reports',  icon: 'FileBarChart', roles: [1,5],   group: 'Data Management' },
      { label: 'Data Explorer',  path: '/app/insights/explorer', icon: 'Search',       roles: [1,5],   group: 'Data Management' },
      { label: 'Raw Export',     path: '/app/insights/export',   icon: 'Download',     roles: [1,3,5], group: 'Data Management' },
      { label: 'Import Center',  path: '/app/insights/import',   icon: 'Upload',       roles: [1],     group: 'Data Management' },
      { label: 'Import History', path: '/app/insights/history',  icon: 'History',      roles: [1],     group: 'Data Management' },
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
  if (pathname.startsWith('/app/quality'))  return 'quality'
  if (pathname.startsWith('/app/training')) return 'training'
  if (pathname.startsWith('/app/writeups')) return 'writeups'
  if (pathname.startsWith('/app/insights')) return 'insights'
  if (pathname.startsWith('/app/analytics')) return 'insights' // legacy — shows insights sidebar
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
