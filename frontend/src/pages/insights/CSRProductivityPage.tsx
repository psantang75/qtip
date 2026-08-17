import ProductivityReportPage from '@/components/insights/agentActivity/ProductivityReportPage'

/**
 * Productivity (CSR Agent Activity). Combines phone status, call volume,
 * ticket/task touch volume, and DeskTime activity into a per-agent roster that
 * drills into a per-day activity timeline. Day-scoped from the filter bar.
 * Sample data only until the DeskTime API + data layer land (Preview badge shown).
 */
export default function CSRProductivityPage() {
  return (
    <ProductivityReportPage
      title="Productivity"
      description="Phone, ticket/task touch volume, and DeskTime activity by agent."
      agentLabel="Agent"
      storageKey="csr-productivity-filters"
    />
  )
}
