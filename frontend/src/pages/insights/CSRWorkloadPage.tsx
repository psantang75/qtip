import { useQuery } from '@tanstack/react-query'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import TicketProductivityTable from '@/components/insights/agentActivity/TicketProductivityTable'
import TicketsTasksTrend from '@/components/insights/agentActivity/TicketsTasksTrend'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCsrTicketProductivity, getCsrTicketsDailyHistory, getCsrTicketsTasks } from '@/services/insightsCsrService'

export default function CSRWorkloadPage() {
  const filters = useActivityFilters()

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['csr-workload', filters.params.period, filters.params.start, filters.params.end, filters.params.users, filters.params.departments],
    queryFn:  () => getCsrTicketProductivity(filters.params),
    staleTime: 0,
  })

  // Dropdown options come from the Tickets & Tasks snapshot endpoint, which
  // returns the full section population regardless of the selected user/dept
  // filters — so the filter never collapses to just the current selection.
  const { data: snapshot } = useQuery({
    queryKey: ['csr-tickets-tasks', filters.params.users, filters.params.departments],
    queryFn:  () => getCsrTicketsTasks(filters.params),
    staleTime: 0,
  })

  return (
    <ActivityReportShell
      title="Ticket and Task Workload"
      description="Ticket & task workload and productivity by agent: beginning, new assigned, touched, and closed by day."
      filters={filters}
      availableUsers={snapshot?.availableUsers ?? []}
      availableDepts={snapshot?.availableDepartments ?? []}
      live
      hideBusinessDays
    >
      <InsightsSection title="Daily Trend (8am Snapshot)">
        <TicketsTasksTrend
          queryKey="csr-tickets-daily-history"
          fetchHistory={getCsrTicketsDailyHistory}
          params={filters.params}
        />
      </InsightsSection>

      <InsightsSection title="Workload by Agent">
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load workload. Refresh to try again.</p>
        ) : (
          <TicketProductivityTable rows={rows ?? []} agentLabel="Agent" />
        )}
      </InsightsSection>
    </ActivityReportShell>
  )
}
