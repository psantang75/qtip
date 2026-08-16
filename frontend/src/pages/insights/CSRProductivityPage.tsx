import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import ProductivityReport from '@/components/insights/agentActivity/ProductivityReport'

/**
 * Productivity (CSR Agent Activity). Combines phone status, call volume,
 * ticket/task touch volume, and DeskTime activity into a per-agent roster that
 * drills into a per-day activity timeline. Sample data only until the DeskTime
 * API + data layer land (Preview badge shown).
 */
export default function CSRProductivityPage() {
  return (
    <ActivityReportShell
      title="Productivity"
      description="Phone, ticket/task touch volume, and DeskTime activity by agent."
      hideBusinessDays
    >
      <ProductivityReport agentLabel="Agent" />
    </ActivityReportShell>
  )
}
