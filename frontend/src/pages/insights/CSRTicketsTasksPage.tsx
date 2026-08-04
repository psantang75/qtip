import { useQuery } from '@tanstack/react-query'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import TicketsTasksTable from '@/components/insights/agentActivity/TicketsTasksTable'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCsrTicketsPastDue, getCsrTicketsTasks } from '@/services/insightsCsrService'

export default function CSRTicketsTasksPage() {
  const filters = useActivityFilters()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['csr-tickets-tasks', filters.params.users, filters.params.departments],
    queryFn:  () => getCsrTicketsTasks(filters.params),
    // Filter-driven snapshot; refreshes server-side every 2h. Don't lean on the
    // global 5-min staleTime, which can serve a pre-change cached list.
    staleTime: 0,
  })

  const groups = data?.groups ?? []

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
      <InsightsSection title="Tickets and Tasks by Agent" lastUpdated={data?.dataLastUpdated ?? undefined} nextUpdate={data?.dataNextUpdate ?? undefined} updateEveryMinutes={data?.updateEveryMinutes ?? undefined}>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load tickets and tasks. Refresh to try again.</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No data for the selected filters.</p>
        ) : (
          <TicketsTasksTable
            groups={groups}
            grandTotal={data?.grandTotal}
            agentLabel="Agent"
            fetchPastDue={getCsrTicketsPastDue}
            pastDueQueryKey="csr-tickets-past-due"
          />
        )}
      </InsightsSection>
    </ActivityReportShell>
  )
}
