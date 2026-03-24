# CURSOR PROMPT — Quality Section Rebuild (Part 3 of 3)
## QualityAnalyticsPage + Remove ScoringPage + Route Fixes

Continue from Parts 1 & 2. Same global rules apply.

---

## FILE 5: `frontend/src/pages/quality/QualityAnalyticsPage.tsx`

Comprehensive analytics with date presets, filters, multiple report types, and Recharts visualization.
Accessible to Admin (1), QA (2), and Manager (5).

```tsx
import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  BarChart3, Download, RefreshCw, Filter, Calendar,
  TrendingUp, Users, FileBarChart,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Date presets ──────────────────────────────────────────────────────────────
type Preset = '7d' | '30d' | '90d' | 'mtd' | 'qtd' | 'ytd' | 'custom'

function getPresetDates(preset: Preset): { start: string; end: string } {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const sub = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d }

  switch (preset) {
    case '7d':  return { start: fmt(sub(7)),  end: fmt(today) }
    case '30d': return { start: fmt(sub(30)), end: fmt(today) }
    case '90d': return { start: fmt(sub(90)), end: fmt(today) }
    case 'mtd': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: fmt(d), end: fmt(today) }
    }
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3)
      const d = new Date(today.getFullYear(), q * 3, 1)
      return { start: fmt(d), end: fmt(today) }
    }
    case 'ytd': return { start: `${today.getFullYear()}-01-01`, end: fmt(today) }
    default:    return { start: fmt(sub(30)), end: fmt(today) }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'Month to date' },
  { value: 'qtd', label: 'Quarter to date' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'custom', label: 'Custom range' },
]

// ── Score color for charts ────────────────────────────────────────────────────
function scoreBarColor(score: number): string {
  if (score >= 85) return '#10b981'
  if (score >= 70) return '#f59e0b'
  return '#ef4444'
}

// ── Chart components ──────────────────────────────────────────────────────────
function TrendsChart({ data }: { data: any }) {
  const chartData = data?.labels?.map((l: string, i: number) => ({
    name: l,
    score: data.datasets?.[0]?.data?.[i] ?? 0,
  })) ?? []

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Avg Score']} />
        <Line type="monotone" dataKey="score" stroke="#00aeef" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function AveragesChart({ data }: { data: any }) {
  const chartData = data?.labels?.map((l: string, i: number) => ({
    name: l,
    score: data.datasets?.[0]?.data?.[i] ?? 0,
  })) ?? []

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Avg Score']} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]}
          fill="#00aeef"
          label={{ position: 'right', formatter: (v: number) => `${v.toFixed(1)}%`, fontSize: 11 }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function RawScoresTable({ data }: { data: any }) {
  if (!data?.labels?.length) return <p className="text-slate-400 text-sm py-4 text-center">No data.</p>

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {data.datasets?.map((ds: any) => (
              <TableHead key={ds.name} className="text-right">{ds.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.labels.map((l: string, i: number) => (
            <TableRow key={l}>
              <TableCell className="font-medium text-sm">{l}</TableCell>
              {data.datasets?.map((ds: any) => (
                <TableCell key={ds.name} className="text-right text-sm">
                  {typeof ds.data[i] === 'number' ? `${ds.data[i].toFixed(1)}%` : ds.data[i] ?? '—'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SummaryCards({ data }: { data: any }) {
  if (!data?.summary) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Object.entries(data.summary).map(([k, v]) => (
        <div key={k} className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
          <p className="text-2xl font-bold text-slate-900">
            {typeof v === 'number' && k.toLowerCase().includes('score') ? `${(v as number).toFixed(1)}%` : String(v)}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QualityAnalyticsPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const roleId = user?.role_id ?? 0
  const isManager = roleId === 5

  // Filters
  const [preset, setPreset] = useState<Preset>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reportType, setReportType] = useState<'trends' | 'averages' | 'raw_scores' | 'summary'>('trends')
  const [groupBy, setGroupBy] = useState<'csr' | 'department' | 'form'>('csr')
  const [aggregation, setAggregation] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [departmentId, setDepartmentId] = useState<string>('')
  const [csrId, setCsrId] = useState<string>('')
  const [formId, setFormId] = useState<string>('')

  // Derived dates
  const dates = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd }
    return getPresetDates(preset)
  }, [preset, customStart, customEnd])

  // Filter options
  const { data: filterOptions } = useQuery({
    queryKey: ['analytics-filters'],
    queryFn: () => qaService.getAnalyticsFilters(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: teamCSRs } = useQuery({
    queryKey: ['team-csrs'],
    queryFn: () => qaService.getTeamCSRs(),
    enabled: isManager,
  })

  const { data: forms } = useQuery({
    queryKey: ['forms-filter'],
    queryFn: () => qaService.getFormsForFilter(),
    staleTime: 5 * 60 * 1000,
  })

  // Report query (manual trigger via state)
  const [runKey, setRunKey] = useState(0)

  const {
    data: report,
    isLoading: reportLoading,
    isError: reportError,
  } = useQuery({
    queryKey: ['analytics-report', runKey, dates, reportType, groupBy, aggregation, departmentId, csrId, formId],
    queryFn: () => qaService.getComprehensiveReport({
      report_type: reportType,
      start_date: dates.start,
      end_date: dates.end,
      department_id: departmentId ? parseInt(departmentId) : undefined,
      csr_id: csrId ? parseInt(csrId) : undefined,
      form_id: formId ? parseInt(formId) : undefined,
      group_by: groupBy,
      aggregation,
    }),
    enabled: runKey > 0 && !!dates.start && !!dates.end,
  })

  const runReport = () => {
    if (!dates.start || !dates.end) {
      toast({ title: 'Date required', description: 'Please select a date range.', variant: 'destructive' })
      return
    }
    setRunKey(k => k + 1)
  }

  // Access guard
  if (roleId !== 1 && roleId !== 2 && roleId !== 5) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          QA Analytics is not available for your role.
        </div>
      </div>
    )
  }

  const csrOptions = isManager ? (teamCSRs ?? []) : (filterOptions?.csrs?.map(c => ({ id: c.id, name: c.name })) ?? [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">QA Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Comprehensive quality reporting</p>
      </div>

      {/* Filter panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
          <Filter className="h-4 w-4" /> Report Filters
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Date preset */}
          <div className="space-y-1.5">
            <Label className="text-xs">Date Range</Label>
            <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Custom dates */}
          {preset === 'custom' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <input
                  type="date" value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#00aeef]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <input
                  type="date" value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#00aeef]"
                />
              </div>
            </>
          )}

          {/* Report type */}
          <div className="space-y-1.5">
            <Label className="text-xs">Report Type</Label>
            <Select value={reportType} onValueChange={v => setReportType(v as typeof reportType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trends">Score Trends</SelectItem>
                <SelectItem value="averages">Averages</SelectItem>
                <SelectItem value="raw_scores">Raw Scores</SelectItem>
                <SelectItem value="summary">Summary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Group by */}
          {(reportType === 'trends' || reportType === 'averages') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Group By</Label>
              <Select value={groupBy} onValueChange={v => setGroupBy(v as typeof groupBy)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csr">CSR</SelectItem>
                  {!isManager && <SelectItem value="department">Department</SelectItem>}
                  <SelectItem value="form">Form</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Aggregation (trends only) */}
          {reportType === 'trends' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Aggregation</Label>
              <Select value={aggregation} onValueChange={v => setAggregation(v as typeof aggregation)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Department (admin/qa only) */}
          {!isManager && filterOptions?.departments && (
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select value={departmentId} onValueChange={v => setDepartmentId(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All departments</SelectItem>
                  {filterOptions.departments.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* CSR */}
          {csrOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">CSR</Label>
              <Select value={csrId} onValueChange={v => setCsrId(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All CSRs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All CSRs</SelectItem>
                  {csrOptions.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Form */}
          {forms && forms.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Form</Label>
              <Select value={formId} onValueChange={v => setFormId(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All forms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All forms</SelectItem>
                  {forms.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.form_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button
            onClick={runReport}
            disabled={reportLoading}
            className="bg-[#00aeef] hover:bg-[#0095cc] text-white"
          >
            {reportLoading ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running...</>
            ) : (
              <><BarChart3 className="h-4 w-4 mr-2" />Run Report</>
            )}
          </Button>
        </div>
      </div>

      {/* Results */}
      {runKey === 0 && (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl py-16 text-center text-slate-400">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">Configure filters and click Run Report</p>
          <p className="text-sm mt-1">Results will appear here</p>
        </div>
      )}

      {reportLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <RefreshCw className="h-8 w-8 mx-auto mb-3 text-[#00aeef] animate-spin" />
          <p className="text-slate-500 text-sm">Generating report...</p>
        </div>
      )}

      {reportError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between">
          <p className="text-red-700 font-medium text-sm">Failed to generate report.</p>
          <Button variant="outline" size="sm" onClick={runReport}>
            <RefreshCw className="h-4 w-4 mr-1" /> Retry
          </Button>
        </div>
      )}

      {report && !reportLoading && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileBarChart className="h-4 w-4 text-[#00aeef]" />
              <span className="font-semibold text-slate-800 text-sm">
                {reportType === 'trends'     && 'Score Trends'}
                {reportType === 'averages'   && 'Average Scores'}
                {reportType === 'raw_scores' && 'Raw Score Data'}
                {reportType === 'summary'    && 'Summary'}
              </span>
              <span className="text-xs text-slate-400 ml-1">
                {dates.start} — {dates.end}
              </span>
            </div>
          </div>

          <div className="p-5 space-y-6">
            {/* Summary cards */}
            {report.summary && <SummaryCards data={report} />}

            {/* Chart */}
            {reportType === 'trends'   && <TrendsChart data={report} />}
            {reportType === 'averages' && <AveragesChart data={report} />}

            {/* Table */}
            {(reportType === 'raw_scores' || reportType === 'averages' || reportType === 'trends') && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Data Table</p>
                <RawScoresTable data={report} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## STEP 6: Delete ScoringPage + Update Routes

### 6A — Delete this file:
```
frontend/src/pages/quality/ScoringPage.tsx
```
Scoring logic is now integrated into `SubmissionsPage.tsx` (the `CategoryScoreBreakdown` component). A separate scoring page is not needed.

### 6B — In `frontend/src/router/index.tsx` (or wherever React Router routes are defined):

Find the quality section routes and make sure they match exactly this:

```tsx
// Quality section routes — NO ScoringPage
{
  path: 'quality',
  element: <AppShell />,  // or whatever wrapper is used
  children: [
    { index: true, element: <Navigate to="overview" replace /> },
    { path: 'overview',     element: <QualityOverviewPage /> },
    { path: 'submissions',  element: <SubmissionsPage /> },
    { path: 'forms',        element: <FormsPage /> },
    { path: 'disputes',     element: <DisputesPage /> },
    { path: 'analytics',    element: <QualityAnalyticsPage /> },
    // NO scoring route
  ],
}
```

Make sure all 5 page components are imported at the top:
```tsx
import QualityOverviewPage    from '@/pages/quality/QualityOverviewPage'
import SubmissionsPage        from '@/pages/quality/SubmissionsPage'
import FormsPage              from '@/pages/quality/FormsPage'
import DisputesPage           from '@/pages/quality/DisputesPage'
import QualityAnalyticsPage   from '@/pages/quality/QualityAnalyticsPage'
```

Remove any import of `ScoringPage`.

### 6C — In `frontend/src/config/navConfig.ts`:

The nav item `{ label: 'Scoring Rules', path: '/app/quality/scoring', icon: 'Settings2', roles: [1,2] }` should be **removed** entirely from the quality section items array. Scoring is integrated into submissions — it's not a separate navigation destination.

The quality section `items` array should be:
```ts
items: [
  { label: 'Overview',     path: '/app/quality/overview',    icon: 'LayoutDashboard', roles: [1,2,3,4,5] },
  { label: 'Form Builder', path: '/app/quality/forms',       icon: 'ClipboardList',   roles: [1,2] },
  { label: 'Submissions',  path: '/app/quality/submissions', icon: 'FileCheck',       roles: [1,2,3,5] },
  { label: 'Disputes',     path: '/app/quality/disputes',    icon: 'AlertTriangle',   roles: [1,2,3,5] },
  { label: 'QA Analytics', path: '/app/quality/analytics',   icon: 'BarChart3',       roles: [1,2,5] },
],
```

---

## STEP 7: Verify qaService.ts has all required methods

Open `frontend/src/services/qaService.ts` and confirm these methods exist. If any are missing, add them:

```ts
// These MUST exist — add if missing:

