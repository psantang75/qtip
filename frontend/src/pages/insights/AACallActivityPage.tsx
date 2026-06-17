import { Fragment } from 'react'
import { KpiTile, InsightsSection } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import DualAxisTrendChart from '@/components/insights/agentActivity/DualAxisTrendChart'
import { fmtNum } from '@/components/insights/agentActivity/format'
import {
  callBusinessDays, callKpis, callDailyCalls, callDailyMinutes, callSummaryRows, callSummaryTotal, callByDayGroups,
  DATA_LAST_UPDATED,
} from '@/components/insights/agentActivity/placeholderData'

// Combined Call Count + Call Time summary, surfaced as the KPI card row.
const KPI_CODES = [
  'aa_business_days', 'aa_total_calls', 'aa_total_talk_minutes',
  'aa_avg_calls_per_day', 'aa_avg_min_per_day', 'aa_avg_handle_time',
] as const

export default function AACallActivityPage() {
  return (
    <ActivityReportShell
      title="Call Activity"
      description="Inbound and outbound call volume and talk time by agent."
      businessDays={callBusinessDays}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {KPI_CODES.map(code => (
          <KpiTile key={code} kpiCode={code} value={callKpis[code] ?? null} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection title="Total Calls vs Avg Calls per Period" className="mb-0" infoKpiCodes={['aa_total_calls', 'aa_avg_calls_per_day']} lastUpdated={DATA_LAST_UPDATED}>
          <DualAxisTrendChart
            data={callDailyCalls}
            leftName="Total Calls"
            rightName="Avg Calls / Agent"
          />
        </InsightsSection>

        <InsightsSection title="Total Min vs Avg Min per Period" className="mb-0" infoKpiCodes={['aa_total_talk_minutes', 'aa_avg_min_per_day']} lastUpdated={DATA_LAST_UPDATED}>
          <DualAxisTrendChart
            data={callDailyMinutes}
            leftName="Total Min"
            rightName="Avg Min / Agent"
          />
        </InsightsSection>
      </div>

      <InsightsSection title="Call Activity Summary" lastUpdated={DATA_LAST_UPDATED}>
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left  pb-2 font-medium pr-4 w-[18%]">Agent</th>
              <th className="text-right pb-2 font-medium pr-4 w-[10%]">Business Days</th>
              <th className="text-right pb-2 font-medium pr-4 w-[14.4%]">Total Calls</th>
              <th className="text-right pb-2 font-medium pr-4 w-[14.4%]">Avg Calls/Day</th>
              <th className="text-right pb-2 font-medium pr-4 w-[14.4%]">Total Min</th>
              <th className="text-right pb-2 font-medium pr-4 w-[14.4%]">Avg Min/Day</th>
              <th className="text-right pb-2 font-medium w-[14.4%]">Avg Min/Call</th>
            </tr>
          </thead>
          <tbody>
            {callSummaryRows.map(r => (
              <tr key={r.agent} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.businessDays)}</td>
                <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.totalCalls)}</td>
                <td className="py-2.5 pr-4 text-right text-slate-600">{r.avgCallsPerDay.toFixed(1)}</td>
                <td className="py-2.5 pr-4 text-right text-slate-600">{fmtNum(r.totalMin)}</td>
                <td className="py-2.5 pr-4 text-right text-slate-600">{r.avgMinPerDay.toFixed(1)}</td>
                <td className="py-2.5 text-right text-slate-600">{r.avgMinPerCall.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
              <td className="py-2.5 pr-4">{callSummaryTotal.agent}</td>
              <td className="py-2.5 pr-4 text-right">{fmtNum(callSummaryTotal.businessDays)}</td>
              <td className="py-2.5 pr-4 text-right">{fmtNum(callSummaryTotal.totalCalls)}</td>
              <td className="py-2.5 pr-4 text-right">{callSummaryTotal.avgCallsPerDay.toFixed(1)}</td>
              <td className="py-2.5 pr-4 text-right">{fmtNum(callSummaryTotal.totalMin)}</td>
              <td className="py-2.5 pr-4 text-right">{callSummaryTotal.avgMinPerDay.toFixed(1)}</td>
              <td className="py-2.5 text-right">{callSummaryTotal.avgMinPerCall.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </InsightsSection>

      <InsightsSection title="Call Activity by Day" lastUpdated={DATA_LAST_UPDATED}>
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left  pb-2 font-medium pr-4 w-[18%]">Agent</th>
              <th className="text-left  pb-2 font-medium pr-4 w-[10%]">Date</th>
              <th className="text-right pb-2 font-medium pr-4 w-[12%]">Inbound Calls</th>
              <th className="text-right pb-2 font-medium pr-4 w-[12%]">Outbound Calls</th>
              <th className="text-right pb-2 font-medium pr-4 w-[12%]">Total Calls</th>
              <th className="text-right pb-2 font-medium pr-4 w-[12%]">Inbound Min</th>
              <th className="text-right pb-2 font-medium pr-4 w-[12%]">Outbound Min</th>
              <th className="text-right pb-2 font-medium w-[12%]">Total Min</th>
            </tr>
          </thead>
          <tbody>
            {callByDayGroups.map(group => (
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
                    <td className="py-2.5 text-right text-slate-600">{fmtNum(r.totalMin)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                  <td className="py-2.5 pr-4" colSpan={2}>Total - {group.agent}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.inbound)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.outbound)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.total)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.inboundMin)}</td>
                  <td className="py-2.5 pr-4 text-right">{fmtNum(group.total.outboundMin)}</td>
                  <td className="py-2.5 text-right">{fmtNum(group.total.totalMin)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </InsightsSection>
    </ActivityReportShell>
  )
}
