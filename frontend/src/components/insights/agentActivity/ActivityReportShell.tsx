import { InsightsFilterBar } from '@/components/insights'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { SAMPLE_AGENTS, SAMPLE_BUSINESS_DAYS, SAMPLE_PRIOR_BUSINESS_DAYS, SAMPLE_PRIOR_DATE_RANGE } from './placeholderData'

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
  /** Business days in the prior comparison range (defaults to the sample value). */
  priorBusinessDays?: number
  /** Prior comparison date range (defaults to the sample range). */
  priorDateRange?: { start: string; end: string }
  children: React.ReactNode
}

export default function ActivityReportShell({
  title, description,
  businessDays = SAMPLE_BUSINESS_DAYS,
  priorBusinessDays = SAMPLE_PRIOR_BUSINESS_DAYS,
  priorDateRange = SAMPLE_PRIOR_DATE_RANGE,
  children,
}: ActivityReportShellProps) {
  const {
    users, setUsers, departments, setDepartments, period, setPeriod,
    customStart, setCustomStart, customEnd, setCustomEnd, resetFilters,
  } = useActivityFilters()

  return (
    <div>
      <InsightsFilterBar
        showUserFilter
        selectedUsers={users}
        onUsersChange={setUsers}
        availableUsers={SAMPLE_AGENTS}
        selectedDepts={departments}
        onDeptsChange={setDepartments}
        availableDepts={SAMPLE_DEPTS}
        period={period}
        onPeriodChange={setPeriod}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        businessDays={businessDays}
        priorBusinessDays={priorBusinessDays}
        priorDateRange={priorDateRange}
        onReset={resetFilters}
      />

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          </div>
          <span className="shrink-0 mt-1 inline-flex items-center rounded-full bg-warning/10 text-warning px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
            Preview · sample data
          </span>
        </div>

        {children}
      </div>
    </div>
  )
}
