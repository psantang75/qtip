# Quality, Coaching & Performance Warnings — Cursor Implementation Guide

**Project**: Qtip Insights Engine
**UI Reference**: `phase1-insights-mockup-v3.jsx` (root of repo — open in a React renderer to see exactly what to build)
**Stack**: React 19 + TypeScript + Tailwind + Radix UI + Recharts + TanStack Query + Express + Prisma + MySQL

---

## How to Use This Document

Hand Cursor one phase at a time. Complete each phase fully and verify it before moving to the next. Each phase includes exactly what to build, what files to touch, and a checklist to verify before proceeding.

---

## What We're Building

Five analytics pages inside the existing Insights Engine (`/app/insights/`) that replace the current placeholders. They live under a sidebar heading called **"Quality, Coaching & Performance Warnings"** with these sub-pages:

| Page | Route | Description |
|------|-------|-------------|
| Overview | `/app/insights/qc-overview` | KPI summary tiles for all three domains, trend charts, agent leaderboard |
| Quality Deep Dive | `/app/insights/qc-quality` | 12 quality KPIs, score distribution, dispute analysis, category performance, missed questions |
| Coaching | `/app/insights/qc-coaching` | 8 coaching + 3 quiz KPIs, coached topics drill-down, repeat coaching agents, quiz breakdown |
| Performance Warnings | `/app/insights/qc-warnings` | 5 discipline KPIs, write-up pipeline, escalation path, policy violations drill-down |
| Agent Performance | `/app/insights/qc-agents` | Agent list with full drill-through profile (quality, coaching, warnings, forms, quizzes) |

The mockup file (`phase1-insights-mockup-v3.jsx`) is the pixel-perfect reference. Every table, chart, expandable row, badge color, and interaction in that file must be reproduced using the production stack.

---

---

# PHASE 1 — Navigation, Routing & Database Setup

**Goal**: Wire up all routes, update the sidebar navigation with the grouped heading structure, and seed the database with KPI definitions and page access records. No real UI yet — just the skeleton that everything else builds on.

---

## Step 1A — Update the NavItem Interface

**File**: `frontend/src/config/navConfig.ts`

Add a `group` property to the `NavItem` interface:

```typescript
export interface NavItem {
  label: string
  path: string
  icon: string
  roles: number[]
  badge?: string
  group?: string   // ← ADD THIS
}
```

---

## Step 1B — Replace the Insights Section in navConfig

**File**: `frontend/src/config/navConfig.ts`

Replace the entire `insights` section in `NAV_CONFIG` with this:

```typescript
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
```

---

## Step 1C — Update Sidebar to Render Group Headings

**File**: `frontend/src/components/shell/Sidebar.tsx`

Replace the existing `{navItems.map(...)}` block with a grouped version:

```typescript
const grouped = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
  const key = item.group ?? '__ungrouped__'
  if (!acc[key]) acc[key] = []
  acc[key].push(item)
  return acc
}, {})

// In JSX:
<nav className="flex-1 px-2 pb-4 space-y-0.5">
  {Object.entries(grouped).map(([group, items]) => (
    <div key={group}>
      {group !== '__ungrouped__' && (
        <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          {group}
        </div>
      )}
      {items.map(item => (
        <NavLink
          key={item.label}
          to={item.path}
          end
          className={({ isActive }) => {
            const active = originPath ? item.path === originPath : isActive
            return cn(
              'flex items-center gap-2.5 px-3 py-2.5 rounded-r-md text-[13.5px] transition-colors',
              active ? ACTIVE_ITEM_CLASS : INACTIVE_ITEM_CLASS,
            )
          }}
        >
          <DynamicIcon name={item.icon} size={15} />
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {item.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  ))}
</nav>
```

---

## Step 1D — Add Routes in App.tsx

**File**: `frontend/src/App.tsx`

Add lazy imports at the top with the other insights imports:

```typescript
const QCOverviewPage  = React.lazy(() => import('./pages/insights/QCOverviewPage'))
const QCQualityPage   = React.lazy(() => import('./pages/insights/QCQualityPage'))
const QCCoachingPage  = React.lazy(() => import('./pages/insights/QCCoachingPage'))
const QCWarningsPage  = React.lazy(() => import('./pages/insights/QCWarningsPage'))
const QCAgentsPage    = React.lazy(() => import('./pages/insights/QCAgentsPage'))
```

Add routes inside `<Route path="/app/insights">` and update the index redirect:

```typescript
<Route index element={<Navigate to="qc-overview" replace />} />
<Route path="qc-overview" element={<PageLoader><QCOverviewPage /></PageLoader>} />
<Route path="qc-quality"  element={<PageLoader><QCQualityPage /></PageLoader>} />
<Route path="qc-coaching" element={<PageLoader><QCCoachingPage /></PageLoader>} />
<Route path="qc-warnings" element={<PageLoader><QCWarningsPage /></PageLoader>} />
<Route path="qc-agents"   element={<PageLoader><QCAgentsPage /></PageLoader>} />
```

---

## Step 1E — Create Placeholder Page Files

**Directory**: `frontend/src/pages/insights/`

Create all five page files as placeholders using the existing `PlaceholderPage` component:

```typescript
// QCOverviewPage.tsx
import PlaceholderPage from '@/pages/PlaceholderPage'
export default function QCOverviewPage() {
  return <PlaceholderPage title="Overview" subtitle="Quality, Coaching & Performance Warnings overview." />
}
```

Repeat for `QCQualityPage`, `QCCoachingPage`, `QCWarningsPage`, `QCAgentsPage` with appropriate titles.

---

## Step 1F — Seed KPIs into the Database

Create a seed script at `backend/prisma/migrations/YYYYMMDD_seed_qc_kpis/seed.sql`:

