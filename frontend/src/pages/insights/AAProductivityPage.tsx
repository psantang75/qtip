import ProductivityReportPage from '@/components/insights/agentActivity/ProductivityReportPage'

/**
 * Productivity (Agent Activity - Sales). Combines phone status, call handling,
 * and ticket/task touch volume into a per-agent roster that drills into a per-day
 * activity timeline. Day-scoped from the filter bar; read live from the punch
 * clock, Genesys and the CRM.
 */
export default function AAProductivityPage() {
  return (
    <ProductivityReportPage
      title="Productivity"
      description="Phone status, call handling, and ticket/task touch volume by salesperson."
      agentLabel="Salesperson"
      storageKey="aa-productivity-filters"
      area="sales"
    />
  )
}
