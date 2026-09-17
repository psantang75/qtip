import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection, CAMPAIGN_START_OPTIONS } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { CurrencyPicker } from '@/components/insights/collections/CurrencyPicker'
import { DependencyFreshnessNote } from '@/components/insights/collections/DependencyFreshness'
import { CycleInvoiceGrid, type InvoiceFilter } from '@/components/insights/collections/CycleInvoiceGrid'
import { INVOICE_PAGE_SIZE } from '@/components/insights/collections/cycleLabels'
import { collectionsQueryOptions } from '@/components/insights/collections/collectionsQuery'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { useCollectionsScope, useDeclinedCampaigns } from '@/components/insights/collections/useCollectionsScope'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getFailedChargeInvoices } from '@/services/collectionsService'

const ALL_REASONS = ''

export default function CollectionsFailedChargeInvoicesPage() {
  const filters = useActivityFilters('collections-filters')
  const { campaign, setCampaign, currency, setCurrency } = useCollectionsScope()
  const [reason, setReason] = useState(ALL_REASONS)
  const [page, setPage] = useState(0)

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: [
      'insights', 'collections', 'failed-charge-invoices',
      campaign, reason, currency, page, filters.params,
    ],
    queryFn: () => getFailedChargeInvoices(
      filters.params, campaign, reason || undefined,
      { limit: INVOICE_PAGE_SIZE, offset: page * INVOICE_PAGE_SIZE }, currency,
    ),
    refetchInterval: query => (query.state.data?.pipelineLoading ? 10_000 : false),
    ...collectionsQueryOptions,
  })

  const campaignOptions = useDeclinedCampaigns(data?.campaigns)
  const total = data?.total ?? 0
  const pageCount = Math.max(Math.ceil(total / INVOICE_PAGE_SIZE), 1)
  const reframe = (fn: () => void) => { fn(); setPage(0) }

  // "All Reasons" leads so the page opens on the whole declined population; each reason
  // then carries its own invoice count, the same figure the Cycle Performance breakdown
  // shows, so the button and the rows it opens can never disagree.
  const reasonFilters = useMemo<InvoiceFilter[]>(() => [
    { value: ALL_REASONS, label: 'All Reasons' },
    ...(data?.declineReasons ?? []).map(r => ({
      value: r.reason,
      label: `${r.reason} (${fmtNum(r.invoices)})`,
    })),
  ], [data?.declineReasons])

  return (
    <ActivityReportShell
      title="Failed Charge Invoices"
      description="Every declined invoice on the selected run, sliced by why the charge failed. Pick a decline reason, then open the invoice number in CRM to work any row."
      live
      filters={filters}
      availableUsers={[]}
      availableDepts={[]}
      showCampaignFilter
      campaign={campaign}
      onCampaignChange={(c: string) => reframe(() => setCampaign(c))}
      availableCampaigns={campaignOptions}
      periodOptions={CAMPAIGN_START_OPTIONS}
      periodLabel="Billing Cycle"
      hideBusinessDays
      loading={isPending}
      fetching={isFetching}
      error={isError}
      onRetry={refetch}
    >
      <CurrencyPicker
        selected={currency}
        totals={data?.currencies ?? []}
        onChange={(c) => reframe(() => setCurrency(c))}
      />

      <DependencyFreshnessNote
        items={data?.freshness ?? []}
        loading={data?.pipelineLoading ?? false}
      />

      <InsightsSection
        title="The Declines"
        description="One row per declined invoice. Use the buttons to filter to a single decline reason."
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <p className="mb-3 text-[12.5px]">
          <Link
            to="/app/insights/collections-cycle-invoices"
            className="font-medium text-primary hover:underline"
          >
            See all invoice outcomes
          </Link>
        </p>
        <CycleInvoiceGrid
          rows={data?.rows ?? []}
          filters={reasonFilters}
          selected={reason}
          onSelect={(r) => reframe(() => setReason(r))}
          page={page}
          pageCount={pageCount}
          total={total}
          onPage={setPage}
        />
      </InsightsSection>
    </ActivityReportShell>
  )
}
