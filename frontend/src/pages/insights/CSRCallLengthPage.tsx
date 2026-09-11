/**
 * Insights → Agent Activity - CSR → Call Length.
 *
 * Handle-time distribution for Customer Service, Tech Support and Installs.
 * Call Activity (directly above in the sidebar) answers "how much" — this page
 * answers "how long, and where does the time actually go", which needs call
 * grain: ie_fact_call_activity is a daily roll-up and cannot express a
 * distribution, so this reads ie_fact_support_call.
 *
 * Layout is ordered as the question gets asked: how many calls sit in each
 * length bucket, then where the hours actually go (and how much of that is
 * after-call wrap), then which teams run long, then per-agent detail.
 */
import { useQuery } from '@tanstack/react-query'
import { KpiTile, InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { BandTotalsChart, BandTimeSplit, DeptBandMixChart } from '@/components/insights/callLength/BandDistributionCharts'
import RepBandTable from '@/components/insights/callLength/RepBandTable'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCsrCallLength } from '@/services/insightsCsrService'

const KPI_CODES = [
  'csr_cl_total_calls', 'csr_cl_handle_hours', 'csr_cl_avg_handle',
  'csr_cl_calls_over_10', 'csr_cl_pct_time_long', 'csr_cl_wrap_share',
] as const

export default function CSRCallLengthPage() {
  const filters = useActivityFilters()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['csr-call-length', filters.params],
    queryFn:  () => getCsrCallLength(filters.params),
    // Filter-driven report; the fact also reloads hourly server-side. Don't
    // lean on the global 5-min staleTime, which can serve a pre-change result.
    staleTime: 0,
  })

  const bands      = data?.bands ?? []
  const bandTotals = data?.bandTotals ?? []
  const byDept     = data?.byDept ?? []
  const byRep      = data?.byRep ?? []

  // Every section carries the same freshness stamp — one worker produces the
  // whole page, so a per-section stamp would just repeat itself.
  const freshness = {
    lastUpdated: data?.dataLastUpdated ?? undefined,
    nextUpdate: data?.dataNextUpdate ?? undefined,
    updateEveryMinutes: data?.updateEveryMinutes ?? undefined,
  }

  const empty = !isLoading && !isError && bandTotals.every(b => b.calls === 0)

  /** One place to render the three non-data states shared by every section. */
  const guard = (body: React.ReactNode) =>
    isLoading ? <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
    : isError  ? <p className="text-sm text-danger text-center py-6">Couldn't load call length. Refresh to try again.</p>
    : empty    ? <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
    : body

  return (
    <ActivityReportShell
      title="Call Length"
      description="Handle time (talk + hold + wrap) per call, bucketed by length, for each agent and department."
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      live
      hideBusinessDays
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {KPI_CODES.map(code => (
          <KpiTile key={code} kpiCode={code} value={data?.kpis[code] ?? null} />
        ))}
      </div>

      <InsightsSection
        title="Calls by Length"
        infoKpiCodes={['csr_cl_total_calls', 'csr_cl_pct_time_long']}
        {...freshness}
      >
        {guard(<BandTotalsChart bandTotals={bandTotals} />)}
      </InsightsSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection
          title="Where the Handle Time Goes"
          className="mb-0"
          infoKpiCodes={['csr_cl_handle_hours', 'csr_cl_pct_time_long']}
          {...freshness}
        >
          {guard(<BandTimeSplit bandTotals={bandTotals} />)}
        </InsightsSection>

        <InsightsSection
          title="Length Mix by Department"
          className="mb-0"
          infoKpiCodes={['csr_cl_avg_handle']}
          {...freshness}
        >
          {guard(<DeptBandMixChart byDept={byDept} bands={bands} />)}
        </InsightsSection>
      </div>

      <InsightsSection
        title="Call Length by Agent"
        infoKpiCodes={['csr_cl_avg_handle', 'csr_cl_wrap_share']}
        {...freshness}
      >
        {guard(<RepBandTable byRep={byRep} bands={bands} />)}
      </InsightsSection>
    </ActivityReportShell>
  )
}
