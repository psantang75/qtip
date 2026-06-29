import { InsightsFilterBar } from '@/components/insights'
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
  description: string
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
  /** Live data is wired — hides the "Preview · sample data" badge. */
  live?: boolean
  /** Hide the Business-Days info row (reports that don't use a per-day basis). */
  hideBusinessDays?: boolean
  /** Hide the Period/Date-Range selector (snapshot reports have no period). */
  hidePeriod?: boolean
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
  live = false,
  hideBusinessDays = false,
  hidePeriod = false,
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
        period={period}
        onPeriodChange={setPeriod}
        hidePeriod={hidePeriod}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        businessDays={hideBusinessDays ? undefined : businessDays}
        businessDaysTotal={hideBusinessDays ? undefined : businessDaysTotal}
        dataThroughDate={hideBusinessDays ? undefined : dataThroughDate}
        priorBusinessDays={hideBusinessDays ? undefined : priorBusinessDays}
        currentDateRange={hideBusinessDays ? undefined : currentDateRange}
        priorDateRange={hideBusinessDays ? undefined : priorDateRange}
        onReset={resetFilters}
      />

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          </div>
          {!live && (
            <span className="shrink-0 mt-1 inline-flex items-center rounded-full bg-warning/10 text-warning px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
              Preview · sample data
            </span>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}
