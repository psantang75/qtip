import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getTicketsTasks } from '@/services/insightsService'

// Zero counts render as an em dash, matching the source report.
const dash = (v: number) => (v === 0 ? '—' : fmtNum(v))

export default function AATicketsTasksPage() {
  const filters = useActivityFilters()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['aa-tickets-tasks', filters.params.users, filters.params.departments],
    queryFn:  () => getTicketsTasks(filters.params),
    // Filter-driven snapshot; refreshes server-side every 2h. Don't lean on the
    // global 5-min staleTime, which can serve a pre-change cached list.
    staleTime: 0,
  })

  const groups = data?.groups ?? []
  const grand  = data?.grandTotal

  return (
    <ActivityReportShell
      title="Tickets & Tasks"
      description="Open tickets and tasks by agent and classification."
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      live
      hideBusinessDays
      hidePeriod
    >
      <InsightsSection title="Tickets and Tasks by Agent" lastUpdated={data?.dataLastUpdated ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-danger text-center py-6">Failed to load tickets &amp; tasks.</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left  pb-2 font-medium pr-4 w-[20%]">Salesperson</th>
                <th className="text-left  pb-2 font-medium pr-4 w-[18%]">Department</th>
                <th className="text-left  pb-2 font-medium pr-4 w-[26%]">Classification</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Current</th>
                <th className="text-right pb-2 font-medium pr-4 w-[12%]">Due Today</th>
                <th className="text-right pb-2 font-medium w-[12%]">Past Due</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <Fragment key={group.agent}>
                  {group.rows.map((r, i) => (
                    <tr key={`${r.agent}-${r.classification}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{r.department}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{r.classification}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{dash(r.current)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{dash(r.dueToday)}</td>
                      <td className="py-2.5 text-right text-slate-600">{dash(r.pastDue)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                    <td className="py-2.5 pr-4" colSpan={3}>Total - {group.agent}</td>
                    <td className="py-2.5 pr-4 text-right">{dash(group.total.current)}</td>
                    <td className="py-2.5 pr-4 text-right">{dash(group.total.dueToday)}</td>
                    <td className="py-2.5 text-right">{dash(group.total.pastDue)}</td>
                  </tr>
                </Fragment>
              ))}
              {grand && (
                <tr className="border-b-2 border-slate-300 font-bold text-slate-900">
                  <td className="py-2.5 pr-4" colSpan={3}>Grand Total</td>
                  <td className="py-2.5 pr-4 text-right">{dash(grand.current)}</td>
                  <td className="py-2.5 pr-4 text-right">{dash(grand.dueToday)}</td>
                  <td className="py-2.5 text-right">{dash(grand.pastDue)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </InsightsSection>
    </ActivityReportShell>
  )
}
