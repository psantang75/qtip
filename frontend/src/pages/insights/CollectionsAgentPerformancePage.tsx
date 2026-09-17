import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { InsightsSection, CAMPAIGN_START_OPTIONS } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { fmtUSD, fmtNum } from '@/components/insights/agentActivity/format'
import { SplitPanel, StartingPoint } from '@/components/insights/collections/DeclinedBasisPanels'
import { collectionsQueryOptions } from '@/components/insights/collections/collectionsQuery'
import { useCollectionsScope, useDeclinedCampaigns } from '@/components/insights/collections/useCollectionsScope'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getAgentPerformance } from '@/services/collectionsService'
import type { AgentPerformanceRow, ProcessorRow } from '@/types/collections'

/**
 * Insights → Collections → Agent Performance.
 *
 * Reads top-down as one argument about one set of invoices: what the run declined, then
 * whether getting it back took an agent, then who produced against it. Every section is
 * measured against the same declined basis Cycle Performance reports, so the figures
 * reconcile across the pages rather than each page defining its own month.
 */

/**
 * PENDING — CALL LINKAGE. Calls are tied to a task today only when the caller ID resolves
 * to exactly one customer, which covers roughly two thirds of a collector's calls. Work to
 * link calls to tickets and tasks directly is planned; until it lands, anything that counts
 * or characterises a call understates effort by an unknown margin.
 *
 * So both call-dependent views are hidden rather than deleted, and flipping this one
 * constant restores them:
 *   • "Who Processed It" — its inbound/outbound columns are read off the call fact.
 *   • The leaderboard's call, talk-time and $/talk-hour columns.
 *
 * The service still computes both, so nothing needs rewiring when the flag flips. What is
 * left visible is the part that reconciles: money, tasks and touches against the invoices.
 */