```sql
INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
-- Quality (12)
('avg_qa_score',               'Avg QA Score',            'Average QA score across all finalized submissions.',                          'Quality',    'SQL',     'AVG(total_score) WHERE status = FINALIZED',                         'submission',                      'PERCENT', 1, 'UP_IS_GOOD',   1,  1),
('audits_assigned',            'Audits Assigned',          'Expected audits based on pace targets in KPI thresholds.',                   'Quality',    'DERIVED', 'pace_per_form x weeks_in_period x active_forms',                   'ie_kpi_threshold',                'NUMBER',  0, 'NEUTRAL',      1,  2),
('audits_completed',           'Audits Completed',         'Total QA audits finalized this period.',                                     'Quality',    'SQL',     'COUNT WHERE status = FINALIZED AND submitted_at IN period',         'submission',                      'NUMBER',  0, 'UP_IS_GOOD',   1,  3),
('audit_completion_rate',      'Audit Completion %',       'Percentage of expected audits completed.',                                   'Quality',    'DERIVED', 'audits_completed / audits_assigned x 100',                         'submission,ie_kpi_threshold',     'PERCENT', 1, 'UP_IS_GOOD',   1,  4),
('dispute_rate',               'Dispute Rate',             'Percentage of finalized submissions disputed.',                              'Quality',    'SQL',     'COUNT(disputes) / COUNT(finalized) x 100',                         'dispute,submission',              'PERCENT', 1, 'DOWN_IS_GOOD', 1,  5),
('dispute_upheld_rate',        'Dispute Upheld Rate',      'Of resolved disputes, percentage upheld in agent favor.',                    'Quality',    'SQL',     'COUNT(UPHELD) / COUNT(resolved) x 100',                            'dispute',                         'PERCENT', 1, 'DOWN_IS_GOOD', 1,  6),
('dispute_not_upheld_rate',    'Dispute Rejected Rate',    'Percentage of resolved disputes rejected.',                                  'Quality',    'SQL',     'COUNT(REJECTED) / COUNT(resolved) x 100',                          'dispute',                         'PERCENT', 1, 'NEUTRAL',      1,  7),
('dispute_adjusted_rate',      'Dispute Adjusted Rate',    'Submissions where dispute led to score adjustment.',                         'Quality',    'SQL',     'COUNT(ADJUSTED) / COUNT(finalized) x 100',                         'dispute,submission',              'PERCENT', 1, 'DOWN_IS_GOOD', 1,  8),
('avg_dispute_resolution_time','Avg Resolution Time',      'Average days from dispute creation to resolution.',                          'Quality',    'SQL',     'AVG(resolved_at - created_at) in days',                            'dispute',                         'NUMBER',  1, 'DOWN_IS_GOOD', 1,  9),
('critical_fail_rate',         'Critical Fail Rate',       'Evaluations where an auto-fail question was triggered.',                     'Quality',    'SQL',     'COUNT(auto-fail) / COUNT(submissions) x 100',                      'submission_answer,form_question', 'PERCENT', 1, 'DOWN_IS_GOOD', 1, 10),
('time_to_audit',              'Time to Audit',            'Average days from call date to QA audit completion.',                        'Quality',    'SQL',     'AVG(submitted_at - call_date) in days',                            'submission',                      'NUMBER',  1, 'DOWN_IS_GOOD', 1, 11),
('qa_score_trend',             'QA Score Trend',           'Directional trend of average QA scores over the selected period.',           'Quality',    'DERIVED', 'delta of avg_qa_score vs prior period',                            'submission',                      'PERCENT', 1, 'UP_IS_GOOD',   1, 12),
-- Coaching (8)
('coaching_sessions_assigned', 'Sessions Assigned',        'Expected sessions based on pace targets x active agents x weeks.',          'Coaching',   'DERIVED', 'pace_per_agent x active_agents x weeks_in_period',                 'ie_kpi_threshold,user',           'NUMBER',  0, 'NEUTRAL',      1, 13),
('coaching_sessions_completed','Sessions Completed',       'Coaching sessions reaching COMPLETED or CLOSED status.',                     'Coaching',   'SQL',     'COUNT WHERE status IN (COMPLETED,CLOSED) AND completed_at IN period','coaching_session',               'NUMBER',  0, 'UP_IS_GOOD',   1, 14),
('coaching_completion_rate',   'Coaching Completion %',    'Percentage of expected coaching sessions completed.',                        'Coaching',   'DERIVED', 'sessions_completed / sessions_assigned x 100',                     'coaching_session,ie_kpi_threshold','PERCENT',1, 'UP_IS_GOOD',   1, 15),
('coaching_delivery_rate',     'Coaching Delivery',        'Scheduled sessions that were actually delivered.',                           'Coaching',   'SQL',     'COUNT(delivered_at IS NOT NULL) / COUNT(sessions) x 100',          'coaching_session',                'PERCENT', 1, 'UP_IS_GOOD',   1, 16),
('coaching_cadence',           'Coaching Cadence',         'Percentage of target sessions delivered based on expected frequency.',       'Coaching',   'DERIVED', 'delivered_sessions / (agents x expected_per_period) x 100',        'coaching_session,ie_kpi_threshold','PERCENT',1, 'UP_IS_GOOD',   1, 17),
('avg_days_to_close_coaching', 'Avg Days to Close',        'Average days from coaching session creation to completion.',                 'Coaching',   'SQL',     'AVG(completed_at - created_at) in days',                           'coaching_session',                'NUMBER',  1, 'DOWN_IS_GOOD', 1, 18),
('followup_compliance_rate',   'Follow-Up Compliance',     'Sessions requiring follow-up where follow-up was completed on time.',        'Coaching',   'SQL',     'COUNT(on-time) / COUNT(required) x 100',                           'coaching_session',                'PERCENT', 1, 'UP_IS_GOOD',   1, 19),
('time_to_coaching',           'Time to Coaching',         'Average days from low QA score to coaching session creation.',              'Coaching',   'SQL',     'AVG(coaching.created_at - submission.submitted_at) in days',        'coaching_session,submission',     'NUMBER',  1, 'DOWN_IS_GOOD', 1, 20),
-- Quiz (3)
('quiz_pass_rate',             'Quiz Pass Rate',           'Percentage of quiz attempts resulting in a passing score.',                  'Quiz',       'SQL',     'COUNT(passed=true) / COUNT(attempts) x 100',                       'quiz_attempt',                    'PERCENT', 1, 'UP_IS_GOOD',   1, 21),
('avg_quiz_score',             'Avg Quiz Score',           'Average score across all quiz attempts.',                                    'Quiz',       'SQL',     'AVG(quiz_attempt.score)',                                          'quiz_attempt',                    'PERCENT', 1, 'UP_IS_GOOD',   1, 22),
('avg_attempts_to_pass',       'Avg Attempts to Pass',     'Average quiz attempts before passing.',                                      'Quiz',       'SQL',     'AVG(attempts per quiz until pass)',                                'quiz_attempt',                    'NUMBER',  1, 'DOWN_IS_GOOD', 1, 23),
-- Discipline (5)
('total_writeups_issued',      'Write-Ups Issued',         'Total write-ups created this period.',                                       'Discipline', 'SQL',     'COUNT WHERE created_at IN period',                                 'write_up',                        'NUMBER',  0, 'DOWN_IS_GOOD', 1, 24),
('writeup_rate',               'Write-Up Rate',            'Write-ups per 100 employees per month.',                                     'Discipline', 'DERIVED', 'COUNT(write_ups) / COUNT(active_employees) x 100',                 'write_up,user',                   'NUMBER',  1, 'NEUTRAL',      1, 25),
('escalation_rate',            'Escalation Rate',          'Write-ups that escalated from verbal to written or written to final.',       'Discipline', 'SQL',     'COUNT(escalated) / COUNT(write_ups) x 100',                        'write_up,write_up_prior_discipline','PERCENT',1,'DOWN_IS_GOOD', 1, 26),
('repeat_offender_rate',       'Repeat Offender Rate',     'Agents who receive another write-up within 90 days.',                        'Discipline', 'SQL',     'COUNT(agents with 2+ write-ups in 90 days) / COUNT(agents with write-ups) x 100','write_up','PERCENT',1,'DOWN_IS_GOOD',1,27),
('writeup_resolution_rate',    'Write-Up Resolution',      'Percentage of write-ups reaching CLOSED status.',                            'Discipline', 'SQL',     'COUNT(status=CLOSED) / COUNT(write_ups) x 100',                    'write_up',                        'PERCENT', 1, 'UP_IS_GOOD',   1, 28);
```

Then insert default thresholds for KPIs that have goal/warn/crit values:

