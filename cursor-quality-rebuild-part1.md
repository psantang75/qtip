I'm trying to use our dev role preview.# CURSOR PROMPT — Quality Section Rebuild (Part 1 of 3)
## QualityOverviewPage + SubmissionsPage

You are rebuilding the Quality section of the QTIP+ Insights app. The existing screens in `frontend/src/pages/quality/` are incomplete — data doesn't load, scoring logic is misplaced, and functionality is missing. Replace every file listed below with the exact implementations that follow. **Do not add extra features, do not remove anything specified.**

---

## GLOBAL RULES (apply to ALL files)

```
- Data: TanStack Query v5 — useQuery for reads, useMutation for writes
- Service: always import qaService from '@/services/qaService' — never raw axios
- Toast: useToast from '@/hooks/use-toast'
- Icons: lucide-react only (no react-icons)
- Styling: Tailwind + shadcn/ui — no inline styles
- Score colors: scoreColor() and scoreBg() from '@/services/qaService'
  ≥85 → emerald, ≥70 → amber, <70 → red
- Role IDs: 1=Admin, 2=QA, 3=CSR/User, 4=Trainer, 5=Manager
- All role checks use user?.role_id from useAuth()
- Pagination: page state starts at 1, reset to 1 when filters change
- Loading skeletons: 4–6 rows of h-8 bg-slate-100 animate-pulse rounded
- Error states: red banner with Retry button that calls refetch()
- Empty states: centered muted text with relevant icon
```

---

## FILE 1: `frontend/src/pages/quality/QualityOverviewPage.tsx`

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarCheck, AlertTriangle, TrendingUp, BarChart3,
  Users, ClipboardList, RefreshCw,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function StatCard({
  icon: Icon, label, value, valueClass = '',
}: { icon: React.ElementType; label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <div className={cn('text-3xl font-bold text-slate-900', valueClass)}>{value}</div>
    </div>
  )
}

