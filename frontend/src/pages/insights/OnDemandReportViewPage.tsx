import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Layers, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { ListPagination } from '@/components/common/ListPagination'
import { InsightsSection } from '@/components/insights'
import OnDemandFilterBar from '@/components/insights/onDemand/OnDemandFilterBar'
import OnDemandResultsTable from '@/components/insights/onDemand/OnDemandResultsTable'
import OnDemandGroupedResults from '@/components/insights/onDemand/OnDemandGroupedResults'
import {
  EMPTY_STATE, applyDefaults, differsFromBaseline, toFilterParams, type FilterState,
} from '@/components/insights/onDemand/onDemandFilterState'

import {
  getReport,
  runReport,
  downloadReport,
  getFilterOptions,
  type OnDemandDownloadOptions,
  type OnDemandFilterOptions,
  type OnDemandReportColumn,
  type OnDemandReportSummary,
} from '@/services/onDemandReportsService'

const PAGE_SIZE_OPTIONS = [25, 50, 100]
/** Download-in-flight keys for the two whole-report downloads; a group's key is its name. */
const COMPLETE = '__complete__'
const BY_GROUP = '__tabs__'
const NO_OPTIONS: OnDemandFilterOptions = {
  departments: [], forms: [], agents: [], topics: [], statuses: [], campaigns: [], declineReasons: [], currencies: [],
}

/** Button label + fallback filename for the report's download format. */
function downloadLabel(meta?: OnDemandReportSummary | null): string {
  if (meta?.groupBy) return 'Download Complete Report'
  return meta?.downloadFormat === 'txt' ? 'Download Text' : 'Download Excel'
}

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
  const [downloading, setDownloading] = useState<string | null>(null)

  const metaQuery = useQuery({
    queryKey: ['on-demand-reports', 'meta', reportId],
    queryFn: () => getReport(reportId),
    enabled: !!reportId,
  })

  const meta = metaQuery.data
  const supported = useMemo(() => meta?.supportedFilters ?? [], [meta])
  const groupBy = meta?.groupBy ?? null
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

  // Filter dropdown options — refreshed when the date scope (or, for collections
  // reports, the campaign / currency) changes, so the user sees only values that
  // have data for the current selection.
  const optionsQuery = useQuery({
    queryKey: [
      'on-demand-reports', 'options', reportId,
      draft.period, draft.customStart, draft.customEnd, draft.campaign, draft.currency,
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
      const prune = (key: 'departments' | 'forms' | 'agents' | 'topics', valid: string[]) => {
        if (!supported.includes(key) || !d[key].length) return
        const kept = d[key].filter(x => valid.includes(x))
        if (kept.length !== d[key].length) { next[key] = kept; changed = true }
      }
      prune('departments', opts.departments)
      prune('forms', opts.forms)
      prune('agents', opts.agents)
      prune('topics', opts.topics)
      if (supported.includes('declineReason') && d.declineReason && !opts.declineReasons.includes(d.declineReason)) {
        next.declineReason = ''
        changed = true
      }
      return changed ? next : d
    })
  }, [optionsQuery.data, supported])

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
      toast({
        variant: 'destructive',
        title: 'Filter required',
        description: err,
      })
      return
    }
    setPage(1)
    setApplied({ ...draft })
  }

  const handleDownload = async (key: string, options: OnDemandDownloadOptions = {}) => {
    if (!applied) {
      toast(t.msg.insights.runBeforeDownload())
      return
    }
    try {
      setDownloading(key)
      const ext = meta?.downloadFormat ?? 'xlsx'
      await downloadReport(reportId, toFilterParams(applied), `${reportId}.${ext}`, options)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: "Couldn't download report",
        description: getErrorMessage(err, 'Try again.'),
      })
    } finally {
      setDownloading(null)
    }
  }

  const handleReset = () => {
    setDraft(applyDefaults(meta))
    setApplied(null)
  }

  // Reset Filters is only meaningful when something is actually applied or
  // selected — mirrors the disabled state used by `ListFilterBar`. We compare
  // to the defaulted draft so a coaching report whose Status defaults to
  // "Closed" doesn't show the button as active by default.
  const baseline = useMemo(() => applyDefaults(meta), [meta])
  const hasFilters = !!applied || differsFromBaseline(draft, baseline)

  const rows = dataQuery.data?.rows ?? []

  return (
    <div>
      <OnDemandFilterBar
        meta={meta}
        draft={draft}
        setDraft={setDraft}
        opts={optionsQuery.data ?? NO_OPTIONS}
        resultCount={applied && dataQuery.data ? dataQuery.data.total : undefined}
        hasFilters={hasFilters}
        running={dataQuery.isFetching}
        onReset={handleReset}
        onRun={handleRun}
        onBack={() => navigate('/app/insights/on-demand-reports')}
      />

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{meta?.name || 'Report'}</h1>
        </div>

        {/* Downloads live directly above the results — only enabled after a
            successful Run, so they always match what's on screen. Any notice the
            report returned sits beside them, because it qualifies what the
            download will contain. */}
        <div className="flex items-start justify-between gap-4">
          {dataQuery.data?.notice ? (
            <p className="text-[12.5px] text-slate-600">{dataQuery.data.notice}</p>
          ) : <span />}
          <div className="flex shrink-0 gap-2">
            {groupBy && (
              <DownloadButton
                label="Download All Agents"
                busyLabel="Generating…"
                icon={<Layers className="h-3.5 w-3.5 mr-1" />}
                busy={downloading === BY_GROUP}
                disabled={downloading !== null || !applied}
                title={applied ? `One worksheet per ${groupBy.label.toLowerCase()}` : 'Run the report first to download'}
                onClick={() => handleDownload(BY_GROUP, { split: 'tabs' })}
              />
            )}
            <DownloadButton
              label={downloadLabel(meta)}
              busyLabel="Generating…"
              icon={<Download className="h-3.5 w-3.5 mr-1" />}
              busy={downloading === COMPLETE}
              disabled={downloading !== null || !applied}
              title={applied ? downloadLabel(meta) : 'Run the report first to download'}
              onClick={() => handleDownload(COMPLETE)}
            />
          </div>
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
              Couldn't run report. Adjust your filters and try again.
            </div>
          ) : !rows.length ? (
            <div className="py-10 text-center text-sm text-slate-400">
              No rows for the selected filters.
            </div>
          ) : groupBy ? (
            <OnDemandGroupedResults
              columns={columns}
              rows={rows}
              groupBy={groupBy}
              downloadingGroup={downloading}
              onDownloadGroup={group => handleDownload(group, { group })}
            />
          ) : (
            <OnDemandResultsTable columns={columns} rows={rows} />
          )}
        </InsightsSection>

        {/* A grouped report returns every row at once, so it never pages. */}
        {!groupBy && applied && dataQuery.data && dataQuery.data.total > 0 && (
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

interface DownloadButtonProps {
  label: string
  busyLabel: string
  icon: ReactNode
  busy: boolean
  disabled: boolean
  title: string
  onClick: () => void
}

function DownloadButton({ label, busyLabel, icon, busy, disabled, title, onClick }: DownloadButtonProps) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={disabled} className="h-8 text-xs" title={title}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : icon}
      {busy ? busyLabel : label}
    </Button>
  )
}