```sql
INSERT INTO ie_kpi_threshold (kpi_id, department_key, goal_value, warning_value, critical_value, effective_from)
SELECT id, NULL,
  CASE kpi_code
    WHEN 'avg_qa_score'              THEN 90   WHEN 'audit_completion_rate'     THEN 95
    WHEN 'dispute_rate'              THEN 5    WHEN 'dispute_upheld_rate'       THEN 10
    WHEN 'dispute_adjusted_rate'     THEN 3    WHEN 'avg_dispute_resolution_time' THEN 3
    WHEN 'critical_fail_rate'        THEN 2    WHEN 'time_to_audit'             THEN 3
    WHEN 'coaching_completion_rate'  THEN 92   WHEN 'coaching_delivery_rate'    THEN 95
    WHEN 'coaching_cadence'          THEN 95   WHEN 'avg_days_to_close_coaching' THEN 10
    WHEN 'followup_compliance_rate'  THEN 90   WHEN 'time_to_coaching'          THEN 5
    WHEN 'quiz_pass_rate'            THEN 85   WHEN 'avg_quiz_score'            THEN 82
    WHEN 'avg_attempts_to_pass'      THEN 1.2  WHEN 'escalation_rate'           THEN 15
    WHEN 'repeat_offender_rate'      THEN 10   WHEN 'writeup_resolution_rate'   THEN 90
    ELSE NULL END,
  CASE kpi_code
    WHEN 'avg_qa_score'              THEN 80   WHEN 'audit_completion_rate'     THEN 85
    WHEN 'dispute_rate'              THEN 10   WHEN 'dispute_upheld_rate'       THEN 20
    WHEN 'dispute_adjusted_rate'     THEN 8    WHEN 'avg_dispute_resolution_time' THEN 7
    WHEN 'critical_fail_rate'        THEN 5    WHEN 'time_to_audit'             THEN 7
    WHEN 'coaching_completion_rate'  THEN 80   WHEN 'coaching_delivery_rate'    THEN 85
    WHEN 'coaching_cadence'          THEN 80   WHEN 'avg_days_to_close_coaching' THEN 21
    WHEN 'followup_compliance_rate'  THEN 75   WHEN 'time_to_coaching'          THEN 10
    WHEN 'quiz_pass_rate'            THEN 70   WHEN 'avg_quiz_score'            THEN 70
    WHEN 'avg_attempts_to_pass'      THEN 1.8  WHEN 'escalation_rate'           THEN 25
    WHEN 'repeat_offender_rate'      THEN 20   WHEN 'writeup_resolution_rate'   THEN 75
    ELSE NULL END,
  CASE kpi_code
    WHEN 'avg_qa_score'              THEN 70   WHEN 'audit_completion_rate'     THEN 75
    WHEN 'dispute_rate'              THEN 20   WHEN 'dispute_upheld_rate'       THEN 35
    WHEN 'dispute_adjusted_rate'     THEN 15   WHEN 'avg_dispute_resolution_time' THEN 14
    WHEN 'critical_fail_rate'        THEN 10   WHEN 'time_to_audit'             THEN 14
    WHEN 'coaching_completion_rate'  THEN 65   WHEN 'coaching_delivery_rate'    THEN 70
    WHEN 'coaching_cadence'          THEN 60   WHEN 'avg_days_to_close_coaching' THEN 30
    WHEN 'followup_compliance_rate'  THEN 60   WHEN 'time_to_coaching'          THEN 21
    WHEN 'quiz_pass_rate'            THEN 55   WHEN 'avg_quiz_score'            THEN 60
    WHEN 'avg_attempts_to_pass'      THEN 2.5  WHEN 'escalation_rate'           THEN 40
    WHEN 'repeat_offender_rate'      THEN 35   WHEN 'writeup_resolution_rate'   THEN 60
    ELSE NULL END,
  CURDATE()
FROM ie_kpi WHERE kpi_code IN (
  'avg_qa_score','audit_completion_rate','dispute_rate','dispute_upheld_rate','dispute_adjusted_rate',
  'avg_dispute_resolution_time','critical_fail_rate','time_to_audit','coaching_completion_rate',
  'coaching_delivery_rate','coaching_cadence','avg_days_to_close_coaching','followup_compliance_rate',
  'time_to_coaching','quiz_pass_rate','avg_quiz_score','avg_attempts_to_pass',
  'escalation_rate','repeat_offender_rate','writeup_resolution_rate'
);
```

---

## Step 1G — Register Pages in ie_page and ie_page_role_access

```sql
INSERT INTO ie_page (page_key, page_name, description, category, route_path, icon, sort_order, is_active, requires_section) VALUES
('qc_overview', 'Overview',             'Quality & Coaching KPI overview, trend charts, and agent leaderboard.',          'Quality, Coaching & Performance Warnings', '/app/insights/qc-overview', 'LayoutDashboard', 1, 1, 'insights'),
('qc_quality',  'Quality Deep Dive',    'Detailed quality analytics: scores, disputes, categories, missed questions.',    'Quality, Coaching & Performance Warnings', '/app/insights/qc-quality',  'Target',          2, 1, 'insights'),
('qc_coaching', 'Coaching',             'Coaching analytics: topics, repeat coaching agents, quiz performance.',          'Quality, Coaching & Performance Warnings', '/app/insights/qc-coaching', 'BookOpen',        3, 1, 'insights'),
('qc_warnings', 'Performance Warnings', 'Write-up tracking, escalation path, policy violations.',                        'Quality, Coaching & Performance Warnings', '/app/insights/qc-warnings', 'AlertTriangle',   4, 1, 'insights'),
('qc_agents',   'Agent Performance',    'Agent list with full drill-through profile for quality, coaching, warnings.',    'Quality, Coaching & Performance Warnings', '/app/insights/qc-agents',   'Users',           5, 1, 'insights');

-- Role access: Admin(1) and Manager(5) get ALL scope; QA(2) and Trainer(4) get DEPARTMENT scope
INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope)
SELECT p.id, r.role_id, 1, r.data_scope
FROM ie_page p
JOIN (
  SELECT 'qc_overview' pk, 1 role_id, 'ALL'        data_scope UNION ALL
  SELECT 'qc_overview',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_overview',    4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_overview',    5,          'ALL'                    UNION ALL
  SELECT 'qc_quality',     1,          'ALL'                    UNION ALL
  SELECT 'qc_quality',     2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_quality',     5,          'ALL'                    UNION ALL
  SELECT 'qc_coaching',    1,          'ALL'                    UNION ALL
  SELECT 'qc_coaching',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_coaching',    4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_coaching',    5,          'ALL'                    UNION ALL
  SELECT 'qc_warnings',    1,          'ALL'                    UNION ALL
  SELECT 'qc_warnings',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_warnings',    5,          'ALL'                    UNION ALL
  SELECT 'qc_agents',      1,          'ALL'                    UNION ALL
  SELECT 'qc_agents',      2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_agents',      4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_agents',      5,          'ALL'
) r ON p.page_key = r.pk;
```

---

## Phase 1 — Verify Before Proceeding to Phase 2

- [ ] Sidebar shows **"Quality, Coaching & Performance Warnings"** heading with 5 items beneath it for Admin/Manager roles
- [ ] Sidebar shows **"Data Management"** heading below with the existing items
- [ ] All 5 routes (`/app/insights/qc-overview` through `qc-agents`) load the placeholder page without 404 errors
- [ ] Navigating to `/app/insights` redirects to `/app/insights/qc-overview`
- [ ] Database: `SELECT COUNT(*) FROM ie_kpi` returns 28 rows
- [ ] Database: `SELECT COUNT(*) FROM ie_kpi_threshold` returns at least 20 rows
- [ ] Database: `SELECT COUNT(*) FROM ie_page WHERE page_key LIKE 'qc_%'` returns 5 rows
- [ ] Database: `SELECT COUNT(*) FROM ie_page_role_access` includes the 18 new QC access rows

---

---

# PHASE 2 — Shared Components

**Goal**: Build all reusable UI components that all five pages share. Build and verify these before touching any page.

