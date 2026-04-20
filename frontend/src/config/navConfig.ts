export type NavSection = 'quality' | 'training' | 'performancewarnings' | 'insights'

/** Client route base for performance warning (write-up) documents — API remains `/api/writeups`. */
export const PERFORMANCE_WARNINGS_APP_BASE = '/app/performancewarnings'

export interface NavItem {
  label: string
  path: string
  icon: string
  roles: number[]
  badge?: string
  group?: string
  /**
   * If set, this item is gated by the Insights page-access table
   * (`ie_page_role_access` / `ie_page_user_override`). The static `roles`
   * array is ignored for these items — visibility is driven entirely by
   * `/api/insights/navigation` so admin grants in the Pages screen are
   * reflected immediately.
   */
  pageKey?: string
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
      { label: 'Training Sessions', path: '/app/training/coaching',          icon: 'MessageSquare',   roles: [1,2,4,5]   },
      { label: 'My Training',       path: '/app/training/my-coaching',       icon: 'BookOpen',        roles: [3]         },
      { label: 'Training Topics',   path: '/app/training/library/topics',    icon: 'Tag',             roles: [1,4]       },
      { label: 'Quizzes',           path: '/app/training/library/quizzes',   icon: 'HelpCircle',      roles: [1,4]       },
      { label: 'Resources',         path: '/app/training/library/resources', icon: 'BookMarked',      roles: [1,4]       },
    ],
  },
  {
    id: 'performancewarnings',
    label: 'Performance Warnings',
    icon: 'AlertTriangle',
    color: '#00aeef',
    defaultPath: PERFORMANCE_WARNINGS_APP_BASE,
    items: [
      { label: 'Performance Warnings', path: PERFORMANCE_WARNINGS_APP_BASE, icon: 'AlertTriangle', roles: [1, 2, 5] },
      { label: 'My Performance Warnings', path: `${PERFORMANCE_WARNINGS_APP_BASE}/my`, icon: 'FileText', roles: [3] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'BarChart2',
    color: '#00aeef',
    // Route through the bare /app/insights so InsightsIndexRedirect picks
    // the first page the user actually has access to (per ie_page_role_access),
    // instead of hard-landing everyone on qc-overview.
    defaultPath: '/app/insights',
    items: [
      // ── Quality, Coaching & Performance Warnings ──
      // `roles` is ignored when `pageKey` is set — visibility comes from
      // /api/insights/navigation (i.e. ie_page_role_access).
      { label: 'Overview',             path: '/app/insights/qc-overview', icon: 'LayoutDashboard', roles: [], pageKey: 'qc_overview', group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Quality',              path: '/app/insights/qc-quality',  icon: 'Target',          roles: [], pageKey: 'qc_quality',  group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Coaching',             path: '/app/insights/qc-coaching', icon: 'BookOpen',        roles: [], pageKey: 'qc_coaching', group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Performance Warnings', path: '/app/insights/qc-warnings', icon: 'AlertTriangle',   roles: [], pageKey: 'qc_warnings', group: 'Quality, Coaching & Performance Warnings' },
      { label: 'Agent Performance',    path: '/app/insights/qc-agents',   icon: 'Users',           roles: [], pageKey: 'qc_agents',   group: 'Quality, Coaching & Performance Warnings' },
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
  // Items with a `pageKey` are gated by the backend Insights access table
  // and are filtered separately by the Sidebar via /api/insights/navigation.
  // Always include them here so the Sidebar can apply that filter.
  return config.items.filter(item => item.pageKey != null || item.roles.includes(roleId))
}

export function getSectionFromPath(pathname: string): NavSection | null {
  if (pathname.startsWith('/app/quality'))  return 'quality'
  if (pathname.startsWith('/app/training')) return 'training'
  if (pathname.startsWith('/app/performancewarnings') || pathname.startsWith('/app/writeups')) return 'performancewarnings'
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
