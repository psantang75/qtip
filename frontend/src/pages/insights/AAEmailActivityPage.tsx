import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getEmailActivity } from '@/services/insightsService'

export default function AAEmailActivityPage() {
  const filters = useActivityFilters()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['aa-email-activity', filters.params],
    queryFn:  () => getEmailActivity(filters.params),
    // Filter-driven report; data also refreshes server-side hourly. Don't lean
    // on the global 5-min staleTime, which can serve a pre-change cached list.
    staleTime: 0,
  })

  const summary      = data?.summary ?? []
  const summaryTotal = data?.summaryTotal ?? { agent: 'Total', department: '', totalSent: 0 }
  const byDay        = data?.byDay ?? []

  return (
    <ActivityReportShell
      title="Sales - All"
      description="Total emails sent by agent."
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      live
      hideBusinessDays
    >
      <InsightsSection title="Sales - All Summary" lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-danger text-center py-6">Failed to load email activity.</p>
        ) : summary.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left pb-2 font-medium pr-4 w-1/3">User</th>
                <th className="text-left pb-2 font-medium pr-4 w-1/3">Department</th>
                <th className="text-left pb-2 font-medium w-1/3">Total Sent Emails</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(r => (
                <tr key={r.agent} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{r.department}</td>
                  <td className="py-2.5 text-slate-600">{fmtNum(r.totalSent)}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                <td className="py-2.5 pr-4" colSpan={2}>{summaryTotal.agent}</td>
                <td className="py-2.5">{fmtNum(summaryTotal.totalSent)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </InsightsSection>

      <InsightsSection title="Sales - All Detail" lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : byDay.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left pb-2 font-medium pr-4 w-1/4">User</th>
                <th className="text-left pb-2 font-medium pr-4 w-1/4">Department</th>
                <th className="text-left pb-2 font-medium pr-4 w-1/4">Date</th>
                <th className="text-left pb-2 font-medium w-1/4">Total Sent Emails</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map(group => (
                <Fragment key={group.agent}>
                  {group.rows.map((r, i) => (
                    <tr key={`${r.agent}-${r.date}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{group.department}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{r.date}</td>
                      <td className="py-2.5 text-slate-600">{fmtNum(r.totalSent)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                    <td className="py-2.5 pr-4" colSpan={3}>Total - {group.agent}</td>
                    <td className="py-2.5">{fmtNum(group.total.totalSent)}</td>
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