**Directory**: `frontend/src/components/insights/`

---

## Component 1 — `KpiTile.tsx`

The core building block. A white card showing a KPI name, formatted value, status dot, optional period-over-period delta, and goal. Reference: the `<Tile>` component in the mockup.

```typescript
interface KpiTileProps {
  kpiCode: string
  value: number | null
  priorValue?: number      // Shows ▲/▼ delta when provided
  small?: boolean          // Compact variant for the Overview page
  onClick?: () => void     // Makes card clickable with hover effect
  thresholds?: { goal?: number; warn?: number; crit?: number; direction: string }
}
```

**Behavior:**
- Look up the KPI name and format type from a local constant `kpiDefs.ts` (create this file with all 28 definitions — code, name, format: PERCENT or NUMBER, direction: UP_IS_GOOD or DOWN_IS_GOOD or NEUTRAL)
- Format the value: append `%` for PERCENT type; show as a number for NUMBER type; one decimal place
- Show a colored status dot based on thresholds: green if at/above goal, orange if between warning and goal, red if at/below critical. Invert for DOWN_IS_GOOD KPIs
- If `priorValue` is provided, compute `delta = value - priorValue` and show `▲ X%` in green or `▼ X%` in red, direction-aware: for UP_IS_GOOD, positive delta = green; for DOWN_IS_GOOD, negative delta = green
- Show `— flat` in muted text if delta is zero
- Show `vs prior period` label in small muted text when delta is present
- Show `Goal: X%` below the value when thresholds.goal is set
- When `onClick` is set: brand-color border + soft shadow on hover

---

## Component 2 — `InsightsSection.tsx`

A white card wrapper. Reference: `<Section>` in the mockup.

```typescript
interface InsightsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}
```

Style: `bg-white border border-slate-200 rounded-xl p-5 mb-4`. Title in `text-sm font-semibold text-slate-800`. Optional description in `text-xs text-slate-500 mt-0.5 mb-3`.

---

## Component 3 — `StatusBadge.tsx`

A small colored pill. Reference: `<Badge>` in the mockup.

```typescript
interface StatusBadgeProps {
  label: string
  variant?: 'good' | 'bad' | 'warning' | 'neutral'
}
```

Colors: `good` = `bg-emerald-50 text-emerald-600`, `bad` = `bg-red-50 text-red-600`, `warning` = `bg-orange-50 text-orange-600`, `neutral` = `bg-slate-100 text-slate-600`. If variant is omitted, auto-detect from common label values (e.g., "Closed" → good, "At Risk" → bad, "Follow-Up" → warning, "Repeat" → bad, "First" → good).

---

## Component 4 — `StatRow.tsx`

A single label/value row with a bottom border. Reference: `<Stat>` in the mockup.

```typescript
interface StatRowProps {
  label: string
  value: string
  valueColor?: string   // Tailwind text color class
}
```

---

## Component 5 — `StatusDot.tsx`

A tiny threshold-indicator circle. Reference: `<Dot>` in the mockup.

```typescript
interface StatusDotProps {
  value: number
  thresholds: { goal?: number; warn?: number; crit?: number; direction: string }
}
```

A `w-2 h-2 rounded-full inline-block mr-1.5` dot: green, orange, or red based on threshold evaluation.

---

## Component 6 — `TrendChart.tsx`

A line chart using Recharts. Reference: `<Chart>` in the mockup.

```typescript
interface TrendChartProps {
  data: Array<{ label: string; value: number }>
  color: string
  goalValue?: number
  height?: number       // Default 100
  metricLabel?: string
}
```

Uses `ResponsiveContainer`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `ReferenceLine` from Recharts. Y-axis domain 0–100. Goal line is dashed `#94a3b8`.

---

## Component 7 — `ExpandableRow.tsx`

The caret expand/collapse pattern used throughout all pages.

```typescript
interface ExpandableRowProps {
  isExpanded: boolean
  onToggle: () => void
  summary: React.ReactNode
  detail: React.ReactNode
  highlightColor?: string   // Tailwind bg class for expanded/hover state
}
```

Shows `▶` when collapsed, `▼` when expanded. Expanded detail renders in `bg-slate-50 border border-slate-200 border-t-0 rounded-b-lg p-3 mx-2 mb-2`.

---

## Component 8 — `InsightsFilterBar.tsx`

The sticky filter bar used by all five pages.

```typescript
interface InsightsFilterBarProps {
  selectedDepts: string[]
  onDeptsChange: (v: string[]) => void
  period: string
  onPeriodChange: (v: string) => void
  customStart?: string
  customEnd?: string
  onCustomStartChange?: (v: string) => void
  onCustomEndChange?: (v: string) => void
  showFormFilter?: boolean
  selectedForms?: string[]
  onFormsChange?: (v: string[]) => void
  showBackButton?: boolean
  onBack?: () => void
}
```

Time period options: `Current Week`, `Prior Week`, `Current Month`, `Prior Month`, `Current Quarter`, `Prior Quarter`, `Current Year`, `Prior Year`, `Custom`. When `Custom` is selected, show two date inputs. Position: `sticky top-0 z-40 bg-slate-50 border-b border-slate-200 px-6 py-3 flex gap-3 items-center flex-wrap`.

---

## Step 2Z — Barrel Export

**File**: `frontend/src/components/insights/index.ts`

```typescript
export { default as KpiTile }           from './KpiTile'
export { default as InsightsSection }   from './InsightsSection'
export { default as StatusBadge }       from './StatusBadge'
export { default as StatRow }           from './StatRow'
export { default as StatusDot }         from './StatusDot'
export { default as TrendChart }        from './TrendChart'
export { default as ExpandableRow }     from './ExpandableRow'
export { default as InsightsFilterBar } from './InsightsFilterBar'
```

Also create `frontend/src/constants/kpiDefs.ts` with the 28 KPI definitions (code, name, format, direction, thresholds) as a static map used by KpiTile.

---

## Phase 2 — Verify Before Proceeding to Phase 3

- [ ] All 8 component files exist in `frontend/src/components/insights/`
- [ ] `kpiDefs.ts` exists with all 28 KPI codes defined
- [ ] `KpiTile` renders correctly: PERCENT shows `%`, NUMBER shows plain value
- [ ] `KpiTile` shows green `▲` delta when value improves for an UP_IS_GOOD KPI
- [ ] `KpiTile` shows red `▲` delta when value increases for a DOWN_IS_GOOD KPI (higher is worse)
- [ ] `KpiTile` shows `— flat` when value equals priorValue
- [ ] `InsightsSection` renders title, optional description, and children in a white rounded card
- [ ] `StatusBadge` shows correct background/text colors for all four variants
- [ ] `TrendChart` renders a line with a dashed goal reference line
- [ ] `ExpandableRow` shows `▶` when collapsed, `▼` when expanded, detail panel visible on expand
- [ ] `InsightsFilterBar` shows form filter only when `showFormFilter={true}`, back button only when `showBackButton={true}`, custom date inputs only when period is "Custom"
- [ ] Barrel export works: `import { KpiTile, InsightsSection } from '@/components/insights'`

---

---

# PHASE 3 — Backend API Endpoints

**Goal**: Build all backend data endpoints. These query existing Qtip MySQL tables and return current-period and prior-period values for every page.

---

## Step 3A — Period Resolution Utility

**File**: `backend/src/utils/periodUtils.ts`

