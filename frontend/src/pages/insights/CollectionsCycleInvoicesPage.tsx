import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection, CAMPAIGN_START_OPTIONS } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { CurrencyPicker } from '@/components/insights/collections/CurrencyPicker'
import { DependencyFreshnessNote } from '@/components/insights/collections/DependencyFreshness'
import { CycleInvoiceGrid } from '@/components/insights/collections/CycleInvoiceGrid'
import { INVOICE_PAGE_SIZE, GRID_FILTERS, RESULT_LABEL } from '@/components/insights/collections/cycleLabels'
import { collectionsQueryOptions } from '@/components/insights/collections/collectionsQuery'
import { useCollectionsScope, useDeclinedCampaigns } from '@/components/insights/collections/useCollectionsScope'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCycleInvoices } from '@/services/collectionsService'

export default function CollectionsCycleInvoicesPage() {
  const filters = useActivityFilters('collections-filters')
  const { campaign, setCampaign, currency, setCurrency } = useCollectionsScope()
  const [gridResult, setGridResult] = useState('DECLINED')
  const [page, setPage] = useState(0)

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: [
      'insights', 'collections', 'cycle-invoices',
      campaign, gridResult, currency, page, filters.params,
    ],
    queryFn: () => getCycleInvoices(
      filters.params, campaign, gridResult,
      { limit: INVOICE_PAGE_SIZE, offset: page * INVOICE_PAGE_SIZE }, currency,
    ),
    refetchInterval: query => (query.state.data?.pipelineLoading ? 10_000 : false),
    ...collectionsQueryOptions,
  })

  const campaignOptions = useDeclinedCampaigns(data?.campaigns)
  const total = data?.total ?? 0
  const pageCount = Math.max(Math.ceil(total / INVOICE_PAGE_SIZE), 1)
  const reframe = (fn: () => void) => { fn(); setPage(0) }

  return (
    <ActivityReportShell
      title="Cycle Invoices"
      description="The invoice list behind Cycle Performance. Sort it, then open the invoice number in CRM to check any row by hand."
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
        title="The Invoices"
        description="One row per invoice on the selected run. Still Outstanding is the declined invoices that still have a balance due."
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <CycleInvoiceGrid
          rows={data?.rows ?? []}
          filters={GRID_FILTERS.map((r) => ({ value: r, label: RESULT_LABEL[r] }))}
          selected={gridResult}
          onSelect={(r) => reframe(() => setGridResult(r))}
          page={page}
          pageCount={pageCount}
          total={total}
          onPage={setPage}
        />
      </InsightsSection>
    </ActivityReportShell>
  )
}
