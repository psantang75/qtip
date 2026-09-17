import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { InsightsSection, CAMPAIGN_START_OPTIONS } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { fmtMoney } from '@/components/insights/collections/cycleFormat'
import { CycleOutcomeCards } from '@/components/insights/collections/RunOutcomePanels'
import { TaskCoverageCards, TouchBandPanel, ProcessorCards } from '@/components/insights/collections/TaskActivityPanels'
import { RecoveryPathPanel } from '@/components/insights/collections/RecoveryPanels'
import { CurrencyPicker } from '@/components/insights/collections/CurrencyPicker'
import { DependencyFreshnessNote } from '@/components/insights/collections/DependencyFreshness'
import { collectionsQueryOptions } from '@/components/insights/collections/collectionsQuery'
import { useCollectionsScope, useDeclinedCampaigns } from '@/components/insights/collections/useCollectionsScope'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCyclePerformance } from '@/services/collectionsService'
import type { CycleReason, CycleTaskStatus } from '@/types/collections'

export default function CollectionsCyclePerformancePage() {
  const filters = useActivityFilters('collections-filters')
  const { campaign, setCampaign, currency, setCurrency } = useCollectionsScope()

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['insights', 'collections', 'cycle', campaign, currency, filters.params],
    queryFn: () => getCyclePerformance(filters.params, campaign, currency),
    refetchInterval: query => (query.state.data?.pipelineLoading ? 10_000 : false),
    ...collectionsQueryOptions,
  })

  const campaignOptions = useDeclinedCampaigns(data?.campaigns)

  /** Everything on this page is denominated in the selected currency — see the service. */
  const money = useCallback((v: number) => fmtMoney(v, currency), [currency])

  /**
   * "$X · N" for the money-and-count columns, or the bare count when there is no
   * amount behind it — Still Open reports zero for the invoices whose payment rows
   * are missing from the extract, and "$0.00 · 33" would read as a real zero.
   */
  const pair = useCallback(
    (amount: number, invoices: number) =>
      invoices === 0 ? '—' : amount > 0 ? `${money(amount)} · ${fmtNum(invoices)}` : fmtNum(invoices),
    [money],
  )

  const reasonColumns = useMemo<ColumnDef<CycleReason, unknown>[]>(() => [
    { accessorKey: 'reason', header: 'Decline Reason', meta: { width: 'w-[32%]' } },
    {
      accessorKey: 'invoices', header: 'Invoices', meta: { width: 'w-[13%]' },
      cell: c => fmtNum(c.getValue<number>()),
    },
    {
      accessorKey: 'amount', header: 'Amount', meta: { width: 'w-[17%]', bold: true },
      cell: c => money(c.getValue<number>()),
    },
    {
      accessorKey: 'repeatInvoices', header: 'Repeat Issues', meta: { width: 'w-[19%]' },
      cell: c => {
        const r = c.row.original
        if (r.repeatInvoices === 0) return '—'
        const pct = r.invoices > 0 ? Math.round((r.repeatInvoices / r.invoices) * 100) : 0
        return `${fmtNum(r.repeatInvoices)} · ${pct}%`
      },
    },
    {
      accessorKey: 'repeatAmount', header: 'Repeat Amount', meta: { width: 'w-[19%]', bold: true },
      cell: c => (c.getValue<number>() > 0 ? money(c.getValue<number>()) : '—'),
    },
  ], [money])

  const statusColumns = useMemo<ColumnDef<CycleTaskStatus, unknown>[]>(() => [
    { accessorKey: 'status', header: 'Task Ended As', meta: { width: 'w-[22%]' } },
    {
      accessorKey: 'invoices', header: 'Invoices', meta: { width: 'w-[9%]' },
      cell: c => fmtNum(c.getValue<number>()),
    },
    {
      accessorKey: 'amount', header: 'Declined', meta: { width: 'w-[12%]' },
      cell: c => money(c.getValue<number>()),
    },
    {
      accessorKey: 'collected', header: 'Collected', meta: { width: 'w-[15%]', bold: true },
      cell: c => {
        const r = c.row.original
        const pct = r.amount > 0 ? Math.round((r.collected / r.amount) * 100) : 0
        return `${money(r.collected)} · ${pct}%`
      },
    },
    {
      accessorKey: 'selfCollected', header: 'Self-Service', meta: { width: 'w-[13%]' },
      cell: c => pair(c.row.original.selfCollected, c.row.original.selfInvoices),
    },
    {
      accessorKey: 'agentCollected', header: 'Agent', meta: { width: 'w-[13%]' },
      cell: c => pair(c.row.original.agentCollected, c.row.original.agentInvoices),
    },
    {
      // No cash from anyone, but a credit memo closed it out. Nearly all of what
      // this table used to report as one unexplained "No Cash" figure.
      accessorKey: 'memoAmount', header: 'Credit Memo', meta: { width: 'w-[13%]' },
      cell: c => pair(c.row.original.memoAmount, c.row.original.memoInvoices),
    },
    {
      // No cash and no memo. Sorted on the count, not the amount, because the
      // open balance reads zero for the invoices missing their payment rows.
      accessorKey: 'openInvoices', header: 'Still Open', meta: { width: 'w-[13%]' },
      cell: c => pair(c.row.original.openAmount, c.row.original.openInvoices),
    },
  ], [money, pair])

  const declineReasons = useMemo(() => data?.declineReasons ?? [], [data?.declineReasons])
  const taskStatuses = useMemo(() => data?.taskStatuses ?? [], [data?.taskStatuses])
  const memos = data?.creditMemos
  const collectedToDate = useMemo(() => {
    const paths = data?.recoveryPaths ?? []
    return {
      amount: paths.reduce((a, p) => a + p.collected, 0),
      invoices: paths.reduce((a, p) => a + (p.collected > 0 ? p.invoices : 0), 0),
    }
  }, [data?.recoveryPaths])

  /** Ties row for row to the touch-band Total, which covers the same population. */
  const statusTotalRow = useMemo(() => {
    const sum = (k: keyof CycleTaskStatus) =>
      taskStatuses.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    const amount = sum('amount')
    const collected = sum('collected')
    const pct = amount > 0 ? Math.round((collected / amount) * 100) : 0
    return {
      // Names the population: this is short of the Declined on the Run card by the
      // declines that never reached a task, which the No Task Created card carries.
      status: 'Total — declines with a task',
      invoices: fmtNum(sum('invoices')),
      amount: money(amount),
      collected: `${money(collected)} · ${pct}%`,
      selfCollected: pair(sum('selfCollected'), sum('selfInvoices')),
      agentCollected: pair(sum('agentCollected'), sum('agentInvoices')),
      memoAmount: pair(sum('memoAmount'), sum('memoInvoices')),
      openInvoices: pair(sum('openAmount'), sum('openInvoices')),
    }
  }, [taskStatuses, money, pair])

  const reasonTotalRow = useMemo(() => {
    const sum = (k: keyof CycleReason) =>
      declineReasons.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    const invoices = sum('invoices')
    const repeatInvoices = sum('repeatInvoices')
    const repeatAmount = sum('repeatAmount')
    const pct = invoices > 0 ? Math.round((repeatInvoices / invoices) * 100) : 0
    return {
      reason: `Total: ${declineReasons.length} ${declineReasons.length === 1 ? 'reason' : 'reasons'}`,
      invoices: fmtNum(invoices),
      amount: money(sum('amount')),
      repeatInvoices: repeatInvoices > 0 ? `${fmtNum(repeatInvoices)} · ${pct}%` : '—',
      repeatAmount: repeatAmount > 0 ? money(repeatAmount) : '—',
    }
  }, [declineReasons, money])

  return (
    <ActivityReportShell
      title="Cycle Performance"
      description="The recurring billing run, counted by invoice and walked end to end."
      live
      filters={filters}
      availableUsers={[]}
      availableDepts={[]}
      showCampaignFilter
      campaign={campaign}
      onCampaignChange={setCampaign}
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
        onChange={setCurrency}
      />

      <DependencyFreshnessNote
        items={data?.freshness ?? []}
        loading={data?.pipelineLoading ?? false}
      />

      <InsightsSection
        title="Invoice and Gateway Response Summary"
        description="Every invoice the recurring run produced, split by the gateway response."
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <CycleOutcomeCards
          invoiced={data?.invoiced ?? { invoices: 0, amount: 0 }}
          outcomes={data?.outcomes ?? []}
        />
      </InsightsSection>

      {declineReasons.length > 0 && (
        <InsightsSection
          title="Failed or Declined Charge Summary"
          description="Why the charges failed, counted by invoice. A repeat is the same billing group declining again within a year."
        >
          <SortableTable
            columns={reasonColumns}
            data={declineReasons}
            initialSorting={[{ id: 'amount', desc: true }]}
            totalRow={reasonTotalRow}
            minWidth="min-w-[720px]"
          />
        </InsightsSection>
      )}

      <InsightsSection
        title="Collections Activity Summary"
        description="How the declines were picked up, who collected, and how much outreach it took."
      >
        <TaskCoverageCards
          coverage={data?.coverage ?? []}
          collected={collectedToDate.amount}
          collectedInvoices={collectedToDate.invoices}
          writtenOff={memos?.declined ?? { invoices: 0, amount: 0 }}
          outstanding={data?.outstanding ?? { invoices: 0, amount: 0 }}
        />
        <div className="mt-3">
          <ProcessorCards processors={data?.processors ?? []} />
        </div>
        {taskStatuses.length > 0 && (
          <div className="mt-3">
            <SortableTable
              columns={statusColumns}
              data={taskStatuses}
              initialSorting={[{ id: 'invoices', desc: true }]}
              totalRow={statusTotalRow}
              minWidth="min-w-[960px]"
            />
          </div>
        )}
        <div className="mt-3">
          <TouchBandPanel bands={data?.touchBands ?? []} />
        </div>
      </InsightsSection>

      <InsightsSection
        title="Recovery Summary"
        description="Which card paid the invoice, and how much cash came back against it."
      >
        <RecoveryPathPanel paths={data?.recoveryPaths ?? []} />
      </InsightsSection>
    </ActivityReportShell>
  )
}