```typescript
export interface DateRange { start: Date; end: Date }
export interface PeriodRanges { current: DateRange; prior: DateRange }

export function resolvePeriod(period: string, customStart?: string, customEnd?: string): PeriodRanges
```

Supported period values and their prior-period logic:

| Period | Current | Prior |
|--------|---------|-------|
| `current_week` | This Mon–Sun | Last Mon–Sun |
| `prior_week` | Last Mon–Sun | Two weeks ago |
| `current_month` | 1st–today | Same range last month |
| `prior_month` | Last full month | Month before that |
| `current_quarter` | Quarter start–today | Same range prior quarter |
| `prior_quarter` | Last full quarter | Quarter before that |
| `current_year` | Jan 1–today | Same range last year |
| `prior_year` | Last full year | Year before that |
| `custom` | start–end params | Same-length window immediately before start |

---

## Step 3B — QCAnalyticsService

**File**: `backend/src/services/QCAnalyticsService.ts`

This service contains all database query logic. Build these methods:

```typescript
class QCAnalyticsService {
  // All 28 KPI values for current and prior periods
  async getKpiValues(deptKeys: number[], ranges: PeriodRanges): Promise<{ current: Record<string,number>, prior: Record<string,number> }>

  // 6-month trend data for requested KPI codes
  async getTrends(deptKeys: number[], kpiCodes: string[], endDate: Date): Promise<Array<{ month: string, [code: string]: number | string }>>

  // Agent list summary
  async getAgents(deptKeys: number[], ranges: PeriodRanges): Promise<AgentSummary[]>

  // Full agent profile (all sections)
  async getAgentProfile(userId: number, ranges: PeriodRanges): Promise<AgentProfile>

  // Quality page
  async getScoreDistribution(deptKeys: number[], formIds: number[], ranges: PeriodRanges): Promise<ScoreBucket[]>
  async getCategoryScores(deptKeys: number[], formId: number | null, ranges: PeriodRanges): Promise<CategoryScore[]>
  async getMissedQuestions(deptKeys: number[], formIds: number[], ranges: PeriodRanges): Promise<MissedQuestion[]>
  async getQualityDeptComparison(ranges: PeriodRanges): Promise<DeptQualityRow[]>

  // Coaching page
  async getCoachingTopics(deptKeys: number[], ranges: PeriodRanges): Promise<CoachingTopic[]>
  async getRepeatOffenders(deptKeys: number[], ranges: PeriodRanges): Promise<RepeatOffender[]>
  async getQuizBreakdown(deptKeys: number[], ranges: PeriodRanges): Promise<QuizBreakdown>
  async getCoachingDeptComparison(ranges: PeriodRanges): Promise<DeptCoachingRow[]>

  // Warnings page
  async getWriteUpPipeline(deptKeys: number[], ranges: PeriodRanges): Promise<WriteUpPipeline>
  async getActiveWriteUps(deptKeys: number[], ranges: PeriodRanges): Promise<ActiveWriteUp[]>
  async getEscalationData(deptKeys: number[], ranges: PeriodRanges): Promise<EscalationData>
  async getPolicyViolations(deptKeys: number[], ranges: PeriodRanges): Promise<PolicyViolation[]>
  async getWarningsDeptComparison(ranges: PeriodRanges): Promise<DeptWarningsRow[]>
}
```

**Source table mapping:**

| KPI / Data | Query source |
|-----------|-------------|
| `avg_qa_score`, `audits_completed` | `submission` where `status='FINALIZED'` |
| `dispute_rate`, `dispute_upheld_rate` | `dispute` joined to `submission` |
| `critical_fail_rate` | `submission_answer` joined to `form_question` (auto-fail flag) |
| `coaching_sessions_completed`, `coaching_cadence` | `coaching_session` |
| `coaching topics` | `coaching_session` joined to `coaching_session_topic` and `coaching_topic` |
| `quiz_pass_rate`, `avg_quiz_score` | `quiz_attempt` |
| `total_writeups_issued`, `escalation_rate` | `write_up`, `write_up_prior_discipline` |
| `policy violations` | `write_up` joined to `write_up_policy` |
| Agent filtering | `user` joined to `department`, scoped by `ie_dim_employee.department_key` |

---

## Step 3C — Controller

**File**: `backend/src/controllers/insightsQC.controller.ts`

Every handler follows this exact pattern:

```typescript
export const getQCKpis = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    // 1. Check page access via InsightsPermissionService
    const access = await permissionService.resolveAccess(req.user.user_id, roleId, 'qc_overview')
    if (!access.canAccess) { res.status(403).json({ error: 'Access denied' }); return; }

    // 2. Resolve department keys (combine requested depts with data scope)
    const deptKeys = await resolveDeptKeys(req.user.user_id, access, req.query.departments)

    // 3. Resolve period date ranges
    const ranges = resolvePeriod(req.query.period as string, req.query.start as string, req.query.end as string)

    // 4. Compute and return
    const data = await qcService.getKpiValues(deptKeys, ranges)
    res.json(data)
  } catch (err) {
    console.error('getQCKpis error:', err)
    res.status(500).json({ error: 'Failed to compute KPIs' })
  }
}
```

Build one handler per endpoint listed in Step 3D.

---

## Step 3D — Routes

**File**: `backend/src/routes/insightsQC.routes.ts`

```typescript
router.get('/kpis',                       qc.getQCKpis)
router.get('/trends',                     qc.getQCTrends)
router.get('/agents',                     qc.getQCAgents)
router.get('/agent/:userId',              qc.getQCAgentProfile)
router.get('/quality/score-distribution', qc.getScoreDistribution)
router.get('/quality/categories',         qc.getCategoryScores)
router.get('/quality/missed-questions',   qc.getMissedQuestions)
router.get('/quality/dept-comparison',    qc.getQualityDeptComparison)
router.get('/coaching/topics',            qc.getCoachingTopics)
router.get('/coaching/repeat-offenders',  qc.getRepeatOffenders)
router.get('/coaching/quizzes',           qc.getQuizBreakdown)
router.get('/coaching/dept-comparison',   qc.getCoachingDeptComparison)
router.get('/warnings/pipeline',          qc.getWriteUpPipeline)
router.get('/warnings/active',            qc.getActiveWriteUps)
router.get('/warnings/escalation',        qc.getEscalationData)
router.get('/warnings/policies',          qc.getPolicyViolations)
router.get('/warnings/dept-comparison',   qc.getWarningsDeptComparison)
```

Mount this router in `backend/src/routes/insights.routes.ts`:

```typescript
import qcRouter from './insightsQC.routes'
router.use('/qc', qcRouter)
```

---

## Step 3E — Frontend Service and Hooks

**File**: `frontend/src/services/insightsService.ts` — add QC types and fetch functions at the bottom. One function per endpoint.

**File**: `frontend/src/hooks/useQCFilters.ts` — shared filter state hook:

```typescript
export function useQCFilters() {
  const [departments, setDepartments] = useState<string[]>([])
  const [period, setPeriod] = useState('current_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [forms, setForms] = useState<string[]>([])

  const params = useMemo(() => ({
    departments: departments.join(','),
    period,
    start: period === 'custom' ? customStart : undefined,
    end: period === 'custom' ? customEnd : undefined,
    forms: forms.join(','),
  }), [departments, period, customStart, customEnd, forms])

  return { departments, setDepartments, period, setPeriod,
           customStart, setCustomStart, customEnd, setCustomEnd,
           forms, setForms, params }
}
```

---

## Phase 3 — Verify Before Proceeding to Phase 4

Test every endpoint with a valid auth token using Postman or curl:

