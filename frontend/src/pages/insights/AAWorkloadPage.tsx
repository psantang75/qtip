import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import TicketProductivityTable from '@/components/insights/agentActivity/TicketProductivityTable'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getTicketProductivity, getTicketsTasks } from '@/services/insightsService'

export default function AAWorkloadPage() {
  const filters = useActivityFilters()

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['aa-workload', filters.params.period, filters.params.start, filters.params.end, filters.params.users, filters.params.departments],
    queryFn:  () => getTicketProductivity(filters.params),
    staleTime: 0,
  })

  // Sales rows carry a segment: Contact Manager is a large standing pool of
  // future-dated contact tasks that would otherwise swamp the real workload, so
  // it gets its own section separate from all other tickets & tasks.
  const cmRows    = useMemo(() => (rows ?? []).filter(r => r.segment === 'contact_manager'), [rows])
  const otherRows = useMemo(() => (rows ?? []).filter(r => r.segment !== 'contact_manager'), [rows])

  // Dropdown options come from the Tickets & Tasks snapshot endpoint, which
  // returns the full section population regardless of the selected user/dept
  // filters — so the filter never collapses to just the current selection.
  const { data: snapshot } = useQuery({
    queryKey: ['aa-tickets-tasks', filters.params.users, filters.params.departments],
    queryFn:  () => getTicketsTasks(filters.params),
    staleTime: 0,
  })

  return (
    <ActivityReportShell
      title="Ticket and Task Workload"
      description="Ticket & task workload and productivity by salesperson: beginning, new assigned, touched, and closed by day."
      filters={filters}
      availableUsers={snapshot?.availableUsers ?? []}
      availableDepts={snapshot?.availableDepartments ?? []}
      live
      hideBusinessDays
    >
      {/* No Daily Trend here: it reads the segment-less 8am bucket
          (ie_ticket_task_daily), so it can't be split into Contact Manager vs
          other. The CSR Workload page keeps its trend. */}
      {isLoading ? (
        <InsightsSection title="Workload by Agent">
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        </InsightsSection>
      ) : isError ? (
        <InsightsSection title="Workload by Agent">
          <p className="text-sm text-danger text-center py-6">Couldn't load workload. Refresh to try again.</p>
        </InsightsSection>
      ) : (
        <>
          <InsightsSection title="Contact Manager">
            <TicketProductivityTable rows={cmRows} agentLabel="Salesperson" area="sales" segment="contact_manager" />
          </InsightsSection>
          <InsightsSection title="All Other Tickets & Tasks">
            <TicketProductivityTable rows={otherRows} agentLabel="Salesperson" area="sales" segment="other" />
          </InsightsSection>
        </>
      )}
    </ActivityReportShell>
  )
}
