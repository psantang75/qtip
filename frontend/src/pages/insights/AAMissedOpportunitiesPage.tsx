/**
 * Insights → Sales Agent Activity → Missed Opportunities.
 *
 * Productizes the manual daily sales review: a nightly worker reads yesterday's
 * connected sales calls plus that rep's CRM notes, applies the editable rule set
 * from the Settings tab, and stores one row per miss with a recommended fix.
 *
 * Day-scoped, like the Productivity report: the worker grades one business day
 * at a time, so the filter bar picks a single day rather than a range and the
 * whole page describes that day. The Period selector is the standard Insights
 * control restricted to Yesterday or a Custom date, and the Custom picker is
 * bounded to days that were actually analyzed — the report cannot describe a day
 * before its first nightly run, and it never covers today.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarOff, Download, Loader2 } from 'lucide-react'
import { InsightsSection, KpiTile } from '@/components/insights'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { fmtNum } from '@/components/insights/agentActivity/format'
import FindingsList from '@/components/insights/missedOpportunities/FindingsList'
import { Button } from '@/components/ui/button'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/utils/errorHandling'
import {
  downloadMissedOpportunitiesDoc,
  getMissedOpportunities,
} from '@/services/missedOpportunitiesService'
import type { MissedOpportunityAgentRow } from '@/types/missedOpportunities'

/** Today is deliberately absent: the nightly run grades the PRIOR day, so today never has data. */
const PERIOD_OPTIONS = ['Yesterday', 'Custom'] as const
const DEFAULT_PERIOD: (typeof PERIOD_OPTIONS)[number] = 'Yesterday'

/** Own storage key so the single day picked here can't leak onto the month-scoped sibling reports. */
const STORAGE_KEY = 'aa-missed-opps-filters'

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const yesterdayISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toISO(d)
}

