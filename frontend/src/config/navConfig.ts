export type NavSection = 'quality' | 'training' | 'performancewarnings' | 'scheduling' | 'insights'

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
   * Insights-only gate. When set, the item resolves through
   * `ie_page_role_access` via `/api/insights/navigation` and `roles` is
   * ignored. (Quality / Training / Performance Warnings are no longer listed
   * here — they are fully server-driven via `/api/app-access/navigation`.)
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
  // Quality / Training / Performance Warnings are FULLY server-driven: their
  // sidebar items (label, route, icon, visibility) come from
  // `/api/app-access/navigation`, computed from `app_page_role_access` for the
  // user's access level. The empty `items` arrays below are intentional — only
  // the section metadata (label/icon/defaultPath) is used here. To add or
  // rename a page in these sections, edit the `app_page` table, not this file.
  {
    id: 'quality',
    label: 'Quality',
    icon: 'Shield',
    color: '#00aeef',
    defaultPath: '/app/quality/submissions',
    items: [],
  },
  {
    id: 'training',
    label: 'Training',
    icon: 'GraduationCap',
    color: '#00aeef',
    defaultPath: '/app/training',
    items: [],
  },
  {
    id: 'performancewarnings',
    label: 'Performance Warnings',
    icon: 'AlertTriangle',
    color: '#00aeef',
    defaultPath: PERFORMANCE_WARNINGS_APP_BASE,
    items: [],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: 'CalendarDays',
    color: '#00aeef',
    defaultPath: '/app/scheduling/calendar',
    items: [],
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
      // ── Sales Agent Activity ──
      // `roles` is ignored when `pageKey` is set — visibility comes from
      // /api/insights/navigation (i.e. ie_page_role_access). The section only
      // renders when the user can access at least one page under it.
      { label: 'Call Activity',   path: '/app/insights/aa-call',    icon: 'Phone',      roles: [], pageKey: 'aa_sales_call',    group: 'Sales Agent Activity' },
      { label: 'Leads',           path: '/app/insights/aa-leads',   icon: 'Target',     roles: [], pageKey: 'aa_sales_leads',   group: 'Sales Agent Activity' },
      { label: 'Margin',          path: '/app/insights/aa-margin',  icon: 'DollarSign', roles: [], pageKey: 'aa_sales_margin',  group: 'Sales Agent Activity' },
      { label: 'Tickets & Tasks', path: '/app/insights/aa-tickets', icon: 'Ticket',     roles: [], pageKey: 'aa_sales_tickets', group: 'Sales Agent Activity' },
      { label: 'Ticket and Task Workload', path: '/app/insights/aa-workload', icon: 'ClipboardList', roles: [], pageKey: 'aa_sales_workload', group: 'Sales Agent Activity' },
      { label: 'Workload Validation', path: '/app/insights/workload-validation', icon: 'ListChecks', roles: [], pageKey: 'aa_sales_workload', group: 'Sales Agent Activity' },
      { label: 'Productivity',    path: '/app/insights/aa-productivity', icon: 'Gauge', roles: [], pageKey: 'aa_sales_productivity_report', group: 'Sales Agent Activity' },
      { label: 'Email Activity',  path: '/app/insights/aa-email',   icon: 'Mail',       roles: [], pageKey: 'aa_sales_email',   group: 'Sales Agent Activity' },
      // ── CSR Agent Activity ──
      { label: 'Call Activity',   path: '/app/insights/csr-call',       icon: 'Phone',         roles: [], pageKey: 'csr_call',       group: 'CSR Agent Activity' },
      { label: 'Attendance',      path: '/app/insights/csr-attendance', icon: 'CalendarCheck', roles: [], pageKey: 'csr_attendance', group: 'CSR Agent Activity' },
      { label: 'Tickets & Tasks', path: '/app/insights/csr-tickets',    icon: 'Ticket',        roles: [], pageKey: 'csr_tickets',    group: 'CSR Agent Activity' },
      { label: 'Ticket and Task Workload', path: '/app/insights/csr-workload', icon: 'ClipboardList', roles: [], pageKey: 'csr_workload', group: 'CSR Agent Activity' },
      { label: 'Productivity', path: '/app/insights/csr-productivity', icon: 'Gauge', roles: [], pageKey: 'csr_productivity_report', group: 'CSR Agent Activity' },
      // ── Reports ──
      // Only On Demand Reports is exposed via the sidebar today; the underlying
      // routes for Report Builder / Saved Reports / Data Explorer / Raw Export /
      // Import Center / Import History still exist in the router but are no
      // longer surfaced in navigation. Agent (role 3) gets no Reports group.
      { label: 'On Demand Reports', path: '/app/insights/on-demand-reports', icon: 'FileSpreadsheet', roles: [1,5], group: 'Reports' },
      // ── Company Reporting ──
      // Admin-only, DB-driven like the rest of Insights: `roles` is ignored
      // because `pageKey` is set — visibility comes from ie_page_role_access via
      // /api/insights/navigation (seeded admin-only in
      // 20260825170000_seed_company_reporting_service_counts).
      { label: 'Service Counts', path: '/app/insights/company-service-counts', icon: 'Radio', roles: [], pageKey: 'company_service_counts', group: 'Company Reporting' },
    ],
  },
]

export function getSectionConfig(id: NavSection): SectionConfig {
  return NAV_CONFIG.find(s => s.id === id)!
}

export function getNavItemsForRole(section: NavSection, roleId: number): NavItem[] {
  const config = getSectionConfig(section)
  return config.items.filter(item => {
    // Both set: role must match (selects the right per-role label for items
    // that share a route) AND the DB grant must allow it (applied later by
    // the Sidebar/TopBar dynamic filter using the page-key set).
    if (item.pageKey && item.roles.length > 0) return item.roles.includes(roleId)
    // pageKey-only: visibility is purely DB-driven; include here so the
    // dynamic filter gets to evaluate it.
    if (item.pageKey) return true
    // Legacy static items: role array is the gate.
    return item.roles.includes(roleId)
  })
}

export function getSectionFromPath(pathname: string): NavSection | null {
  if (pathname.startsWith('/app/quality'))  return 'quality'
  if (pathname.startsWith('/app/training')) return 'training'
  if (pathname.startsWith('/app/performancewarnings') || pathname.startsWith('/app/writeups')) return 'performancewarnings'
  if (pathname.startsWith('/app/scheduling')) return 'scheduling'
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
