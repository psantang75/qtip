import { Loader2 } from 'lucide-react'
import { InsightsFilterBar, QCPageSkeleton, ErrorCard } from '@/components/insights'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { SAMPLE_AGENTS, SAMPLE_BUSINESS_DAYS, SAMPLE_PRIOR_BUSINESS_DAYS, SAMPLE_CURRENT_DATE_RANGE, SAMPLE_PRIOR_DATE_RANGE } from './placeholderData'

type ActivityFilters = ReturnType<typeof useActivityFilters>

/**
 * Shared scaffold for the Agent Activity - Sales report pages. Owns the
 * standard Insights filter bar (Agent + Department + Period/Date Range) and the
 * page header so every report on the section looks and behaves identically —
 * mirroring the QC pages' structure (filter bar → header → stacked
 * InsightsSection blocks).
 *
 * Business Days for the selected range are shown in the filter bar info row so
 * the user always sees the basis for per-day calculations. In Phase 2 this is
 * sourced from the Business Calendar (/app/admin/insights/calendar); for now a
 * sample value is supplied by each page.
 *
 * Phase 1 renders against sample data, so a "Preview" badge is shown until the
 * Phase 2 data layer is wired.
 */

// Placeholder department options for the dropdown until the data layer lands.
const SAMPLE_DEPTS = ['Sales Inbound', 'Sales Outbound']

interface ActivityReportShellProps {
  title: string
  /** Omitted on reports whose title needs no gloss — no empty line is rendered. */
  description?: string
  /** Business days in the selected range — shown as the calculation basis. */
  businessDays?: number
  /** Total business days in the period; when set, current renders "X of Y". */
  businessDaysTotal?: number
  /** Latest date with data (ISO YYYY-MM-DD); shown as "(through ...)" when set. */
  dataThroughDate?: string | null
  /** Business days in the prior comparison range (defaults to the sample value). */
  priorBusinessDays?: number
  /** Selected current period date range (defaults to the sample range). */
  currentDateRange?: { start: string; end: string }
  /** Prior comparison date range (defaults to the sample range). */
  priorDateRange?: { start: string; end: string }
  /**
   * Controlled filter state. When provided (live pages), the shell renders the
   * filter bar against it so the page can query with the same values. When
   * omitted (pages still on sample data), the shell owns its own filter state.
   */
  filters?: ActivityFilters
  /** Real options for the Agent/Department dropdowns (defaults to sample data). */
  availableUsers?: string[]
  availableDepts?: string[]
  /** Optional single-select Campaign filter (Collections), placed after Department. */
  showCampaignFilter?: boolean
  campaign?: string
  onCampaignChange?: (v: string) => void
  availableCampaigns?: readonly string[]
  /** Live data is wired — hides the "Preview · sample data" badge. */
  live?: boolean
  /** Hide the Business-Days info row (reports that don't use a per-day basis). */
  hideBusinessDays?: boolean
  /** Hide the Period/Date-Range selector (snapshot reports have no period). */
  hidePeriod?: boolean
  /** Override the Period dropdown choices (e.g. single-day reports). */
  periodOptions?: readonly string[]
  /** Override the Period field label (e.g. "Campaign Start" on cohort-scoped reports). */
  periodLabel?: string
  /** Render "Custom" as a single date picker instead of a start–end range. */
  singleDayCustom?: boolean
  /** Selectable bounds (ISO) for the Custom picker, for reports with a known data window. */
  customDateMin?: string
  customDateMax?: string
  /** Suppress the "Date Range" info row (single-day reports state the day in the Period selector). */
  hideDateRange?: boolean
  /**
   * First load only — no data has ever arrived for this page, so the body is a
   * skeleton. Pass TanStack's `isPending`, not `isFetching`: with
   * `placeholderData: keepPreviousData` a filter change keeps the last response,
   * and replacing a populated report with a skeleton throws away figures the
   * reader was still using. That case is what `fetching` is for.
   */
  loading?: boolean
  /** A refetch is in flight over data already on screen — shown as an "Updating" pill. */
  fetching?: boolean
  /** Render the retry card instead of the body. Pass TanStack's `isError`. */
  error?: boolean
  onRetry?: () => void
  children: React.ReactNode
}

export default function ActivityReportShell({
  title, description,
  businessDays = SAMPLE_BUSINESS_DAYS,
  businessDaysTotal,
  dataThroughDate,
  priorBusinessDays = SAMPLE_PRIOR_BUSINESS_DAYS,
  currentDateRange = SAMPLE_CURRENT_DATE_RANGE,
  priorDateRange = SAMPLE_PRIOR_DATE_RANGE,
  filters,
  availableUsers = SAMPLE_AGENTS,
  availableDepts = SAMPLE_DEPTS,
  showCampaignFilter = false,
  campaign,
  onCampaignChange,
  availableCampaigns,
  live = false,
  hideBusinessDays = false,
  hidePeriod = false,
  periodOptions,
  periodLabel,
  singleDayCustom = false,
  customDateMin,
  customDateMax,
  hideDateRange = false,
  loading = false,
  fetching = false,
  error = false,
  onRetry,
  children,
}: ActivityReportShellProps) {
  const internal = useActivityFilters()
  const {
    users, setUsers, departments, setDepartments, period, setPeriod,
    customStart, setCustomStart, customEnd, setCustomEnd, resetFilters,
  } = filters ?? internal

  return (
    <div>
      <InsightsFilterBar
        showUserFilter
        selectedUsers={users}
        onUsersChange={setUsers}
        availableUsers={availableUsers}
        selectedDepts={departments}
        onDeptsChange={setDepartments}
        availableDepts={availableDepts}
        showCampaignFilter={showCampaignFilter}
        campaign={campaign}
        onCampaignChange={onCampaignChange}
        availableCampaigns={availableCampaigns}
        period={period}
        onPeriodChange={setPeriod}
        hidePeriod={hidePeriod}
        periodOptions={periodOptions}
        periodLabel={periodLabel}
        singleDayCustom={singleDayCustom}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        customDateMin={customDateMin}
        customDateMax={customDateMax}
        businessDays={hideBusinessDays ? undefined : businessDays}
        businessDaysTotal={hideBusinessDays ? undefined : businessDaysTotal}
        dataThroughDate={hideBusinessDays ? undefined : dataThroughDate}
        priorBusinessDays={hideBusinessDays ? undefined : priorBusinessDays}
        currentDateRange={hideDateRange ? undefined : currentDateRange}
        priorDateRange={hideBusinessDays ? undefined : priorDateRange}
        onReset={resetFilters}
      />

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {fetching && !loading && (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
                <Loader2 size={12} className="animate-spin" />
                Updating
              </span>
            )}
            {!live && (
              <span className="mt-1 inline-flex items-center rounded-full bg-warning/10 text-warning px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
                Preview · sample data
              </span>
            )}
          </div>
        </div>

        {/* Filters and header stay mounted in every state — the reader can always
            re-scope without waiting for the query that is currently in flight. */}
        {error ? <ErrorCard onRetry={onRetry} /> : loading ? <QCPageSkeleton tiles={4} /> : children}
      </div>
    </div>
  )
}