/** ISO YYYY-MM-DD -> "Fri, Sep 4, 2026", for prose about the selected day. */
const fmtDayLong = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function AAMissedOpportunitiesPage() {
  const filters = useActivityFilters(STORAGE_KEY)
  const { period, setPeriod, customStart } = filters
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)

  // A persisted range period (e.g. a stale "Current Month" from a sibling
  // report) is not a single day for this report, so snap it back.
  useEffect(() => {
    if (!(PERIOD_OPTIONS as readonly string[]).includes(period)) setPeriod(DEFAULT_PERIOD)
  }, [period, setPeriod])

  const day = useMemo(
    () => (period === 'Custom' ? customStart || yesterdayISO() : yesterdayISO()),
    [period, customStart],
  )

  // Always sent as a one-day custom range so the backend resolves exactly the
  // day on screen, regardless of which label the Period dropdown is showing.
  const query = useMemo(
    () => ({ ...filters.params, period: 'custom', start: day, end: day }),
    [filters.params, day],
  )

  const { data, isLoading } = useQuery({
    queryKey: ['insights', 'sales', 'missed-opportunities', query],
    queryFn: () => getMissedOpportunities(query),
    staleTime: 0,
  })

  const agents = useMemo(() => data?.agents ?? [], [data])
  const agentOrder = useMemo(() => agents.map((a) => a.agentName), [agents])

  const columns = useMemo<ColumnDef<MissedOpportunityAgentRow, unknown>[]>(() => [
    { accessorKey: 'agentName', header: 'Agent', meta: { width: 'w-[24%]' } },
    { accessorKey: 'findings', header: 'Misses', meta: { width: 'w-[10%]', bold: true }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'high', header: 'High', meta: { width: 'w-[9%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'medium', header: 'Medium', meta: { width: 'w-[9%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'low', header: 'Low', meta: { width: 'w-[8%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'callsWithFindings', header: 'Calls Affected', meta: { width: 'w-[13%]' }, cell: c => fmtNum(c.getValue<number>()) },
    { accessorKey: 'topRuleName', header: 'Most Common Miss', meta: { width: 'w-[27%]' }, cell: c => c.getValue<string | null>() ?? '—' },
  ], [])

  const totalRow = useMemo(() => {
    const sum = (k: keyof MissedOpportunityAgentRow) =>
      agents.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    return {
      agentName: `Total: ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`,
      findings: fmtNum(sum('findings')),
      high: fmtNum(sum('high')),
      medium: fmtNum(sum('medium')),
      low: fmtNum(sum('low')),
      callsWithFindings: fmtNum(data?.totals.callsWithFindings ?? 0),
    } as Record<string, React.ReactNode>
  }, [agents, data])

  const run = data?.run ?? null

  // Drives the non-filtered affordance on the two rate tiles. Sourced from the
  // backend's own verdict rather than re-deriving which filters matter, so the
  // tile and the number it shows can never disagree.
  const rateFilterContext = useMemo(
    () => (data?.ratesUnavailableReason === 'filtered' ? { dept: true, user: true } : undefined),
    [data?.ratesUnavailableReason],
  )

  // The clean count is a whole-run figure. When the page is narrowed to some
  // agents or departments there is no matching denominator for the subset, so
  // the description says what it can measure instead of quoting a number drawn
  // from a different population.
  const byAgentDescription = useMemo(() => {
    if (!run) return undefined
    const scope = 'Only connected calls above the talk-time floor are graded — '
      + 'short dials and calls without a transcript are never counted.'
    if (data?.ratesUnavailableReason === 'filtered') {
      return `${fmtNum(run.callsAnalyzed)} call(s) analyzed on ${fmtDayLong(day)} across all agents. `
        + `The clean-call and per-call rates are hidden while the view is filtered: they are only `
        + `recorded for the whole day, so there is no matching denominator for this subset. ${scope}`
    }
    return `${fmtNum(run.callsAnalyzed)} call(s) analyzed on ${fmtDayLong(day)}, of which `
      + `${fmtNum(data?.totals.cleanCalls ?? 0)} came back clean. ${scope}`
  }, [run, data?.ratesUnavailableReason, data?.totals.cleanCalls, day])

  const earliest = data?.runWindow.earliest ?? null
  // Yesterday is the newest day the nightly run can have graded, but an admin
  // re-grade can push a later day into the window, so honour whichever is later.
  const latestSelectable = [yesterdayISO(), data?.runWindow.latest ?? '']
    .filter(Boolean).sort().pop() as string
  // No run row for the selected day means the day was never graded. That is a
  // different statement from "no misses", and conflating them would read as a
  // clean day, so the report says which one it is.
  const notAnalyzed = !!data && !run

  const handleExport = async () => {
    try {
      setExporting(true)
      await downloadMissedOpportunitiesDoc(query, `Missed_Opportunities_${day}.doc`)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: "Couldn't export the report",
        description: getErrorMessage(err, 'Try again.'),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <ActivityReportShell
      title="Missed Opportunities"
      description="Eligible sales calls from the selected day, reviewed with available lead/task history, company KB and the configured database rules. Each finding explains the interaction, specific miss, what to do next time and a recovery action when appropriate. Calls without findings are not a complete QA certification; call filters and available evidence limit coverage."
      live
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      periodOptions={PERIOD_OPTIONS}
      singleDayCustom
      customDateMin={earliest ?? undefined}
      customDateMax={latestSelectable}
      hideBusinessDays
      hideDateRange
    >
      <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting || notAnalyzed || !run}
              title={run ? 'Download this day as a Word document' : 'Nothing to export — this day has not been graded'}
            >
              {exporting
                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                : <Download className="mr-1 h-3.5 w-3.5" />}
              {exporting ? 'Generating…' : 'Export Word'}
            </Button>
          </div>

          {notAnalyzed && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-surface px-4 py-3">
              <CalendarOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="text-[13px] font-semibold text-slate-900">
                  {fmtDayLong(day)} has not been graded
                </p>
                <p className="mt-0.5 text-[12px] text-slate-600">
                  {earliest
                    ? `This report starts on ${fmtDayLong(earliest)} — the first day the nightly review ran. Pick a day on or after that, or re-grade this one from the Settings tab.`
                    : 'The nightly review has not produced a day yet. Once it runs, the day it graded becomes selectable here.'}
                </p>
              </div>
            </div>
          )}

          {/* A PARTIAL or FAILED run means the numbers below are incomplete;
              say so rather than letting an under-count read as good news. */}
          {run && (run.status === 'PARTIAL' || run.status === 'FAILED') && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
              <p className="text-[13px] font-semibold text-slate-900">
                {fmtDayLong(day)} finished {run.status.toLowerCase()}
              </p>
              <p className="mt-0.5 text-[12px] text-slate-600">
                {run.errorText ?? 'Some calls could not be analyzed.'} Analyzed {fmtNum(run.callsAnalyzed)} of {fmtNum(run.callsConsidered)} calls
                {run.callsFailed > 0 && ` (${fmtNum(run.callsFailed)} failed)`}
                {run.callsSkipped > 0 && ` (${fmtNum(run.callsSkipped)} had no transcript)`}. Counts below cover only the calls that were graded.
              </p>
            </div>
          )}

          {/* Clean Calls leads deliberately: this is a coaching tool, and the day
              reads very differently when the first number is what went right. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Both rate tiles divide by the run's day-wide analyzed-call count,
                which no agent or department filter narrows — so they declare
                themselves non-filtered rather than quoting a rate built from
                two different populations. */}
            <KpiTile
              kpiCode="mo_clean_call_rate"
              value={data?.totals.cleanCallRate ?? null}
              filterContext={rateFilterContext}
            />
            <KpiTile kpiCode="mo_total_misses" value={data?.totals.findings ?? null} />
            <KpiTile kpiCode="mo_high_severity" value={data?.totals.high ?? null} />
            <KpiTile
              kpiCode="mo_misses_per_call"
              value={data?.totals.findingsPerCall ?? null}
              filterContext={rateFilterContext}
            />
            <KpiTile kpiCode="mo_agents_affected" value={data?.totals.agentsAffected ?? null} />
          </div>

          <InsightsSection
            title="By Agent"
            description={run ? byAgentDescription : undefined}
            infoKpiCodes={['mo_clean_call_rate', 'mo_total_misses', 'mo_misses_per_call']}
            lastUpdated={data?.dataLastUpdated ?? undefined}
            updateEveryMinutes={1440}
          >
            <SortableTable
              columns={columns}
              data={agents}
              initialSorting={[{ id: 'findings', desc: true }]}
              totalRow={totalRow}
              minWidth="min-w-[880px]"
            />
          </InsightsSection>

          <InsightsSection
            title="Missed Opportunities by Agent"
            description="Expand an agent to see each customer they missed with that day, then each call: category, what happened, the quote, the recommended approach, and how to recover the account."
          >
            {isLoading
              ? <p className="py-8 text-center text-sm text-slate-400">Loading findings…</p>
              : <FindingsList findings={data?.findings ?? []} agentOrder={agentOrder} />}
          </InsightsSection>

          {data && data.byRule.length > 0 && (
            <InsightsSection
              title="By Rule"
              description="Which rules fired most on this day. A rule dominating the list is usually a team-wide process gap rather than one rep's habit."
            >
              <div className="divide-y divide-slate-100">
                {data.byRule.map((r) => (
                  <div key={r.ruleKey} className="flex items-center justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-800">
                        {r.ruleName ?? r.ruleKey}
                      </div>
                      {r.category && <div className="text-[11px] text-slate-400">{r.category}</div>}
                    </div>
                    <div className="shrink-0 text-[13px] font-semibold text-slate-900">
                      {fmtNum(r.findings)}
                    </div>
                  </div>
                ))}
              </div>
            </InsightsSection>
          )}
      </div>
    </ActivityReportShell>
  )
}