- [ ] `GET /api/insights/qc/kpis?period=current_month` returns `{ current: {...}, prior: {...} }` with values for all 28 KPI codes
- [ ] `current.avg_qa_score` and `prior.avg_qa_score` are different numbers (confirming different date ranges)
- [ ] `GET /api/insights/qc/agents` returns an array with `name`, `dept`, `qa`, `trend`, `coaching`, `quiz`, `disputes`, `writeups`, `risk`, `cadence`, `expected`
- [ ] `GET /api/insights/qc/agent/1` returns full profile with `formReviews`, `coachingSessions`, `quizzes`, `writeUps`
- [ ] `GET /api/insights/qc/quality/missed-questions` returns objects with `question`, `form`, `missRate`, and an `agents` array
- [ ] `GET /api/insights/qc/warnings/policies` returns objects with `policy`, `count`, and an `agentDetails` array
- [ ] All endpoints return 403 for a user without access to the page
- [ ] QA user (role 2) only receives data for their own department
- [ ] No endpoint returns a 500 error

---

---

# PHASE 4 — Overview & Quality Deep Dive Pages

**Goal**: Replace the first two placeholder pages with fully functional UI using real data.

---

## Page 1 — `QCOverviewPage.tsx`

**Mockup reference**: The `view === V.DASH` section in the mockup file.

```
InsightsFilterBar (sticky — no form filter)
Page header: "Quality & Coaching Overview"
Subtitle: [selected dept] · [period] · "Pace targets managed in Insights Engine Settings → KPI Thresholds"

── Quality row ───────────────────────────────────────
Row label: 🎯 Quality — click to drill down  (entire row clickable → /qc-quality)
5-column KpiTile grid (small variant, all with pv deltas):
  audits_assigned | audits_completed | audit_completion_rate | avg_qa_score | critical_fail_rate

── Coaching row ──────────────────────────────────────
Row label: 📚 Coaching — click to drill down  (→ /qc-coaching)
4-column KpiTile grid (small variant, all with pv deltas):
  coaching_sessions_assigned | coaching_sessions_completed | coaching_completion_rate | quiz_pass_rate

── Performance Warnings row ──────────────────────────
Row label: ⚠️ Performance Warnings — click to drill down  (→ /qc-warnings)
3-column KpiTile grid (small variant, all with pv deltas):
  total_writeups_issued | escalation_rate | repeat_offender_rate

── Trend charts ──────────────────────────────────────
2-column row:
  Left:  InsightsSection "6-Month QA Trend"
           TrendChart (avg_qa_score, color=#00aeef, goalValue=90)
  Right: InsightsSection "6-Month Coaching Completion Trend"
           TrendChart (coaching_completion_rate, color=#8b5cf6, goalValue=92)

── Agent Leaderboard ─────────────────────────────────
InsightsSection "Agent Leaderboard"
  2-column layout:
    Left:  "▼ Bottom 5 — Needs Attention" (sorted ascending by QA)
           Table columns: # | Agent | Dept | QA | Trend | Cadence | Disputes | Write-Ups
           Row hover: bg-red-50, click → navigate to Agent Performance page with agent preselected
    Right: "▲ Top 5 — Top Performers" (sorted descending by QA)
           Same columns, row hover: bg-emerald-50, click → Agent Performance page
  Footer link: "View full agent leaderboard →" → /app/insights/qc-agents
```

---

## Page 2 — `QCQualityPage.tsx`

**Mockup reference**: The `view === V.QUALITY` section in the mockup file.

```
InsightsFilterBar (sticky — WITH form filter)
Page header: "Quality Deep Dive"

── KPI tiles ─────────────────────────────────────────
Row 1 — 5-column grid (full size, with pv deltas):
  avg_qa_score | audits_assigned | audits_completed | audit_completion_rate | critical_fail_rate

Row 2 — 5-column grid (full size, with pv deltas):
  dispute_rate | dispute_upheld_rate | dispute_not_upheld_rate | dispute_adjusted_rate | avg_dispute_resolution_time

Row 3 — 2-column grid:
  time_to_audit | qa_score_trend

── Charts ────────────────────────────────────────────
2-column row:
  Left:  InsightsSection "QA Score Trend"
           TrendChart (avg_qa_score, 6 months, goalValue=90)
  Right: InsightsSection "Score Distribution"
           Form filter (from page filter bar)
           Horizontal bar histogram: score buckets 0–59, 60–69, 70–79, 80–84, 85–89, 90–94, 95–100
           Each bucket: label | bar | count
           Vertical goal-line marker at score 90

── Analysis sections ─────────────────────────────────
2-column row:
  Left:  InsightsSection "Dispute Analysis"
           StatRows: Total Filed | Upheld | Rejected | Adjusted | Pending | Avg Resolution Time
  Right: InsightsSection "Timeliness"
           StatRows: Avg Time to Audit | Avg Time to Coaching | Target Audit Time | Target Coaching Time

InsightsSection "Average Score by Form"
  Table: Form | Submissions | Avg Score (colored dot + value) | vs Goal | Status badge
  Click a row → sets selected form in filter, updates Category Performance below

InsightsSection "Category Performance — [All Forms / selected form name]"
  Table: Category | Form | Score | Goal | vs Goal | Trend | Status badge
  Filtered by currently selected form

InsightsSection "Top Missed Questions"
  One ExpandableRow per question:
    Summary: ▶ | Question text | Form | Category | Miss Rate | Avg Score Impact | bar chart
    Expanded: table of agents who missed this question
      Agent name (clickable → Agent Performance) | Dept | Score on this Q | Overall QA | Attempts

InsightsSection "Department Comparison"
  Table: Dept | Assigned | Completed | Completion % | QA Score | Dispute Rate | Upheld Rate | Crit Fail % | Time to Audit
  Values have colored threshold dots. Click row → filters page to that department.
```

---

## Phase 4 — Verify Before Proceeding to Phase 5

- [ ] QCOverviewPage loads without errors and shows real data
- [ ] All KpiTiles show `▲`/`▼` deltas with correct direction-aware coloring
- [ ] Clicking the Quality row label navigates to QCQualityPage
- [ ] Clicking the Coaching row label navigates to QCCoachingPage
- [ ] Clicking the Warnings row label navigates to QCWarningsPage
- [ ] Both trend charts render with the dashed goal reference line
- [ ] Agent leaderboard shows exactly 5 agents in each column, sorted correctly
- [ ] Clicking an agent navigates to QCAgentsPage with that agent's profile open
- [ ] Changing the department filter updates all tiles, charts, and leaderboard
- [ ] Changing the time period updates all data
- [ ] QCQualityPage loads without errors and shows real data
- [ ] All 12 quality KpiTiles render with correct values and deltas
- [ ] Score distribution renders as a histogram with a goal line marker
- [ ] Selecting a form in the filter bar updates the Category Performance table
- [ ] Clicking a form row in "Average Score by Form" also filters Category Performance
- [ ] Missed Questions rows expand and collapse; only one expanded at a time
- [ ] Agent names in missed questions drill-down are clickable and navigate correctly
- [ ] Department Comparison table shows all departments with colored threshold dots

---

---

# PHASE 5 — Coaching & Performance Warnings Pages

**Goal**: Replace the third and fourth placeholder pages.

---

## Page 3 — `QCCoachingPage.tsx`

**Mockup reference**: The `view === V.TRAINING` section in the mockup file.