export default function QualityOverviewPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<'week' | 'month'>('week')

  const isAdminOrQA = user?.role_id === 1 || user?.role_id === 2
  const isManager = user?.role_id === 5
  const isCSR = user?.role_id === 3

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch } = useQuery({
    queryKey: ['qa-overview-stats', user?.role_id],
    queryFn: () =>
      isAdminOrQA ? qaService.getQAStats()
      : isManager  ? qaService.getManagerStats()
      : qaService.getCSRStats(),
    enabled: !!user,
  })

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['qa-csr-activity', period, user?.role_id],
    queryFn: () =>
      isAdminOrQA ? qaService.getQACsrActivity(period)
      : qaService.getManagerCsrActivity(period),
    enabled: !!user && (isAdminOrQA || isManager),
  })

  const { data: recentAudits, isLoading: auditsLoading } = useQuery({
    queryKey: ['csr-recent-audits'],
    queryFn: () => qaService.getCSRAudits({ limit: 5 }),
    enabled: !!user && isCSR,
  })

  if (statsLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-slate-100 animate-pulse rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    )
  }

  if (statsError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center justify-between">
          <p className="text-red-700 font-medium">Failed to load overview stats.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  // ── CSR view ──────────────────────────────────────────────────────────────
  if (isCSR) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your personal QA performance</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={BarChart3} label="My Avg Score"
            value={stats?.avgScore != null ? `${stats.avgScore.toFixed(1)}%` : '—'}
            valueClass={scoreColor(stats?.avgScore ?? 0)}
          />
          <StatCard icon={CalendarCheck} label="Total Audits" value={stats?.totalAudits ?? 0} />
          <StatCard
            icon={AlertTriangle} label="Open Disputes"
            value={stats?.openDisputes ?? 0}
            valueClass={stats?.openDisputes ? 'text-red-600' : ''}
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Recent Audits</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/quality/submissions')}>
              View All
            </Button>
          </div>
          {auditsLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAudits?.items?.length ? (
                  recentAudits.items.map(row => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate('/app/quality/submissions')}
                    >
                      <TableCell>{new Date(row.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{row.form_name}</TableCell>
                      <TableCell>
                        <span className={cn('font-semibold', scoreColor(row.score))}>
                          {row.score.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-slate-400">
                      No recent audits found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    )
  }

  // ── Admin / QA / Manager view ─────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isAdminOrQA ? 'Department-wide QA performance' : "Your team's QA performance"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={CalendarCheck} label="Total Audits" value={stats?.totalAudits ?? 0} />
        <StatCard
          icon={BarChart3} label="Avg Score"
          value={stats?.avgScore != null ? `${stats.avgScore.toFixed(1)}%` : '—'}
          valueClass={scoreColor(stats?.avgScore ?? 0)}
        />
        <StatCard
          icon={AlertTriangle} label="Open Disputes"
          value={stats?.openDisputes ?? 0}
          valueClass={stats?.openDisputes ? 'text-red-600' : ''}
        />
        <StatCard icon={TrendingUp} label="Audits This Week" value={stats?.auditsThisWeek ?? 0} />
      </div>

      {/* Quick nav cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'View Submissions', icon: ClipboardList, path: '/app/quality/submissions' },
          { label: 'View Disputes', icon: AlertTriangle, path: '/app/quality/disputes' },
          { label: 'Analytics', icon: BarChart3, path: '/app/quality/analytics' },
        ].map(({ label, icon: Icon, path }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 hover:border-[#00aeef] hover:bg-[#00aeef]/5 transition-colors text-left"
          >
            <div className="h-9 w-9 rounded-lg bg-[#00aeef]/10 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-[#00aeef]" />
            </div>
            <span className="font-medium text-slate-800">{label}</span>
          </button>
        ))}
      </div>

      {/* CSR Activity Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">CSR Activity</h2>
          <div className="flex gap-1">
            {(['week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 text-sm rounded-md transition-colors',
                  period === p ? 'bg-[#00aeef] text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        {activityLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CSR Name</TableHead>
                {isAdminOrQA && <TableHead>Department</TableHead>}
                <TableHead className="text-right">Audits</TableHead>
                <TableHead className="text-right">Avg Score</TableHead>
                <TableHead className="text-right">Disputes</TableHead>
                <TableHead>Last Audit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity?.length ? (
                activity.map(row => (
                  <TableRow key={row.csr_id}>
                    <TableCell className="font-medium">{row.csr_name}</TableCell>
                    {isAdminOrQA && <TableCell>{row.department_name}</TableCell>}
                    <TableCell className="text-right">{row.total_reviews}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn('font-semibold', scoreColor(row.avg_score))}>
                        {row.avg_score.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{row.disputes}</TableCell>
                    <TableCell>
                      {row.last_audit_date
                        ? new Date(row.last_audit_date).toLocaleDateString()
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={isAdminOrQA ? 6 : 5} className="text-center py-8 text-slate-400">
                    <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No activity data for this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
```

---

## FILE 2: `frontend/src/pages/quality/SubmissionsPage.tsx`

This is the most complex screen. It handles three different roles with different data sources, and shows full submission detail (with **per-category scores calculated inline**) in a slide-out Sheet. The scoring logic lives here — NOT on a separate page.

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, FileText, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, Eye,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, scoreBg, type Submission, type SubmissionDetail } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', scoreBg(score))}>
      {score.toFixed(1)}%
    </span>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    COMPLETED: { label: 'Completed', icon: CheckCircle, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    DRAFT:     { label: 'Draft',     icon: Clock,        cls: 'bg-slate-50  text-slate-600  border-slate-200'  },
    DISPUTED:  { label: 'Disputed',  icon: AlertTriangle,cls: 'bg-amber-50  text-amber-700  border-amber-200'  },
    RESOLVED:  { label: 'Resolved',  icon: CheckCircle,  cls: 'bg-blue-50   text-blue-700   border-blue-200'   },
  }
  const cfg = map[status] ?? { label: status, icon: FileText, cls: 'bg-slate-50 text-slate-600 border-slate-200' }
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border', cfg.cls)}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  )
}

// ── Category score breakdown (key scoring logic) ───────────────────────────────
// Groups answers by category, calculates per-category score, shows weighted total.
// This is the core scoring display — it must appear in EVERY submission detail view.
function CategoryScoreBreakdown({ detail }: { detail: SubmissionDetail }) {
  // Group answers by category
  const categories = detail.answers.reduce<Record<string, {
    weight: number; answers: typeof detail.answers
  }>>((acc, a) => {
    const cat = a.category_name ?? 'General'
    if (!acc[cat]) acc[cat] = { weight: a.weight ?? 0, answers: [] }
    acc[cat].answers.push(a)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(categories).map(([catName, { weight, answers }]) => {
        // Category score = average of question scores within category
        // For YES_NO: score is 1 (yes) or 0 (no) typically normalized to 0–100
        // Use the score field directly from the API answer row
        const scoredAnswers = answers.filter(a => a.score != null)
        const catScore = scoredAnswers.length > 0
          ? (scoredAnswers.reduce((s, a) => s + (a.score ?? 0), 0) / scoredAnswers.length)
          : 0

        return (
          <div key={catName} className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
            {/* Category header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 text-sm">{catName}</span>
                {weight > 0 && (
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    Weight: {(weight * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <ScoreBadge score={catScore} />
            </div>

            {/* Questions */}
            <div className="divide-y divide-slate-100">
              {answers.map((a, i) => (
                <div key={i} className="px-4 py-3">
                  <p className="text-sm text-slate-700 mb-1.5">{a.question_text}</p>
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      'text-sm font-medium',
                      a.answer?.toUpperCase() === 'YES' ? 'text-emerald-600' :
                      a.answer?.toUpperCase() === 'NO'  ? 'text-red-600' : 'text-slate-700',
                    )}>
                      {a.answer ?? '—'}
                    </span>
                    {a.score != null && (
                      <span className={cn('text-xs font-semibold', scoreColor(a.score))}>
                        {a.score.toFixed(0)} pts
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Overall score summary */}
      <div className={cn(
        'flex items-center justify-between rounded-xl p-4 border font-semibold',
        scoreBg(detail.score),
      )}>
        <span className="text-sm">Overall Score</span>
        <span className="text-2xl">{detail.score.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// ── Dispute submission form (CSR) ─────────────────────────────────────────────
function DisputeForm({
  submissionId, onSuccess,
}: { submissionId: number; onSuccess: () => void }) {
  const [reason, setReason] = useState('')
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: () => qaService.submitCSRDispute({ submission_id: submissionId, reason }),
    onSuccess: () => {
      toast({ title: 'Dispute submitted', description: 'Your dispute has been sent to your manager.' })
      qc.invalidateQueries({ queryKey: ['csr-audits'] })
      onSuccess()
    },
    onError: () => toast({ title: 'Error', description: 'Failed to submit dispute.', variant: 'destructive' }),
  })

  return (
    <div className="space-y-3 border border-amber-200 bg-amber-50 rounded-lg p-4 mt-4">
      <h4 className="font-semibold text-amber-800 text-sm">Submit a Dispute</h4>
      <div className="space-y-1.5">
        <Label className="text-xs text-amber-700">Reason for dispute</Label>
        <Textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Explain why you believe this score is incorrect..."
          rows={3}
          className="text-sm bg-white"
        />
      </div>
      <Button
        size="sm"
        onClick={() => mutate()}
        disabled={isPending || reason.trim().length < 10}
        className="bg-amber-600 hover:bg-amber-700 text-white"
      >
        {isPending ? 'Submitting...' : 'Submit Dispute'}
      </Button>
    </div>
  )
}

// ── Manager resolve form ──────────────────────────────────────────────────────
function ResolveDisputeForm({
  disputeId, originalScore, onSuccess,
}: { disputeId: number; originalScore: number; onSuccess: () => void }) {
  const [action, setAction] = useState<'UPHOLD' | 'ADJUST' | 'ASSIGN_TRAINING'>('UPHOLD')
  const [notes, setNotes] = useState('')
  const [newScore, setNewScore] = useState<string>(originalScore.toFixed(1))
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: () => qaService.resolveDispute(disputeId, {
      resolution_action: action,
      resolution_notes: notes,
      new_score: action === 'ADJUST' ? parseFloat(newScore) : undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Dispute resolved', description: `Action: ${action}` })
      qc.invalidateQueries({ queryKey: ['manager-disputes'] })
      qc.invalidateQueries({ queryKey: ['manager-team-audits'] })
      onSuccess()
    },
    onError: () => toast({ title: 'Error', description: 'Failed to resolve dispute.', variant: 'destructive' }),
  })

  return (
    <div className="space-y-4 border border-blue-200 bg-blue-50 rounded-lg p-4 mt-4">
      <h4 className="font-semibold text-blue-800 text-sm">Resolve Dispute</h4>

      <div className="space-y-1.5">
        <Label className="text-xs text-blue-700">Resolution Action</Label>
        <Select value={action} onValueChange={v => setAction(v as typeof action)}>
          <SelectTrigger className="bg-white text-sm h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="UPHOLD">Uphold — Keep original score</SelectItem>
            <SelectItem value="ADJUST">Adjust — Change the score</SelectItem>
            <SelectItem value="ASSIGN_TRAINING">Assign Training</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {action === 'ADJUST' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-blue-700">New Score (%)</Label>
          <Input
            type="number" min={0} max={100} step={0.1}
            value={newScore}
            onChange={e => setNewScore(e.target.value)}
            className="bg-white h-9 text-sm w-32"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-blue-700">Resolution Notes</Label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Explain your decision..."
          rows={3}
          className="text-sm bg-white"
        />
      </div>

      <Button
        size="sm"
        onClick={() => mutate()}
        disabled={isPending || notes.trim().length < 5}
        className="bg-blue-600 hover:bg-blue-700 text-white"
      >
        {isPending ? 'Saving...' : 'Confirm Resolution'}
      </Button>
    </div>
  )
}

// ── Submission detail sheet ───────────────────────────────────────────────────
function SubmissionDetailSheet({
  submissionId, open, onClose, roleId,
}: { submissionId: number | null; open: boolean; onClose: () => void; roleId: number }) {
  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const [showResolveForm, setShowResolveForm] = useState(false)

  const isCSR = roleId === 3
  const isManager = roleId === 5

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['submission-detail', submissionId, roleId],
    queryFn: () => {
      if (!submissionId) return null
      if (isCSR)     return qaService.getCSRAuditDetail(submissionId)
      if (isManager) return qaService.getTeamAuditDetail(submissionId)
      return qaService.getSubmissionDetail(submissionId)
    },
    enabled: !!submissionId && open,
  })

  const handleClose = () => {
    setShowDisputeForm(false)
    setShowResolveForm(false)
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Submission Detail</SheetTitle>
          <SheetDescription>Full scoring breakdown and audit details</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />)}
          </div>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            Failed to load submission details.
          </div>
        )}

        {detail && (
          <div className="space-y-6">
            {/* Metadata header */}
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div><span className="text-slate-500">CSR: </span><span className="font-medium">{detail.csr_name}</span></div>
                <div><span className="text-slate-500">Date: </span><span className="font-medium">{new Date(detail.created_at).toLocaleDateString()}</span></div>
                <div><span className="text-slate-500">Form: </span><span className="font-medium">{detail.form_name}</span></div>
                <div><span className="text-slate-500">Dept: </span><span className="font-medium">{detail.department_name}</span></div>
                {detail.reviewer_name && (
                  <div><span className="text-slate-500">Reviewer: </span><span className="font-medium">{detail.reviewer_name}</span></div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Status: </span><StatusBadge status={detail.status} />
                </div>
              </div>

              {/* Metadata fields */}
              {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {Object.entries(detail.metadata).map(([k, v]) => (
                    <div key={k}><span className="text-slate-500">{k}: </span><span className="font-medium">{v}</span></div>
                  ))}
                </div>
              )}
            </div>

            {/* Existing dispute info */}
            {detail.dispute && (
              <div className={cn(
                'rounded-lg border p-4 text-sm space-y-2',
                detail.dispute.status === 'OPEN'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-slate-50 border-slate-200',
              )}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Dispute</span>
                  <Badge variant="outline">{detail.dispute.status}</Badge>
                </div>
                <p className="text-slate-700"><span className="text-slate-500">Reason: </span>{detail.dispute.reason}</p>
                {detail.dispute.resolution_action && (
                  <>
                    <p className="text-slate-700"><span className="text-slate-500">Action: </span>{detail.dispute.resolution_action}</p>
                    {detail.dispute.resolution_notes && (
                      <p className="text-slate-700"><span className="text-slate-500">Notes: </span>{detail.dispute.resolution_notes}</p>
                    )}
                    {detail.dispute.new_score != null && (
                      <p className="text-slate-700">
                        <span className="text-slate-500">Adjusted Score: </span>
                        <span className={cn('font-semibold', scoreColor(detail.dispute.new_score))}>
                          {detail.dispute.new_score.toFixed(1)}%
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── CORE SCORING BREAKDOWN ── */}
            <div>
              <h3 className="font-semibold text-slate-800 text-sm mb-3">Score Breakdown by Category</h3>
              <CategoryScoreBreakdown detail={detail} />
            </div>

            {/* Actions */}
            {isCSR && detail.status === 'COMPLETED' && !detail.dispute && (
              <div>
                {!showDisputeForm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-amber-600 border-amber-200 hover:bg-amber-50"
                    onClick={() => setShowDisputeForm(true)}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" /> Dispute This Score
                  </Button>
                ) : (
                  <DisputeForm submissionId={detail.id} onSuccess={handleClose} />
                )}
              </div>
            )}

            {isManager && detail.dispute?.status === 'OPEN' && (
              <div>
                {!showResolveForm ? (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => setShowResolveForm(true)}
                  >
                    Resolve Dispute
                  </Button>
                ) : (
                  <ResolveDisputeForm
                    disputeId={detail.dispute.id}
                    originalScore={detail.score}
                    onSuccess={handleClose}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function SubmissionsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const roleId = user?.role_id ?? 0
  const isAdminOrQA = roleId === 1 || roleId === 2
  const isManager = roleId === 5
  const isCSR = roleId === 3

  const PAGE_SIZE = 20

  // Role-based query
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', roleId, page, search, statusFilter],
    queryFn: () => {
      const params = { page, limit: PAGE_SIZE, search: search || undefined, status: statusFilter || undefined }
      if (isCSR)     return qaService.getCSRAudits(params)
      if (isManager) return qaService.getTeamAudits(params)
      return qaService.getSubmissions(params)
    },
    enabled: !!user,
    placeholderData: prev => prev,
  })

  const openDetail = (id: number) => {
    setSelectedId(id)
    setSheetOpen(true)
  }

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleStatusChange = (v: string) => { setStatusFilter(v); setPage(1) }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isCSR ? 'My Audits' : isManager ? 'Team Audits' : 'Submissions'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data ? `${data.total.toLocaleString()} total` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={isCSR ? 'Search by form...' : 'Search by CSR name, form...'}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="DISPUTED">Disputed</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 flex items-center justify-between bg-red-50">
            <p className="text-red-700 font-medium text-sm">Failed to load submissions.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {!isCSR && <TableHead>CSR</TableHead>}
                {isAdminOrQA && <TableHead>Department</TableHead>}
                <TableHead>Form</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items?.length ? (
                data.items.map(row => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => openDetail(row.id)}
                  >
                    <TableCell className="text-sm">{new Date(row.created_at).toLocaleDateString()}</TableCell>
                    {!isCSR && <TableCell className="font-medium text-sm">{row.csr_name}</TableCell>}
                    {isAdminOrQA && <TableCell className="text-sm">{row.department_name}</TableCell>}
                    <TableCell className="text-sm">{row.form_name}</TableCell>
                    <TableCell className="text-right">
                      <ScoreBadge score={row.score} />
                    </TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell>
                      <Eye className="h-4 w-4 text-slate-400" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={isAdminOrQA ? 7 : isCSR ? 5 : 6} className="text-center py-12 text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No submissions found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <SubmissionDetailSheet
        submissionId={selectedId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        roleId={roleId}
      />
    </div>
  )
}
```

---

**END OF PART 1** — Continue with Part 2 for FormsPage and DisputesPage.
