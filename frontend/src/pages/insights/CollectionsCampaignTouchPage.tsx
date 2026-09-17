import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Cell, LabelList,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { InsightsSection, ExpandableRow, CAMPAIGN_START_OPTIONS } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { fmtUSD, fmtNum } from '@/components/insights/agentActivity/format'
import {
  SubscriptionOutcomes, TouchDetail, PostMemoPanel, TouchChartTooltip,
} from '@/components/insights/collections/CampaignTouchPanels'
import { StartingPoint } from '@/components/insights/collections/DeclinedBasisPanels'
import { collectionsQueryOptions } from '@/components/insights/collections/collectionsQuery'
import { useCollectionsScope } from '@/components/insights/collections/useCollectionsScope'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getCampaignTouch } from '@/services/collectionsService'
import type { TouchStat } from '@/types/collections'

// Shared column template so the header row and each touch row stay aligned.
const COLS = 'grid grid-cols-[minmax(120px,1.3fr)_1fr_1fr_1fr_1fr_1.2fr] gap-2 items-center'

/**
 * A charted rung. `subs` widens to null so the leading No Touch bar can leave the
 * subscription line undrawn there rather than dragging it down to zero through a
 * rung that logged no effort.
 */
type ChartRung = Omit<TouchStat, 'subs'> & { subs: number | null }

