import ProductivityReportPage from '@/components/insights/agentActivity/ProductivityReportPage'

/**
 * Productivity (CSR Agent Activity). Combines phone status, call handling, and
 * ticket/task touch volume into a per-agent roster that drills into a per-day
 * activity timeline. Day-scoped from the filter bar; read live from the punch
 * clock, Genesys and the CRM.
 */
export default function CSRProductivityPage() {
  return (
    <ProductivityReportPage
      title="Productivity"
      description="Phone status, call handling, and ticket/task touch volume by agent."
      agentLabel="Agent"
      storageKey="csr-productivity-filters"
      area="csr"
    />
  )
}
