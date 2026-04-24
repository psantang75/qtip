import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Play, Search } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select'
import { useToast } from '@/hooks/use-toast'
import { ListPagination } from '@/components/common/ListPagination'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { InsightsSection } from '@/components/insights'
import { PERIOD_OPTIONS } from '@/components/insights/InsightsFilterBar'

import {
  getReport,
  runReport,
  downloadReport,
  getFilterOptions,
  type OnDemandReportColumn,
  type OnDemandReportFilterParams,
  type OnDemandReportSummary,
} from '@/services/onDemandReportsService'

const PAGE_SIZE_OPTIONS = [25, 50, 100]
const DEFAULT_PERIOD = 'Current Month'

interface FilterState {
  period: string
  customStart: string
  customEnd: string
  departments: string[]
  forms: string[]
  agents: string[]
  submissionId: string
  topics: string[]
  status: string
  sessionId: string
}

const EMPTY_STATE: FilterState = {
  period: DEFAULT_PERIOD,
  customStart: '',
  customEnd: '',
  departments: [],
  forms: [],
  agents: [],
  submissionId: '',
  topics: [],
  status: '',
  sessionId: '',
}

/** Merge per-report default filter values (e.g. coaching → status=CLOSED) on top of the empty state. */
function applyDefaults(meta?: OnDemandReportSummary | null): FilterState {
  const d = meta?.defaultFilters
  if (!d) return EMPTY_STATE
  return {
    ...EMPTY_STATE,
    departments: d.departments ?? EMPTY_STATE.departments,
    forms: d.forms ?? EMPTY_STATE.forms,
    agents: d.agents ?? EMPTY_STATE.agents,
    submissionId: d.submissionId ?? EMPTY_STATE.submissionId,
    topics: d.topics ?? EMPTY_STATE.topics,
    status: d.status ?? EMPTY_STATE.status,
    sessionId: d.sessionId ?? EMPTY_STATE.sessionId,
  }
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROCESS: 'In Process',
  AWAITING_CSR_ACTION: 'Awaiting CSR Action',
  QUIZ_PENDING: 'Quiz Pending',
  COMPLETED: 'Completed',
  FOLLOW_UP_REQUIRED: 'Follow-Up Required',
  CLOSED: 'Closed',
}

const formatStatusLabel = (s: string): string =>
  STATUS_LABELS[s] || s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())

