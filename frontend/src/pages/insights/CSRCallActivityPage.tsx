import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KpiTile, InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import DualAxisTrendChart from '@/components/insights/agentActivity/DualAxisTrendChart'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCsrCallActivity } from '@/services/insightsCsrService'

// Combined Call Count + Call Time summary, surfaced as the KPI card row.
const KPI_CODES = [
  'aa_business_days', 'aa_total_calls', 'aa_total_talk_minutes',
  'aa_avg_calls_per_day', 'aa_avg_min_per_day', 'aa_avg_handle_time',
] as const

export default function CSRCallActivityPage() {
  const filters = useActivityFilters()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['csr-call-activity', filters.params],
    queryFn:  () => getCsrCallActivity(filters.params),
    // Filter-driven report; data also refreshes server-side hourly. Don't lean
    // on the global 5-min staleTime, which can serve a pre-change cached list.
    staleTime: 0,
  })

  const summary      = data?.summary ?? []
  const summaryTotal = data?.summaryTotal
  const byDay        = data?.byDay ?? []

  // With a single agent in scope the per-agent average equals the total, so the
  // green "Avg / Agent" line and its right axis are redundant — drop them.
  const showAvgPerAgent = summary.length > 1

  return (
    <ActivityReportShell
      title="Call Activity"
      description="Inbound and outbound call volume and talk time by agent."
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection title="Total Calls vs Avg Calls per Period" className="mb-0" infoKpiCodes={['aa_total_calls', 'aa_avg_calls_per_day']} lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
          <DualAxisTrendChart
            data={data?.dailyCalls ?? []}
            leftName="Total Calls"
            rightName="Avg Calls / Agent"
            showRight={showAvgPerAgent}
          />
        </InsightsSection>

        <InsightsSection title="Total Min vs Avg Min per Period" className="mb-0" infoKpiCodes={['aa_total_talk_minutes', 'aa_avg_min_per_day']} lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
          <DualAxisTrendChart
            data={data?.dailyMinutes ?? []}
            leftName="Total Min"
            rightName="Avg Min / Agent"
            showRight={showAvgPerAgent}
          />
        </InsightsSection>
      </div>

      <InsightsSection title="Call Activity Summary" lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load call activity. Refresh to try again.</p>
        ) : summary.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left  pb-2 font-medium pr-4 w-[18%]">Agent</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10%]">Business Days</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Total Calls</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Avg Calls/Day</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Total Min</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Avg Min/Day</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Avg Min/Call</th>
                <th className="text-right pb-2 font-medium w-[12%]">Calls ≥ 3 Min</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(r => (
                <tr key={r.agent} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.businessDays)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.totalCalls)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.avgCallsPerDay)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.totalMin)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.avgMinPerDay)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{r.avgMinPerCall.toFixed(1)}</td>
                  <td className="py-2.5 text-right text-slate-600">{fmtNum(r.callsOver3Min)}</td>
                </tr>
              ))}
              {summaryTotal && (
                <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                  <td className="py-2.5 pr-4">{summaryTotal.agent}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(summaryTotal.businessDays)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(summaryTotal.totalCalls)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(summaryTotal.avgCallsPerDay)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(summaryTotal.totalMin)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(summaryTotal.avgMinPerDay)}</td>
                  <td className="py-2.5 pr-4 text-right">{summaryTotal.avgMinPerCall.toFixed(1)}</td>
                  <td className="py-2.5 text-right">{fmtNum(summaryTotal.callsOver3Min)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </InsightsSection>

      <InsightsSection title="Call Activity by Day" lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : byDay.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left  pb-2 font-medium pr-4 w-[16%]">Agent</th>
                <th className="text-left  pb-2 font-medium pr-4 w-[9%]">Date</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Inbound Calls</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Outbound Calls</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Total Calls</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Inbound Min</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Outbound Min</th>
                <th className="text-right pb-2 font-medium pr-4 w-[10.7%]">Total Min</th>
                <th className="text-right pb-2 font-medium w-[10.7%]">Calls ≥ 3 Min</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map(group => (
                <Fragment key={group.agent}>
                  {group.rows.map((r, i) => (
                    <tr key={`${r.agent}-${r.date}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{r.date}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.inbound)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.outbound)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.total)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.inboundMin)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.outboundMin)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.totalMin)}</td>
                      <td className="py-2.5 text-right text-slate-600">{fmtNum(r.callsOver3Min)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                    <td className="py-2.5 pr-4" colSpan={2}>Total - {group.agent}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.inbound)}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.outbound)}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.total)}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.inboundMin)}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.outboundMin)}</td>
                    <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.totalMin)}</td>
                    <td className="py-2.5 text-right">{fmtNum(group.total.callsOver3Min)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </InsightsSection>
    </ActivityReportShell>
  )
}
