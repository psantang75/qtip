import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import ProductivityReport from '@/components/insights/agentActivity/ProductivityReport'

/**
 * Productivity (Agent Activity - Sales). Combines phone status, call volume,
 * ticket/task touch volume, and DeskTime activity into a per-agent roster that
 * drills into a per-day activity timeline. Sample data only until the DeskTime
 * API + data layer land (Preview badge shown).
 */
export default function AAProductivityPage() {
  return (
    <ActivityReportShell
      title="Productivity"
      description="Phone, ticket/task touch volume, and DeskTime activity by salesperson."
      hideBusinessDays
    >
      <ProductivityReport agentLabel="Salesperson" />
    </ActivityReportShell>
  )
}