```
InsightsFilterBar (sticky — no form filter)
Page header: "Coaching"

── KPI tiles ─────────────────────────────────────────
5-column grid (full size, with pv deltas):
  coaching_sessions_assigned | coaching_sessions_completed | coaching_completion_rate | coaching_cadence | coaching_delivery_rate

── Most Coached Topics ───────────────────────────────
InsightsSection "Most Coached Topics"
Description: "Click a topic to see which agents were coached."
One ExpandableRow per topic (only one expanded at a time):
  Summary row: ▶ | Topic name | Sessions count | Agents count | Repeat Rate (color: >30%=red, >15%=orange, 1-15%=green text, 0=—) | horizontal bar
  Expanded detail: table
    Agent name (clickable) | Dept | Sessions (≥3=red, ≥2=orange, 1=normal) | Last Coached | Accounts | Repeat? badge
    Footer: "Click an agent name to view their full profile."

── Repeat Coaching Agents ────────────────────────────
InsightsSection "Repeat Coaching — Agents Needing Escalation"
Description: "Agents coached on the same topic multiple times."
One ExpandableRow per agent (only one expanded at a time):
  Summary row: ▶ | Agent | Department | Total Sessions | Unique Topics | Repeat Topics (≥2=red) | QA Score (colored) | Status badge
  Expanded detail: topic breakdown table
    Topic | Sessions count (colored) | Status badge (Repeat/First)
    "View full agent profile →" link (clickable, navigates to Agent Performance)

── Quiz Performance ──────────────────────────────────
InsightsSection "Quiz Performance"
  3-column small KpiTile row (with pv deltas):
    quiz_pass_rate | avg_quiz_score | avg_attempts_to_pass

  "Quiz Breakdown" table:
    Quiz name | Attempts | Pass Rate (colored) | Avg Score (colored) | Avg Tries (colored) | Fails (colored)

  "Agents with Most Failed Quizzes" table:
    Agent (clickable) | Dept | Failed Quizzes (comma-separated names) | Fails count | Avg Score | QA Score
    Row hover: bg-red-50

── Department Comparison ─────────────────────────────
InsightsSection "Department Coaching Comparison"
  Table: Dept | Assigned | Completed | Completion % | Cadence | Delivery | Quiz Pass | Avg Quiz | Attempts
  Values have colored threshold dots. Click row → filters to that department.
```

---

## Page 4 — `QCWarningsPage.tsx`

**Mockup reference**: The `view === V.COACHING` section in the mockup file.

```
InsightsFilterBar (sticky — no form filter)
Page header: "Performance Warnings"

── KPI tiles ─────────────────────────────────────────
3-column grid (full size, with pv deltas):
  total_writeups_issued | escalation_rate | repeat_offender_rate

── Pipeline & Type ───────────────────────────────────
2-column row:
  Left:  InsightsSection "Write-Up Status Pipeline"
           7 status rows, each with colored dot + count:
             Draft (gray) | Scheduled (purple) | Delivered (brand blue) |
             Awaiting Signature (orange) | Signed (yellow) | Follow-Up Pending (red) | Closed (green)
           Bold "Total Active" row with divider at bottom

  Right: InsightsSection "Write-Up Type Distribution"
           3 type bars (label + percentage bar + count):
             Verbal Warning (yellow) | Written Warning (orange) | Final Warning (red)
           StatRows below: Avg Days to Closure | Pending Follow-Ups | Overdue Follow-Ups

── Active Write-Ups ──────────────────────────────────
InsightsSection "Active Write-Ups"
  Table (click row → Agent Performance page, hover = bg-red-50):
    Agent | Dept | Type badge | Status badge | Created | Meeting date | Follow-Up date | Prior count | Policies

── Escalation & Repeat ───────────────────────────────
2-column row:
  Left:  InsightsSection "Escalation Path"
           3 boxes with arrow connectors:
             [Verbal: N] → [Written: N] → [Final: N]
             Box colors: yellow / orange / red
           StatRows: Escalation Rate (Verbal→Written) | Escalation Rate (Written→Final) | Agents on Final Warning

  Right: InsightsSection "Repeat Write-Up Agents"
           One row per agent with prior write-up (compact, single line):
             [Agent name (clickable)]  [Prior: N · Type badge · Status text]
           Hover: bg-red-50

── Policy Violations ─────────────────────────────────
InsightsSection "Most Violated Policies"
  Description: "Click a policy to see which agents were cited."
  One ExpandableRow per policy (only one expanded at a time):
    Summary: ▶ | Policy name | "N violations · N agents" | horizontal bar
    Expanded: agent table
      Agent name (clickable) | Dept | Type badge | Status text

── Department Comparison ─────────────────────────────
InsightsSection "Department Write-Up Comparison"
  Table: Dept | Write-Up Rate | Escalation | Repeat Offender | Resolution | Active | Closed
  Click row → filters to that department.
```

---

## Phase 5 — Verify Before Proceeding to Phase 6

- [ ] QCCoachingPage loads without errors and shows real data
- [ ] All 5 coaching KpiTiles show `▲`/`▼` deltas with correct coloring
- [ ] Coaching topics expand and collapse; only one topic expanded at a time
- [ ] Agent names in coaching topic drill-down navigate to Agent Performance page
- [ ] Repeat coaching agent rows expand correctly; "View full agent profile →" works
- [ ] Quiz breakdown table shows correct pass rate coloring (green ≥85%, orange ≥70%, red below)
- [ ] Department Comparison renders all departments
- [ ] QCWarningsPage loads without errors and shows real data
- [ ] All 3 warnings KpiTiles show `▲`/`▼` deltas
- [ ] Status Pipeline shows all 7 statuses with correct colored dots and counts
- [ ] Type Distribution shows percentage bars for Verbal/Written/Final
- [ ] Escalation Path shows three colored boxes connected by arrows
- [ ] Repeat Write-Up Agents renders single-line format: name + Prior count + Type badge + Status
- [ ] Active Write-Ups table rows navigate to Agent Performance on click
- [ ] Most Violated Policies expand to show agent tables; agent rows are clickable
- [ ] Changing the department filter updates all sections on both pages

---

---

# PHASE 6 — Agent Performance Page

**Goal**: Build the most complex page — a two-mode page. Mode 1 is an agent list. Mode 2 is a full agent profile that replaces the list (no separate route needed — managed by local state).

---

## `QCAgentsPage.tsx`

**Mockup reference**: The `view === V.AGENTS` and `view === V.AGENT` sections in the mockup file.

Managed by: `const [selectedAgent, setSelectedAgent] = useState<AgentSummary | null>(null)`

On mount: if `location.state?.selectedUserId` is set (from navigation from other pages), auto-fetch that agent and set it as selected.

---

### Mode 1 — Agent List

```
InsightsFilterBar (sticky — no form filter, no back button)
Page header: "Agent Performance"
Subtitle: [dept] · [period] · "Click any agent to view their full profile"

InsightsSection (no title)
  Sortable table using TanStack Table:
    Agent (brand-color link text) | Department | QA Score (dot + value) |
    Trend (▲ green / ▼ red) | Cadence (X/Y — green if met, orange if ≥75%, red otherwise) |
    Quiz (dot + value) | Sessions | Disputes (red badge if >0, else "0") |
    Write-Ups (red badge if >0, else "0") | Status (At Risk badge or OK green badge)

  Click any row → setSelectedAgent(agent), scroll to top
```

---

### Mode 2 — Agent Profile