// Annotated `boolean` rather than left to infer `false`, so the parked branches stay
// reachable to the compiler and keep being type-checked while they are switched off.
const CALL_LINKAGE_CONFIRMED: boolean = false
export default function CollectionsAgentPerformancePage() {
  const filters = useActivityFilters('collections-filters')
  const { campaign, setCampaign, currency } = useCollectionsScope()

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['insights', 'collections', 'agents', campaign, currency, filters.params],
    queryFn: () => getAgentPerformance(filters.params, campaign, currency),
    ...collectionsQueryOptions,
  })

  const campaignOptions = useDeclinedCampaigns(data?.campaigns)
  const cohort = data?.cohort
  const rows = useMemo(() => data?.rows ?? [], [data])
  const processors = useMemo(() => data?.processors ?? [], [data])

  const processorColumns = useMemo<ColumnDef<ProcessorRow, unknown>[]>(() => [
    {
      accessorKey: 'processor', header: 'Processed by', meta: { width: 'w-[26%]' },
      cell: c => (
        <span className={c.row.original.isAgent ? 'text-slate-700' : 'text-slate-500 italic'}>
          {c.getValue<string>()}
        </span>
      ),
    },
    {
      accessorKey: 'collected', header: 'Collected', meta: { width: 'w-[14%]', bold: true },
      cell: c => fmtUSD(c.getValue<number>()),
    },
    { accessorKey: 'payments', header: 'Payments', meta: { width: 'w-[10%]' }, cell: c => fmtNum(c.getValue<number>()) },
    {
      accessorKey: 'outboundPayments', header: 'On outbound', meta: { width: 'w-[17%]' },
      cell: c => {
        const r = c.row.original
        return r.outboundPayments ? `${fmtNum(r.outboundPayments)} · ${fmtUSD(r.outboundCollected)}` : '—'
      },
    },
    {
      accessorKey: 'inboundPayments', header: 'On inbound', meta: { width: 'w-[17%]' },
      cell: c => {
        const r = c.row.original
        return r.inboundPayments ? `${fmtNum(r.inboundPayments)} · ${fmtUSD(r.inboundCollected)}` : '—'
      },
    },
    {
      accessorKey: 'noCallPayments', header: 'No call', meta: { width: 'w-[16%]' },
      cell: c => fmtNum(c.getValue<number>()),
    },
  ], [])

  /**
   * The four measures the page stands behind, all drawn from the cycle's invoices: what
   * the agent took in, how many payments that was, and how much of the cycle's work they
   * did chasing it.
   */
  const agentColumns = useMemo<ColumnDef<AgentPerformanceRow, unknown>[]>(() => [
    { accessorKey: 'agent', header: 'Agent', meta: { width: 'w-[26%]' } },
    { accessorKey: 'department', header: 'Department', meta: { width: 'w-[22%]' } },
    {
      accessorKey: 'collected', header: 'Collected', meta: { width: 'w-[17%]', bold: true },
      cell: c => fmtUSD(c.getValue<number>()),
    },
    { accessorKey: 'payments', header: 'Payments', meta: { width: 'w-[13%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'tasksWorked', header: 'Tasks', meta: { width: 'w-[10%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'touches', header: 'Touches', meta: { width: 'w-[12%]' }, cell: c => fmtNum(c.getValue<number>()) },
    // Dials and talk time together: the count is the attempt, the minutes are what was
    // answered, and the gap between them is the story. Hidden until calls link cleanly.
    ...(CALL_LINKAGE_CONFIRMED ? [
      {
        accessorKey: 'outboundCalls', header: 'Outbound', meta: { width: 'w-[11%]' },
        cell: c => {
          const r = c.row.original
          return r.outboundCalls ? `${fmtNum(r.outboundCalls)} · ${fmtNum(r.outboundTalkMinutes)}m` : '—'
        },
      },
      {
        accessorKey: 'inboundCalls', header: 'Inbound', meta: { width: 'w-[11%]' },
        cell: c => {
          const r = c.row.original
          return r.inboundCalls ? `${fmtNum(r.inboundCalls)} · ${fmtNum(r.inboundTalkMinutes)}m` : '—'
        },
      },
      { accessorKey: 'talkMinutes', header: 'Talk Min', meta: { width: 'w-[8%]' }, cell: c => fmtNum(c.getValue<number>()) },
      {
        accessorKey: 'dollarsPerTalkHour', header: '$ / Talk Hr', meta: { width: 'w-[10%]' },
        cell: c => (c.getValue<number>() ? fmtUSD(c.getValue<number>()) : '—'),
      },
    ] satisfies ColumnDef<AgentPerformanceRow, unknown>[] : []),
  ], [])

  const totalRow = useMemo(() => {
    const sum = (k: keyof AgentPerformanceRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    const collected = sum('collected')
    const mins = sum('talkMinutes')
    return {
      agent: `Total: ${rows.length} agents`,
      collected: fmtUSD(collected),
      payments: fmtNum(sum('payments')),
      tasksWorked: fmtNum(sum('tasksWorked')),
      touches: fmtNum(sum('touches')),
      ...(CALL_LINKAGE_CONFIRMED ? {
        outboundCalls: `${fmtNum(sum('outboundCalls'))} · ${fmtNum(sum('outboundTalkMinutes'))}m`,
        inboundCalls: `${fmtNum(sum('inboundCalls'))} · ${fmtNum(sum('inboundTalkMinutes'))}m`,
        talkMinutes: fmtNum(mins),
        dollarsPerTalkHour: mins ? fmtUSD(collected / (mins / 60)) : '—',
      } : {}),
    } as Record<string, ReactNode>
  }, [rows])

  return (
    <ActivityReportShell
      title="Agent Performance"
      description="Who recovered the cycle's declines — and how much of it needed an agent at all."
      live
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
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
      {cohort && (
        <InsightsSection
          title="Cycle Starting Point"
          description="The cycle's declines, followed to the end of their cadence even into the next month."
          lastUpdated={data?.dataLastUpdated}
          nextUpdate={data?.dataNextUpdate}
          updateEveryMinutes={data?.updateEveryMinutes}
        >
          <StartingPoint
            c={cohort}
            unattributedLabel="the recovery fact names no processor for it"
          />
          {/*
            Stated rather than assumed. The page has no currency picker of its own — the
            selection is the Collections section's, set on Cycle Performance — so without
            this line a reader has no way to know a currency was filtered out at all.
          */}
          <p className="mt-3 text-[12px] text-slate-500">
            Every dollar figure on this page is in {data?.currency ?? 'USD'}, measured against
            the recurring run's own invoices — the same population Cycle Performance reports.
            Amounts are never converted or combined.
          </p>
        </InsightsSection>
      )}

      <InsightsSection
        title="Did It Take an Agent?"
        description="Cash that came back on its own after the decline, against cash that followed at least one agent attempt."
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <SplitPanel
          split={data?.split ?? EMPTY_SPLIT}
          recoveryRate={cohort?.dollarRate ?? null}
        />
      </InsightsSection>

      {CALL_LINKAGE_CONFIRMED && (
        <InsightsSection
          title="Who Processed It — and On What Kind of Call"
          description="Who keyed the payment, and whether they were on an inbound or an outbound call when they did. The portal self-service bucket is listed once, never as an agent's production."
          lastUpdated={data?.dataLastUpdated}
          nextUpdate={data?.dataNextUpdate}
          updateEveryMinutes={data?.updateEveryMinutes}
        >
          <SortableTable
            columns={processorColumns}
            data={processors}
            initialSorting={[{ id: 'collected', desc: true }]}
            minWidth="min-w-[820px]"
          />
        </InsightsSection>
      )}

      <InsightsSection
        title="Collector Leaderboard"
        description="Production against the same invoices. Agents who worked the cycle's tasks appear even where they keyed no cash, so effort without a close is visible rather than absent."
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <SortableTable
          columns={agentColumns}
          data={rows}
          initialSorting={[{ id: 'collected', desc: true }]}
          totalRow={totalRow}
          minWidth={CALL_LINKAGE_CONFIRMED ? 'min-w-[980px]' : 'min-w-[640px]'}
        />
        {/*
          What the board covers and what it deliberately does not, so nobody reads the
          absence of call columns as an absence of phone work.
        */}
        <p className="mt-3 text-[12px] text-slate-500">
          Every figure here is measured against the cycle's declined invoices: cash keyed
          on them, and the tasks and touches chasing them. Call and talk-time columns are
          withheld until calls link to tickets and tasks directly — today a call only
          attaches when its caller ID resolves to a single customer, which would understate
          phone effort without showing that it had.
        </p>
      </InsightsSection>
    </ActivityReportShell>
  )
}

const EMPTY_LEG = { payments: 0, accounts: 0, amount: 0 }
const EMPTY_SPLIT = { preAgent: EMPTY_LEG, postAgent: EMPTY_LEG }
