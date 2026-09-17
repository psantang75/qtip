/**
 * Admin → Insights Engine → Missed Opportunities.
 *
 * Engine settings for the Missed Opportunities report: the rule set the nightly
 * model applies, the run thresholds / cost caps, and a manual re-grade. These
 * are engine controls, so they live here rather than on the reporting page
 * (guardrail: .cursor/rules/insights-report-page.mdc). Admin-only via the
 * /app/admin route guard; every write is re-checked server-side.
 */
import { Lightbulb } from 'lucide-react'
import MissedOpportunitySettingsTab from '@/components/insights/missedOpportunities/SettingsTab'

export default function InsightsMissedOpportunitiesSettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h1 className="text-[18px] font-semibold text-slate-900">Missed Opportunities</h1>
        </div>
        <p className="mt-1 text-[13px] text-slate-600">
          The rule set the nightly sales-call review applies, the thresholds that decide which calls
          are graded, and a manual re-grade. Rule changes affect future runs; use Re-grade to apply
          them to a past day.
        </p>
      </div>
      <MissedOpportunitySettingsTab />
    </div>
  )
}
