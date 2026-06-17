import { Fragment } from 'react'
import { InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { fmtNum } from '@/components/insights/agentActivity/format'
import {
  emailSummaryRows, emailSummaryTotal, emailByDayGroups, DATA_LAST_UPDATED,
} from '@/components/insights/agentActivity/placeholderData'

export default function AAEmailActivityPage() {
  return (
    <ActivityReportShell
      title="Email Activity"
      description="Total emails sent by agent."
    >
      <InsightsSection title="Email Activity Summary" lastUpdated={DATA_LAST_UPDATED}>
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-medium pr-4 w-1/2">User</th>
              <th className="text-left pb-2 font-medium w-1/2">Total Sent Emails</th>
            </tr>
          </thead>
          <tbody>
            {emailSummaryRows.map(r => (
              <tr key={r.agent} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                <td className="py-2.5 text-slate-600">{fmtNum(r.totalSent)}</td>
              </tr>
            ))}
            <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
              <td className="py-2.5 pr-4">{emailSummaryTotal.agent}</td>
              <td className="py-2.5">{fmtNum(emailSummaryTotal.totalSent)}</td>
            </tr>
          </tbody>
        </table>
      </InsightsSection>

      <InsightsSection title="Email Activity Detail" lastUpdated={DATA_LAST_UPDATED}>
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-medium pr-4 w-1/3">User</th>
              <th className="text-left pb-2 font-medium pr-4 w-1/3">Date</th>
              <th className="text-left pb-2 font-medium w-1/3">Total Sent Emails</th>
            </tr>
          </thead>
          <tbody>
            {emailByDayGroups.map(group => (
              <Fragment key={group.agent}>
                {group.rows.map((r, i) => (
                  <tr key={`${r.agent}-${r.date}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{r.date}</td>
                    <td className="py-2.5 text-slate-600">{fmtNum(r.totalSent)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                  <td className="py-2.5 pr-4" colSpan={2}>Total - {group.agent}</td>
                  <td className="py-2.5">{fmtNum(group.total.totalSent)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </InsightsSection>
    </ActivityReportShell>
  )
}