```
InsightsFilterBar (sticky — WITH form filter, WITH back button "← Back" → setSelectedAgent(null))
[Agent name] heading  +  "At Risk" badge if applicable
Subtitle: [dept] · [period]

── Headline Tiles ─────────────────────────────────────────────
6-column custom card row (NOT standard KpiTile — bespoke layout):
  QA Score (value + ▲/▼ delta vs prior, colored) |
  Trend (▲/▼ value, colored) |
  Cadence (X/Y format, colored) |
  Quiz Score (value + ▲/▼ delta vs prior, colored) |
  Disputes (colored: 0=green, 1-2=orange, 3+=red) |
  Write-Ups (colored: 0=green, >0=red)

── Blue accent header bar ──────────────────────────────────────
"Quality"  (text-sm font-bold, bottom border in brand blue #00aeef)

2-column row:
  Left: InsightsSection "QA Score Trend"
    TrendChart for this agent's QA over 6 months
    StatRows: Total Evaluations | Highest Score | Lowest Score | Critical Fails

  Right: InsightsSection "Dispute Activity"
    StatRows: Total Disputes Filed | Upheld | Rejected | Adjusted | Avg Resolution Time

InsightsSection "Forms Performance"
  Description: "Click a form to see individual review scores."
  One ExpandableRow per form the agent was evaluated on (only one expanded at a time):
    Summary: ▶ | Form name | Avg score (color-coded) | N reviews
    Expanded: table of individual QA evaluations
      Review Date | Call Date | Score (colored: ≥85%=green, ≥75%=orange, <75%=red)

InsightsSection "Category Performance — [form name or All Forms]"
  Table: Category | Form | Agent Score (colored) | Dept Avg | Goal | Trend | Status badge
  Updates when form filter changes

── Purple accent header bar ────────────────────────────────────
"Coaching"  (text-sm font-bold, bottom border in purple #8b5cf6)

InsightsSection "Coaching Summary"
  4-stat bar: Cadence | Total Sessions | Completed | Pending

  "Coaching Sessions" table:
    Date | Topics Covered | Status badge
    For Topics Covered: list topics inline. If a topic appears ≥2 times in the period,
    show "(Nx in period)" in red text next to that topic name.

  "Topic Frequency" section (shown only when agent has coaching sessions):
    One row per unique topic: Topic | count× (colored) | Repeat badge or First badge

InsightsSection "Quiz Performance"
  Stat strip: Quiz Score | Pass Rate | Avg Attempts (StatRow format)
  Description: "Click to expand quiz details."
  One ExpandableRow per quiz attempt (only one expanded at a time):
    Summary: ▶ | Quiz name | Score (colored) | Passed or Failed badge
    Expanded: 4-column grid
      Score | Attempts | Date | Result (Pass in green / Fail in red)

── Red accent header bar ───────────────────────────────────────
"Performance Warnings"  (text-sm font-bold, bottom border in red #ef4444)

IF agent has write-ups:
  InsightsSection "Write-Up History"
    Table: Type badge | Status badge | Created | Meeting | Follow-Up | Manager | Prior count |
           Coaching Linked (✓ green or ✗ red) | Policies (comma-separated)
    StatRows below table: Total Write-Ups (period) | Pending Follow-Ups | Policies Cited

IF agent has NO write-ups:
  InsightsSection "Write-Up History"
    Centered: large ✓ icon (text-3xl) + "No write-ups on record" (green bold) + subtitle text
    StatRows: Prior Write-Ups (All Time): 0 | Current Status: Clean Record
```

---

## Phase 6 — Verify Before Proceeding to Phase 7

- [ ] Agent list loads with real data; all columns are present and sortable
- [ ] Clicking an agent switches to profile mode; the list disappears and profile appears
- [ ] "← Back" returns to the agent list
- [ ] Agent profile shows correct name and "At Risk" badge when risk flag is true
- [ ] All 6 headline tiles render; QA Score and Quiz Score show `▲`/`▼` delta
- [ ] Forms Performance section shows expandable rows; expanded view shows Review Date, Call Date, Score for each individual evaluation
- [ ] Topics Covered in Coaching Sessions shows "(Nx in period)" in red for topics appearing ≥2 times
- [ ] Topic Frequency section shows "Repeat" badge for topics with count ≥2
- [ ] Quiz expandable rows show Score, Attempts, Date, Result in a 4-column grid
- [ ] An agent WITH write-ups shows the full history table with all columns including Coaching Linked
- [ ] An agent WITHOUT write-ups shows the green ✓ + "No write-ups on record"
- [ ] Navigating from Overview leaderboard auto-opens the correct agent profile
- [ ] Navigating from Coaching topic drill-down auto-opens the correct agent profile
- [ ] Navigating from Warnings active write-ups table auto-opens the correct agent profile
- [ ] Changing the form filter on the profile updates the Category Performance table

---

---

# PHASE 7 — Cleanup & Polish

**Goal**: Remove old placeholders, add loading and empty states, and do a final end-to-end check.

---

## Step 7A — Remove Old Placeholders

- Delete or archive `TeamDashboardPage.tsx` — it is fully replaced by QCOverviewPage
- Update `DashboardPage.tsx` to redirect to `/app/insights/qc-overview` or repurpose as an Insights home screen
- Remove the old "My Dashboard" and "Team Dashboard" nav items from `navConfig.ts`
- Remove the separate `analytics` section from `NAV_CONFIG` (the "QA Analytics" item is now the Quality Deep Dive page) — OR update the analytics item to point to `/app/insights/qc-quality`

---

## Step 7B — Add Loading States

For every section that fetches data, show a skeleton while `isLoading` is true:

- KpiTile rows: a row of gray animated skeleton boxes matching tile dimensions
- Tables: 5 gray animated skeleton rows
- Charts: a gray rectangle placeholder the same height as the chart
- Use TanStack Query's `isLoading` boolean on each query

---

## Step 7C — Add Empty States

When queries return no results:

- KpiTile values: show `—` instead of a number
- Tables: centered message "No data for the selected period and filters"
- Charts: "No data available" centered inside the chart container
- Agent list: "No agents match the selected filters"

---

## Step 7D — Error Handling

- Each page: show an error card when `isError` is true — "Unable to load data. Please try again." with a retry button
- Log errors to the console with context

---

## Step 7E — Responsive Layout

- KpiTile grids: collapse 5-column → 3-column below 1280px wide
- 2-column section rows: collapse to single column below 1024px
- Tables: add `overflow-x: auto` wrapper for horizontal scroll on small screens

---

## Phase 7 — Final Verification Checklist

- [ ] No "Coming Soon" placeholder pages exist under any QC route
- [ ] Old nav items (My Dashboard, Team Dashboard, QA Analytics) are removed or correctly updated
- [ ] All 5 pages show skeleton loaders during data fetch
- [ ] All empty states display correctly with no data
- [ ] All error states display with a retry button
- [ ] No console errors during normal page use
- [ ] Agent name links from all pages (Coaching topics, Warnings table, Quality missed questions) navigate to the Agent Performance page with the correct agent preselected
- [ ] **Role check — Admin (role 1)**: sees all 5 QC pages with full data
- [ ] **Role check — Manager (role 5)**: sees all 5 QC pages with full data
- [ ] **Role check — QA (role 2)**: sees Overview, Quality Deep Dive, Coaching, Agent Performance; sees only their department's data
- [ ] **Role check — Trainer (role 4)**: sees Overview, Coaching, and Agent Performance; does NOT see Quality Deep Dive or Performance Warnings
- [ ] **Role check — User (role 3)**: does NOT see any QC pages in the sidebar