export default function OnDemandReportViewPage() {
  const { reportId = '' } = useParams<{ reportId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  // Two filter snapshots:
  //   `draft`   — what's currently in the controls (editable)
  //   `applied` — committed by Run; backs the data + download requests so a
  //               user can keep tweaking the form without re-firing queries.
  const [draft, setDraft] = useState<FilterState>(EMPTY_STATE)
  const [applied, setApplied] = useState<FilterState | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [downloading, setDownloading] = useState(false)

  const metaQuery = useQuery({
    queryKey: ['on-demand-reports', 'meta', reportId],
    queryFn: () => getReport(reportId),
    enabled: !!reportId,
  })

  const meta = metaQuery.data
  const supported = meta?.supportedFilters ?? []
  const showDept = supported.includes('departments')
  const showForm = supported.includes('forms')
  const showAgent = supported.includes('agents')
  const showSubmissionId = supported.includes('submissionId')
  const showTopics = supported.includes('topics')
  const showStatus = supported.includes('status')
  const showSessionId = supported.includes('sessionId')
  const isCustom = draft.period === 'Custom'
  const customReady = !isCustom || (!!draft.customStart && !!draft.customEnd)

  // Apply per-report defaults exactly once when the report metadata first
  // loads (e.g. coaching defaults the Status filter to "Closed").
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  useEffect(() => {
    if (!meta || defaultsApplied) return
    setDraft(applyDefaults(meta))
    setDefaultsApplied(true)
  }, [meta, defaultsApplied])

  // Filter dropdown options — refreshed when the date scope changes, so the
  // user sees only depts / forms / agents that have data for the chosen period.
  const optionsQuery = useQuery({
    queryKey: [
      'on-demand-reports', 'options', reportId,
      draft.period, draft.customStart, draft.customEnd,
    ],
    queryFn: () => getFilterOptions(reportId, toFilterParams(draft)),
    enabled: !!reportId && !!meta && customReady,
    placeholderData: prev => prev,
  })

  // Re-run when applied filters or pagination change.
  const dataQuery = useQuery({
    queryKey: [
      'on-demand-reports', 'data', reportId, page, pageSize,
      applied && JSON.stringify(applied),
    ],
    queryFn: () => runReport(reportId, {
      ...toFilterParams(applied!),
      page,
      pageSize,
    }),
    enabled: !!reportId && !!applied,
  })

  const columns: OnDemandReportColumn[] = useMemo(
    () => dataQuery.data?.columns || meta?.columns || [],
    [dataQuery.data, meta],
  )

  const totalPages = useMemo(() => {
    const total = dataQuery.data?.total || 0
    return Math.max(1, Math.ceil(total / pageSize))
  }, [dataQuery.data?.total, pageSize])

  // Drop selections that are no longer present in the latest options list,
  // so a department that has no data in the new period doesn't silently keep
  // narrowing the query.
  useEffect(() => {
    const opts = optionsQuery.data
    if (!opts) return
    setDraft(d => {
      const next: FilterState = { ...d }
      let changed = false
      if (showDept && d.departments.length) {
        const valid = d.departments.filter(x => opts.departments.includes(x))
        if (valid.length !== d.departments.length) { next.departments = valid; changed = true }
      }
      if (showForm && d.forms.length) {
        const valid = d.forms.filter(x => opts.forms.includes(x))
        if (valid.length !== d.forms.length) { next.forms = valid; changed = true }
      }
      if (showAgent && d.agents.length) {
        const valid = d.agents.filter(x => opts.agents.includes(x))
        if (valid.length !== d.agents.length) { next.agents = valid; changed = true }
      }
      if (showTopics && d.topics.length) {
        const valid = d.topics.filter(x => opts.topics.includes(x))
        if (valid.length !== d.topics.length) { next.topics = valid; changed = true }
      }
      return changed ? next : d
    })
  }, [optionsQuery.data, showDept, showForm, showAgent, showTopics])

  const validateDraft = (): string | null => {
    if (!draft.period) return 'Pick a period.'
    if (isCustom) {
      if (!draft.customStart || !draft.customEnd) return 'Pick a custom start and end date.'
      if (draft.customStart > draft.customEnd) return 'Start date must be on or before end date.'
    }
    return null
  }

  const handleRun = () => {
    const err = validateDraft()
    if (err) {
      toast({ title: 'Filter required', description: err, variant: 'destructive' })
      return
    }
    setPage(1)
    setApplied({ ...draft })
  }

  const handleDownload = async () => {
    if (!applied) {
      toast({
        title: 'Run the report first',
        description: 'Apply your filters with Run before downloading.',
        variant: 'destructive',
      })
      return
    }
    try {
      setDownloading(true)
      await downloadReport(reportId, toFilterParams(applied), `${reportId}.xlsx`)
    } catch (err: any) {
      toast({
        title: 'Download failed',
        description: err?.response?.data?.message || err?.message || 'Could not download report.',
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  const handleReset = () => {
    setDraft(applyDefaults(meta))
    setApplied(null)
  }

  const opts = optionsQuery.data ?? { departments: [], forms: [], agents: [], topics: [], statuses: [] }

  // Reset Filters is only meaningful when something is actually applied or
  // selected — mirrors the disabled state used by `ListFilterBar`. We compare
  // to the defaulted draft so a coaching report whose Status defaults to
  // "Closed" doesn't show the button as active by default.
  const baseline = useMemo(() => applyDefaults(meta), [meta])
  const hasFilters = !!(
    applied
    || draft.departments.length !== baseline.departments.length
    || draft.forms.length !== baseline.forms.length
    || draft.agents.length !== baseline.agents.length
    || draft.topics.length !== baseline.topics.length
    || draft.submissionId !== baseline.submissionId
    || draft.sessionId !== baseline.sessionId
    || draft.status !== baseline.status
    || (draft.period && draft.period !== DEFAULT_PERIOD)
    || draft.customStart
    || draft.customEnd
  )

  return (
    <div>
      {/* Sticky filter bar — same shape & styling as `InsightsFilterBar`.
          Row 1: Agent · Department · Form · ... · result count + Reset Filters
          Row 2: Period (+ Custom dates) · Review # · ... · Run + Back */}
      <div className="sticky -top-6 z-40 bg-slate-50 border-b border-slate-200 px-6 py-3 -mx-6 -mt-6 mb-5">

        {/* Row 1 — entity filters + results / reset */}
        <div className="flex flex-wrap items-center gap-3">

          {showAgent && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Agent</span>
              <StagedMultiSelect
                options={opts.agents}
                selected={draft.agents}
                onApply={v => setDraft(d => ({ ...d, agents: v }))}
                placeholder="All Agents"
                width="w-[200px]"
              />
            </div>
          )}

          {showDept && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Department</span>
              <StagedMultiSelect
                options={opts.departments}
                selected={draft.departments}
                onApply={v => setDraft(d => ({ ...d, departments: v }))}
                placeholder="All Departments"
                width="w-[200px]"
              />
            </div>
          )}

          {showForm && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Form</span>
              <StagedMultiSelect
                options={opts.forms}
                selected={draft.forms}
                onApply={v => setDraft(d => ({ ...d, forms: v }))}
                placeholder="All Forms"
                width="w-[230px]"
              />
            </div>
          )}

          {showTopics && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Training Topics</span>
              <StagedMultiSelect
                options={opts.topics}
                selected={draft.topics}
                onApply={v => setDraft(d => ({ ...d, topics: v }))}
                placeholder="All Topics"
                width="w-[200px]"
              />
            </div>
          )}

          {showStatus && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Status</span>
              <Select
                value={draft.status || '__all__'}
                onValueChange={v => setDraft(d => ({ ...d, status: v === '__all__' ? '' : v }))}
              >
                <SelectTrigger className="h-8 text-xs w-[170px] bg-white">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Statuses</SelectItem>
                  {opts.statuses.map(s => (
                    <SelectItem key={s} value={s}>{formatStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            {applied && dataQuery.data && (
              <span className="text-[12px] text-slate-500">
                <span className="font-semibold text-slate-700">
                  {dataQuery.data.total.toLocaleString()}
                </span>{' '}
                results
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/app/insights/on-demand-reports')}
              className="h-8 px-3 text-primary hover:text-primary hover:bg-primary/10"
            >
              <ArrowLeft size={14} className="mr-1" />
              Back to Reports
            </Button>
          </div>
        </div>

        {/* Row 2 — period + review # + Run / Back */}
        <div className="flex flex-wrap items-center gap-3 mt-3">

          {/* Period */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 shrink-0">Period</span>
            <Select
              value={draft.period}
              onValueChange={v => setDraft(d => ({ ...d, period: v }))}
            >
              <SelectTrigger className="h-8 text-xs w-[175px] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom date range */}
          {isCustom && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={draft.customStart}
                onChange={e => setDraft(d => ({ ...d, customStart: e.target.value }))}
                className="h-8 text-xs w-[150px] bg-white"
              />
              <span className="text-xs text-slate-400">to</span>
              <Input
                type="date"
                value={draft.customEnd}
                onChange={e => setDraft(d => ({ ...d, customEnd: e.target.value }))}
                className="h-8 text-xs w-[150px] bg-white"
              />
            </div>
          )}

          {/* Review # */}
          {showSubmissionId && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Review #</span>
              <div className="relative w-[150px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Review #"
                  value={draft.submissionId}
                  onChange={e => setDraft(d => ({ ...d, submissionId: e.target.value.replace(/\D/g, '') }))}
                  className="pl-8 h-8 text-xs bg-white"
                />
              </div>
            </div>
          )}

          {/* Session # (coaching) */}
          {showSessionId && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 shrink-0">Session #</span>
              <div className="relative w-[150px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Session #"
                  value={draft.sessionId}
                  onChange={e => setDraft(d => ({ ...d, sessionId: e.target.value.replace(/\D/g, '') }))}
                  className="pl-8 h-8 text-xs bg-white"
                />
              </div>
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!hasFilters}
              className="h-7 px-2 text-[12px] text-primary hover:text-primary hover:bg-primary/5"
            >
              Reset Filters
            </Button>
            <Button
              size="sm"
              onClick={handleRun}
              disabled={dataQuery.isFetching}
              className="h-8 text-xs"
            >
              {dataQuery.isFetching
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <Play className="h-3.5 w-3.5 mr-1" />}
              Run
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{meta?.name || 'Report'}</h1>
        </div>

        {/* Download lives directly above the results table — only enabled
            after a successful Run, so it always matches what's on screen. */}
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={downloading || !applied}
            className="h-8 text-xs"
            title={applied ? 'Download Excel' : 'Run the report first to download'}
          >
            {downloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <Download className="h-3.5 w-3.5 mr-1" />}
            {downloading ? 'Generating…' : 'Download Excel'}
          </Button>
        </div>

        <InsightsSection title="Results">
          {!applied ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Set your filters and click <span className="font-medium text-slate-600">Run</span> to load this report.
            </div>
          ) : dataQuery.isLoading || (dataQuery.isFetching && !dataQuery.data) ? (
            <div className="flex items-center justify-center py-10 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Running report…
            </div>
          ) : dataQuery.isError ? (
            <div className="py-10 text-center text-sm text-red-600">
              Failed to run the report. Adjust your filters and try again.
            </div>
          ) : !dataQuery.data?.rows?.length ? (
            <div className="py-10 text-center text-sm text-slate-400">
              No rows for the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-200">
                    {columns.map(c => (
                      <th
                        key={c.key}
                        className={`py-2 px-2 font-medium ${alignClass(c.align)}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataQuery.data.rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      {columns.map(c => (
                        <td
                          key={c.key}
                          className={`py-1.5 px-2 text-slate-700 ${alignClass(c.align)}`}
                        >
                          {formatCellValue(row[c.key], c.format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </InsightsSection>

        {applied && dataQuery.data && dataQuery.data.total > 0 && (
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalItems={dataQuery.data.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>
    </div>
  )
}

function toFilterParams(state: FilterState): OnDemandReportFilterParams {
  // Backend normalises e.g. "Current Month" → "current_month".
  return {
    period: state.period,
    customStart: state.period === 'Custom' ? state.customStart : undefined,
    customEnd: state.period === 'Custom' ? state.customEnd : undefined,
    departments: state.departments.length ? state.departments : undefined,
    forms: state.forms.length ? state.forms : undefined,
    agents: state.agents.length ? state.agents : undefined,
    submissionId: state.submissionId || undefined,
    topics: state.topics.length ? state.topics : undefined,
    status: state.status || undefined,
    sessionId: state.sessionId || undefined,
  }
}

function alignClass(align: OnDemandReportColumn['align']): string {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

function formatCellValue(
  value: unknown,
  format: OnDemandReportColumn['format'] | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  if (format === 'percent') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!isFinite(n)) return String(value)
    return `${n.toFixed(2)}%`
  }
  if (format === 'date') {
    if (value instanceof Date) return value.toISOString().split('T')[0]
    return String(value).split('T')[0]
  }
  if (format === 'number' || typeof value === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!isFinite(n)) return String(value)
    return Number.isInteger(n) ? n.toString() : n.toFixed(2)
  }
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value)
}