export default function CollectionsCampaignTouchPage() {
  const filters = useActivityFilters('collections-filters')
  const { campaign, setCampaign, currency } = useCollectionsScope()
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['insights', 'collections', 'campaign-touch', campaign, currency, filters.params],
    queryFn: () => getCampaignTouch(filters.params, campaign, currency),
    ...collectionsQueryOptions,
  })

  // Memoized because `chartData` depends on it: a fresh [] each render would rebuild
  // the chart series on every paint.
  const touches = useMemo(() => data?.touches ?? [], [data?.touches])
  const cohort = data?.cohort

  /**
   * The chart opens on the cash that arrived before any numbered touch — the same
   * baseline the service seeds the cumulative curve with, so the bars a reader adds
   * up close on the cohort total and on Cycle Performance's Collected to Date.
   *
   * It is a bar rather than a footnote because it is routinely the largest single
   * block of recovery on the page: 2026-09 Declined CC (16th) took 58 of its 73
   * payments that way, $5,843 of $7,797, and with the ladder alone on the chart the
   * campaign read as having recovered $1,954 at 5.4% instead of 21.4%.
   */
  const chartData = useMemo<ChartRung[]>(() => {
    const rungs: ChartRung[] = touches.map(t => ({ ...t }))
    const nt = cohort?.noTouch
    if (!nt || nt.payments === 0) return rungs
    const atRisk = cohort?.atRisk ?? 0
    const baseline: ChartRung = {
      touchSeq: 0,
      label: 'No Touch',
      accountsReached: 0,
      tasksReached: 0,
      subs: nt.subsRecovered,
      touchesMade: 0,
      calls: 0,
      talkMinutes: 0,
      payments: nt.payments,
      incrementalDollars: nt.dollars,
      agentDollars: nt.agentDollars,
      noAgentDollars: nt.noAgentDollars,
      cumulativeDollars: nt.dollars,
      reactivationDollars: nt.reactivationDollars,
      reactivationInvoices: nt.reactivationInvoices,
      reactivationSubs: nt.reactivationSubs,
      cumulativeReactivationDollars: nt.reactivationDollars,
      cumulativeReactivationRate: atRisk > 0
        ? +((nt.reactivationDollars / atRisk) * 100).toFixed(1)
        : 0,
      tasksRecovered: nt.tasksRecovered,
      cumulativeTasksRecovered: nt.tasksRecovered,
      cumulativeRate: atRisk > 0 ? +((nt.dollars / atRisk) * 100).toFixed(1) : 0,
      incrementalRate: atRisk > 0 ? +((nt.dollars / atRisk) * 100).toFixed(1) : 0,
      cumulativeTaskRate: 0,
      benchmarkCumulative: 0,
      isTerm: false,
      agents: [],
    }
    return [baseline, ...rungs]
  }, [touches, cohort])

  return (
    <ActivityReportShell
      title="Campaign × Touch"
      description="What each touch recovered against the declines the cycle handed the campaign."
      live
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      showCampaignFilter
      campaign={campaign}
      onCampaignChange={setCampaign}
      availableCampaigns={data?.campaigns ?? ['All Declined']}
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
          title="Campaign Starting Point"
          description="The cycle's declines, followed to the end of their cadence even into the next month."
          lastUpdated={data?.dataLastUpdated}
          nextUpdate={data?.dataNextUpdate}
          updateEveryMinutes={data?.updateEveryMinutes}
        >
          <StartingPoint
            c={cohort}
            unattributedLabel="no touch precedes it in the recovery fact"
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
        title="Marginal Recovery by Touch"
        description="What each additional touch added, and the cumulative share of the declined dollars it reached."
        infoKpiCodes={['col_recovery_rate', 'col_first_touch_success']}
        lastUpdated={data?.dataLastUpdated}
        nextUpdate={data?.dataNextUpdate}
        updateEveryMinutes={data?.updateEveryMinutes}
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 20, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={48} />
            <YAxis yAxisId="rate" tick={{ fontSize: 10, fill: '#00aeef' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
            <YAxis yAxisId="usd" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
            {/* Subs are counts in the hundreds against dollars in the tens of thousands —
                on a shared axis the line flatlines, so it gets its own hidden scale. */}
            <YAxis yAxisId="subs" hide />
            {/* Custom card: reactivated subs and win-back dollars are too small to plot
                against saves, so the default plotted-series list could never show them. */}
            <Tooltip content={<TouchChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {/*
              TWO STACKED SEGMENTS, BECAUSE THEY ARE TWO OUTCOMES. The lower block is a
              SAVE — cash on the invoice that declined, which is what Cycle Performance
              counts as Collected to Date. The upper block is a WIN-BACK: that invoice was
              written off and the money arrived on a replacement one, so the service was
              lost first and bought back after. Stacking shows the rung's full result
              while keeping the save figure readable on its own, which is the number that
              has to reconcile against the validated report.
            */}
            <Bar yAxisId="usd" stackId="usd" dataKey="incrementalDollars" name="Saved $">
              {/* Slate for the baseline: it is recovery, but it is not a rung. Ordinary
                  rungs are brand primary lightened by opacity rather than a hand-picked
                  pastel, so the bars stay on the palette and read as one family with the
                  save-rate line drawn in the same colour. */}
              {chartData.map((t, i) => (
                <Cell
                  key={i}
                  fill={t.touchSeq === 0 ? '#cbd5e1' : t.isTerm ? '#e74c3c' : '#00aeef'}
                  fillOpacity={t.touchSeq === 0 || t.isTerm ? 1 : 0.35}
                />
              ))}
              <LabelList
                dataKey="incrementalDollars" position="top"
                formatter={(v: number) => (v > 0 ? fmtUSD(v) : '')}
                style={{ fontSize: 9, fill: '#64748b' }}
              />
            </Bar>
            <Bar yAxisId="usd" stackId="usd" dataKey="reactivationDollars" name="Reactivated $" fill="#1abc9c" radius={[2, 2, 0, 0]} />
            <Line yAxisId="rate" type="monotone" dataKey="cumulativeRate" name="Cumulative Save Rate" stroke="#00aeef" strokeWidth={2} dot={{ r: 3 }}>
              <LabelList
                dataKey="cumulativeRate" position="top" offset={8}
                formatter={(v: number) => `${v}%`}
                style={{ fontSize: 9, fill: '#00aeef', fontWeight: 600 }}
              />
            </Line>
            {/* Its own line on the SAME percentage scale, so the two are comparable at a
                glance rather than two magnitudes sharing an axis. */}
            <Line yAxisId="rate" type="monotone" dataKey="cumulativeReactivationRate" name="Cumulative Reactivation Rate" stroke="#1abc9c" strokeWidth={2} dot={{ r: 3 }} />
            <Line yAxisId="subs" type="monotone" dataKey="subs" name="Subs Recovered" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
        {data && !data.hasCallLadder && (
          <p className="mt-2 text-[12px] text-slate-500">
            This campaign has no numbered call cadence — the rungs below are the statuses it
            actually moves through, so read them as stages rather than as calls 1 through 5.
          </p>
        )}
      </InsightsSection>

      <InsightsSection
        title="Touch Detail — Effort vs. Return"
        description="What each touch cost in effort beside what it brought back. Expand a row for the agents."
        infoKpiCodes={['col_avg_touches_to_collect']}
      >
        <div className="flex items-center gap-2 px-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
          <span className="w-3.5 shrink-0" />
          <div className={`${COLS} flex-1`}>
            <span>Touch</span>
            <span className="text-right">Touches</span>
            <span className="text-right">Tasks</span>
            <span className="text-right">Customers</span>
            <span className="text-right">Subs Rec.</span>
            <span className="text-right">Recovered</span>
          </div>
        </div>
        {touches.map(t => (
          <ExpandableRow
            key={t.touchSeq}
            isExpanded={expanded === t.touchSeq}
            onToggle={() => setExpanded(expanded === t.touchSeq ? null : t.touchSeq)}
            highlightColor={t.isTerm ? 'hover:bg-danger/5' : 'hover:bg-slate-50'}
            summary={
              <div className={`${COLS} text-sm`}>
                <span className={t.isTerm ? 'font-semibold text-danger' : 'font-medium text-slate-700'}>{t.label}</span>
                <span className="text-right text-slate-600">{fmtNum(t.touchesMade)}</span>
                <span className="text-right text-slate-600">{fmtNum(t.tasksReached)}</span>
                <span className="text-right text-slate-600">{fmtNum(t.accountsReached)}</span>
                <span className="text-right text-slate-600">{fmtNum(t.subs)}</span>
                <span className="text-right font-semibold text-slate-900">{fmtUSD(t.incrementalDollars)}</span>
              </div>
            }
            detail={<TouchDetail t={t} />}
          />
        ))}
      </InsightsSection>

      {data?.postMemo && (
        <InsightsSection
          title="After the Write-Off"
          description="A credit memo shuts the service off, but it does not close the task. This is the work logged after the memo and the cash that came back on a reactivation invoice."
          lastUpdated={data?.dataLastUpdated}
          nextUpdate={data?.dataNextUpdate}
          updateEveryMinutes={data?.updateEveryMinutes}
        >
          <PostMemoPanel p={data.postMemo} />
        </InsightsSection>
      )}

      {data?.subscription && (
        <InsightsSection
          title="Subscription Outcomes"
          description="Whether the campaign kept, lost or won back the service. Only AR churn counts against it."
          lastUpdated={data?.dataLastUpdated}
          nextUpdate={data?.dataNextUpdate}
          updateEveryMinutes={data?.updateEveryMinutes}
        >
          <SubscriptionOutcomes s={data.subscription} totalSubs={data.cohort?.subs ?? 0} />
        </InsightsSection>
      )}
    </ActivityReportShell>
  )
}