getQAStats: () => api.get('/qa/stats').then(r => r.data as DashboardStats),
getQACsrActivity: (period: 'week' | 'month') => api.get(`/qa/csr-activity?period=${period}`).then(r => r.data as CSRActivityRow[]),
getManagerStats: () => api.get('/manager/dashboard-stats').then(r => r.data as DashboardStats),
getManagerCsrActivity: (period: 'week' | 'month') => api.get(`/manager/csr-activity?period=${period}`).then(r => r.data as CSRActivityRow[]),
getCSRStats: () => api.get('/csr/dashboard-stats').then(r => r.data as DashboardStats),
getSubmissions: (params) => { /* paginated, builds query string, hits /qa/completed */ },
getSubmissionDetail: (id) => api.get(`/qa/completed/${id}`).then(r => r.data as SubmissionDetail),
getTeamAudits: (params) => { /* paginated, hits /manager/team-audits */ },
getTeamAuditDetail: (id) => api.get(`/manager/team-audits/${id}`).then(r => r.data as SubmissionDetail),
getCSRAudits: (params) => { /* paginated, hits /csr/audits */ },
getCSRAuditDetail: (id) => api.get(`/csr/audits/${id}`).then(r => r.data as SubmissionDetail),
getManagerDisputes: (params) => { /* paginated, hits /manager/disputes */ },
resolveDispute: (id, payload) => api.post(`/manager/disputes/${id}/resolve`, payload).then(r => r.data),
getCSRDisputeHistory: () => api.get('/csr/disputes/history').then(r => r.data as DisputeRecord[]),
submitCSRDispute: (payload) => api.post('/disputes', payload).then(r => r.data),
getForms: (params?) => { /* hits /forms, normalizes array response */ },
getFormDetail: (id) => api.get(`/forms/${id}`).then(r => r.data as FormDetail),
createForm: (payload) => api.post('/forms', payload).then(r => r.data as FormDetail),
updateForm: (id, payload) => api.put(`/forms/${id}`, payload).then(r => r.data as FormDetail),
deactivateForm: (id) => api.delete(`/forms/${id}`).then(r => r.data),
getAnalyticsFilters: () => api.get('/analytics/filters').then(r => r.data),
getComprehensiveReport: (payload) => api.post('/analytics/comprehensive-report', payload).then(r => r.data),
getTeamCSRs: () => api.get('/manager/team-csrs').then(r => r.data as { id: number; name: string }[]),
getFormsForFilter: () => { /* hits /forms?is_active=true&limit=200, normalizes */ },
```

Also confirm the `AnswerRow` type includes these fields (add if missing):
```ts
export interface AnswerRow {
  question_text: string
  answer: string
  score?: number
  category_name?: string
  weight?: number
}
```

---

## STEP 8: Final checklist before finishing

Run through each item and fix if broken:

- [ ] `npm run build` completes with no TypeScript errors
- [ ] All 5 quality pages import from `@/services/qaService` only (never raw axios)
- [ ] `scoreColor` and `scoreBg` are imported from `@/services/qaService` in every file that uses them
- [ ] No import of `react-icons` anywhere in the quality pages (lucide-react only)
- [ ] ScoringPage.tsx is deleted
- [ ] navConfig.ts has no 'scoring' entry in quality items
- [ ] Router has no scoring route
- [ ] FormsPage validates category weights sum to 1.0 before allowing Save
- [ ] SubmissionsPage shows per-category score breakdown in the detail Sheet
- [ ] DisputesPage shows resolve form for Manager (role 5), read-only for Admin/QA, history view for CSR (role 3)

---

**END OF PART 3 — Quality section rebuild complete.**

Give these 3 parts to Cursor in order. Run `npm run build` after each part to catch TypeScript errors early.
