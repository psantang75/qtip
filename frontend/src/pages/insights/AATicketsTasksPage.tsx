import { Fragment } from 'react'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { ticketGroups, DATA_LAST_UPDATED } from '@/components/insights/agentActivity/placeholderData'

// Zero counts render as an em dash, matching the source report.
const dash = (v: number) => (v === 0 ? '—' : fmtNum(v))

export default function AATicketsTasksPage() {
  return (
    <ActivityReportShell
      title="Tickets & Tasks"
      description="Open tickets and tasks by agent and classification."
    >
      <InsightsSection title="Tickets and Tasks by Agent" lastUpdated={DATA_LAST_UPDATED}>
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-medium pr-4 w-[22%]">Salesperson</th>
              <th className="text-left pb-2 font-medium pr-4 w-[28%]">Classification</th>
              <th className="text-left pb-2 font-medium pr-4 w-[16.66%]">Current</th>
              <th className="text-left pb-2 font-medium pr-4 w-[16.66%]">Due Today</th>
              <th className="text-left pb-2 font-medium w-[16.66%]">Past Due</th>
            </tr>
          </thead>
          <tbody>
            {ticketGroups.map(group => (
              <Fragment key={group.agent}>
                {group.rows.map((r, i) => (
                  <tr key={`${r.agent}-${r.classification}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{r.classification}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{dash(r.current)}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{dash(r.dueToday)}</td>
                    <td className="py-2.5 text-slate-600">{dash(r.pastDue)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                  <td className="py-2.5 pr-4" colSpan={2}>Total - {group.agent}</td>
                  <td className="py-2.5 pr-4">{dash(group.total.current)}</td>
                  <td className="py-2.5 pr-4">{dash(group.total.dueToday)}</td>
                  <td className="py-2.5">{dash(group.total.pastDue)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </InsightsSection>
    </ActivityReportShell>
  )
}
