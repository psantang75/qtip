import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Users, ExternalLink } from 'lucide-react'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import {
  InsightsFilterBar, InsightsSection, KpiTile, StatRow,
  TrendChart, ScoreHistogram, StatusBadge, StatusDot, ExpandableRow,
  QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getQCKpis, getQCTrends, getScoreDistribution, getCategoryScores,
  getMissedQuestions, getQualityDeptComparison, getQAFormsCompleted, getFormScores, getFilterOptions,
  getFormAgentBreakdown, getCategoryAgentBreakdown, getLowScoringAudits,
} from '@/services/insightsQCService'
import type { CategoryScore, FormScore, QCParams, QAFormCompletedRow, LowScoringAudit, FormAgentRow, DeptQualityRow } from '@/services/insightsQCService'
import { scoreColor, fmtN } from '@/components/insights/agentProfileHelpers'
import { formatQualityDate } from '@/utils/dateFormat'
import QCMissedQuestions from './QCMissedQuestions'

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

function scoreStatus(
  score: number | null,
  goal: number | null,
  warn: number | null,
): 'good' | 'warning' | 'bad' {
  if (score === null || goal === null) return 'warning'
  if (score >= goal) return 'good'
  if (warn != null && score >= warn) return 'warning'
  return 'bad'
}

// Quality page Average Score by Form — expandable rows that mirror the
// Top Missed Questions pattern exactly: caret summary with form name + a
// score bar, expanded detail showing the per-agent breakdown for that form
// with click-to-navigate to the agent profile.
function FormScoresSection({ formScores, params, qaGoal, qaWarn }: {
  formScores: FormScore[]
  params:     QCParams
  qaGoal:     number
  qaWarn:     number
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: agentRows = [], isFetching } = useQuery({
    queryKey: ['qc-form-agents', expanded, params],
    queryFn:  () => getFormAgentBreakdown(expanded as number, params),
    enabled:  expanded !== null,
  })

  const agentColumns = useMemo<ColumnDef<FormAgentRow, any>[]>(() => [
    { accessorKey: 'name', header: 'Agent', cell: ({ row }) => <span className="text-primary hover:underline">{row.original.name}</span> },
    { accessorKey: 'dept', header: 'Department', cell: ({ row }) => <span className="text-slate-500">{row.original.dept}</span> },
    { accessorKey: 'audits', header: 'Reviews', meta: { bold: true } },
    {
      accessorKey: 'avgScore',
      header: 'Avg Score',
      cell: ({ row }) => (
        <span className={`font-semibold ${scoreColor(row.original.avgScore, qaGoal, qaWarn)}`}>{fmtN(row.original.avgScore, '%')}</span>
      ),
    },
  ], [qaGoal, qaWarn])

  if (formScores.length === 0) {
    return (
      <InsightsSection title="Average Score by Form" infoKpiCodes={['avg_score_by_form']}>
        <p className="text-sm text-slate-400 text-center py-6">No data for the selected period.</p>
      </InsightsSection>
    )
  }

  return (
    <InsightsSection title="Average Score by Form" infoKpiCodes={['avg_score_by_form']}>
      {formScores.map(row => {
        const score   = row.avgScore ?? 0
        const barPct  = Math.min(score, 100)
        // Score bar colour follows the same goal/warn semantics as the rest
        // of the QC pages so the visual matches StatusDot / score badges.
        const barColor = score >= qaGoal ? 'bg-emerald-400' : score >= qaWarn ? 'bg-orange-400' : 'bg-red-400'
        const txtColor = score >= qaGoal ? 'text-emerald-600' : score >= qaWarn ? 'text-orange-600' : 'text-red-600'
        return (
          <ExpandableRow
            key={row.id}
            isExpanded={expanded === row.id}
            onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
            summary={
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[13px] font-medium text-slate-800 truncate flex-1">{row.form}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
                  </div>
                  <span className={`text-xs font-semibold ${txtColor} w-12 text-right`}>{fmtN(row.avgScore, '%')}</span>
                  <span className="text-[11px] text-slate-400 w-16 text-right">{row.submissions} Reviews</span>
                </div>
              </div>
            }
            detail={
              isFetching ? (
                <p className="text-xs text-slate-400">Loading agent breakdown…</p>
              ) : agentRows.length === 0 ? (
                <p className="text-xs text-slate-400">No agent data available.</p>
              ) : (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users size={12} className="text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600">Agents reviewed on this form</span>
                  </div>
                  <SortableTable<FormAgentRow>
                    columns={agentColumns}
                    data={agentRows}
                    initialSorting={[]}
                    minWidth="min-w-0"
                    onRowClick={(a) => navigate(`/app/insights/qc-agents?agent=${a.userId}`)}
                  />
                </div>
              )
            }
          />
        )
      })}
    </InsightsSection>
  )
}

// Quality page "QA Forms Below 90%" — a flat list of individual finalized
// audits scoring under 90, surfacing the audited agent, the form, the
// interaction date, and the score. Sits directly beneath Average Score by
// Form so reviewers can drill from the form average straight to the specific
// low-scoring interactions. Agent name links to the QC agent profile.
function LowScoresSection({ audits, qaThresh }: {
  audits:   LowScoringAudit[]
  qaThresh: ReturnType<typeof resolveThresholds>
}) {
  const navigate = useNavigate()

  const columns = useMemo<ColumnDef<LowScoringAudit, any>[]>(() => [
    {
      accessorKey: 'id',
      header: 'Review ID',
      cell: ({ row }) => (
        <a
          href={`/app/quality/submissions/${row.original.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          #{row.original.id}
          <ExternalLink size={12} />
        </a>
      ),
    },
    { accessorKey: 'agent', header: 'Agent', cell: ({ row }) => <span className="font-medium text-primary hover:underline">{row.original.agent}</span> },
    { accessorKey: 'form', header: 'Form', cell: ({ row }) => <span className="text-slate-600">{row.original.form}</span> },
    { accessorKey: 'interactionDate', header: 'Interaction Date', cell: ({ row }) => <span className="text-slate-500">{formatQualityDate(row.original.interactionDate)}</span> },
    {
      accessorKey: 'score',
      header: 'Score',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <StatusDot value={row.original.score ?? 0} thresholds={qaThresh} />
          <span className="font-semibold">{fmtN(row.original.score, '%')}</span>
        </span>
      ),
    },
  ], [qaThresh])

  return (
    <InsightsSection
      title="QA Forms Below 90%"
      description={audits.length > 0 ? `${audits.length} ${audits.length === 1 ? 'audit' : 'audits'} below 90% in the selected period` : undefined}
    >
      {audits.length === 0
        ? <p className="text-sm text-slate-400 text-center py-4">No audits below 90% for the selected period.</p>
        : (
          <SortableTable<LowScoringAudit>
            columns={columns}
            data={audits}
            initialSorting={[]}
            minWidth="min-w-0"
            paginated
            onRowClick={(a) => navigate(`/app/insights/qc-agents?agent=${a.csrUserId}`)}
          />
        )
      }
    </InsightsSection>
  )
}

// Quality page Category Performance — expandable rows grouped by form. Each
// row's summary aggregates the form's category averages; expanding lazily
// fetches the per-(form, category) per-agent breakdown for the underperforming
// categories within that form. Same visual style as Top Missed Questions.
function CategoryPerformanceSection({ catData, params, qaGoal, qaWarn }: {
  catData: CategoryScore[]
  params:  QCParams
  qaGoal:  number
  qaWarn:  number
}) {
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  // Group categories by form so each form is one expandable row. Average is
  // the mean of its scored categories so the summary number aligns with the
  // detail rows under it.
  const formsWithCats = useMemo(() => {
    const map = new Map<string, { form: string; categories: CategoryScore[] }>()
    for (const c of catData) {
      if (!map.has(c.form)) map.set(c.form, { form: c.form, categories: [] })
      map.get(c.form)!.categories.push(c)
    }
    return [...map.values()].map(g => {
      const scored = g.categories.filter(c => c.avgScore != null)
      const avg    = scored.length ? scored.reduce((s, c) => s + (c.avgScore ?? 0), 0) / scored.length : null
      const audits = g.categories.reduce((s, c) => s + c.audits, 0)
      return { ...g, avgScore: avg, audits }
    }).sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
  }, [catData])

  const visible = showAll ? formsWithCats : formsWithCats.slice(0, 5)

  // Per-(form, category) lazy fetch. Key shape `${formId}::${categoryId}` so
  // the same category name appearing on different forms doesn't collide.
  const expandedCatRow = useMemo(() => {
    if (!expandedCat) return null
    return catData.find(r => `${r.formId}::${r.categoryId}` === expandedCat) ?? null
  }, [expandedCat, catData])

  const { data: agentRows = [], isFetching } = useQuery({
    queryKey: ['qc-cat-agents', expandedCat, params],
    queryFn:  () => getCategoryAgentBreakdown(expandedCatRow!.formId, expandedCatRow!.categoryId, params),
    enabled:  expandedCat !== null && !!expandedCatRow && !!expandedCatRow.formId && !!expandedCatRow.categoryId,
  })

  return (
    <InsightsSection title="Category Performance" infoKpiCodes={['category_performance']}>
      {formsWithCats.length === 0
        ? <p className="text-sm text-slate-400 text-center py-4">No category data for the selected period.</p>
        : visible.map(group => {
            const isExp = expanded === group.form
            return (
              <ExpandableRow
                key={group.form}
                isExpanded={isExp}
                onToggle={() => {
                  setExpanded(isExp ? null : group.form)
                  setExpandedCat(null)
                }}
                summary={
                  <div className="flex items-center flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{group.form}</span>
                    <span className="text-xs text-slate-700 shrink-0">{group.categories.length} Categories</span>
                    <span className={`text-sm font-bold shrink-0 ml-4 ${scoreColor(group.avgScore, qaGoal, qaWarn)}`}>{fmtN(group.avgScore, '%')} Average</span>
                  </div>
                }
                detail={
                  <div className="pt-1 space-y-1">
                    {[...group.categories].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0)).map((c, i) => {
                      const catKey = `${c.formId}::${c.categoryId}`
                      const delta  = c.avgScore != null ? c.avgScore - qaGoal : null
                      const isCatExp = expandedCat === catKey
                      return (
                        <div key={c.categoryId ?? `${c.category}-${i}`} className="border border-slate-200 rounded-md bg-white">
                          <button
                            onClick={() => setExpandedCat(isCatExp ? null : catKey)}
                            className={`w-full flex items-center text-xs px-2.5 py-1.5 text-left transition-colors ${isCatExp ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          >
                            <span className="shrink-0 text-slate-400 mr-2">{isCatExp ? '▾' : '▸'}</span>
                            <span className="flex-1 min-w-0 truncate text-slate-800 font-medium">{c.category}</span>
                            <span className="w-16 shrink-0 text-right text-slate-500">{c.audits}</span>
                            <span className={`w-20 shrink-0 text-right font-semibold ${scoreColor(c.avgScore, qaGoal, qaWarn)}`}>{fmtN(c.avgScore, '%')}</span>
                            <span className={`w-16 shrink-0 text-right font-medium ${delta == null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {delta == null ? '—' : delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                            </span>
                          </button>
                          {isCatExp && (
                            <div className="border-t border-slate-200 bg-slate-50 p-2.5">
                              {isFetching ? (
                                <p className="text-xs text-slate-400">Loading agent breakdown…</p>
                              ) : agentRows.length === 0 ? (
                                <p className="text-xs text-slate-400">No agent data for this category in the selected period.</p>
                              ) : (
                                <div>
                                  <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                                    <span className="flex-1 min-w-0">Agent</span>
                                    <span className="w-32 shrink-0">Department</span>
                                    <span className="w-16 shrink-0 text-right">Reviews</span>
                                    <span className="w-20 shrink-0 text-right">Score</span>
                                  </div>
                                  {agentRows.map(a => (
                                    <div
                                      key={a.userId}
                                      onClick={() => navigate(`/app/insights/qc-agents?agent=${a.userId}`)}
                                      className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0 hover:bg-slate-100 cursor-pointer"
                                    >
                                      <span className="flex-1 min-w-0 truncate text-primary hover:underline">{a.name}</span>
                                      <span className="w-32 shrink-0 truncate text-slate-500">{a.dept}</span>
                                      <span className="w-16 shrink-0 text-right text-slate-600">{a.audits}</span>
                                      <span className={`w-20 shrink-0 text-right font-semibold ${scoreColor(a.avgScore, qaGoal, qaWarn)}`}>{fmtN(a.avgScore, '%')}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                }
              />
            )
          })
      }
      {formsWithCats.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-3 text-xs text-primary hover:underline"
        >
          {showAll ? 'Show bottom 5 only' : `Show all ${formsWithCats.length} forms`}
        </button>
      )}
    </InsightsSection>
  )
}

// Quality page Department Comparison — a flat, sortable roll-up of each
// department's audit volume, average QA score, dispute count, and on-track
// status. Clicking a row filters the whole page to that department.
function DeptComparisonSection({ deptComp, qaThresh, auditGoal, auditWarn, onSelectDept }: {
  deptComp:     DeptQualityRow[]
  qaThresh:     ReturnType<typeof resolveThresholds>
  auditGoal:    number
  auditWarn:    number | null
  onSelectDept: (dept: string) => void
}) {
  const columns = useMemo<ColumnDef<DeptQualityRow, any>[]>(() => [
    { accessorKey: 'dept', header: 'Department', cell: ({ row }) => <span className="font-medium text-slate-800">{row.original.dept}</span> },
    { accessorKey: 'audits', header: 'Audits', cell: ({ row }) => <span className="text-slate-500">{row.original.audits}</span> },
    {
      accessorKey: 'avgScore',
      header: 'QA Score',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <StatusDot value={row.original.avgScore ?? 0} thresholds={qaThresh} />
          <span className="font-semibold">{fmt(row.original.avgScore, '%')}</span>
        </span>
      ),
    },
    { accessorKey: 'disputes', header: 'Disputes', cell: ({ row }) => <span className="text-slate-600">{row.original.disputes}</span> },
    {
      id: 'status',
      header: 'Status',
      // Derived from avgScore; sort by the QA Score column instead.
      enableSorting: false,
      cell: ({ row }) => {
        const st = scoreStatus(row.original.avgScore, auditGoal, auditWarn)
        return (
          <StatusBadge
            label={st === 'good' ? 'On Track' : st === 'warning' ? 'Near Goal' : 'Below Goal'}
            variant={st === 'bad' ? 'bad' : st === 'warning' ? 'warning' : 'good'}
          />
        )
      },
    },
  ], [qaThresh, auditGoal, auditWarn])

  return (
    <InsightsSection title="Department Comparison" infoKpiCodes={['dept_comparison']}>
      {deptComp.length === 0
        ? <p className="text-sm text-slate-400 text-center py-4">No data available.</p>
        : (
          <SortableTable<DeptQualityRow>
            columns={columns}
            data={deptComp}
            initialSorting={[]}
            minWidth="min-w-0"
            onRowClick={(r) => onSelectDept(r.dept)}
          />
        )
      }
    </InsightsSection>
  )
}

export default function QCQualityPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          forms, setForms, resetFilters, params } = useQCFilters()

  // Cross-filtered dropdown options: dept options filtered by selected forms, form options filtered by selected depts
  const { data: filterOpts } = useQuery({
    queryKey: ['qc-filter-opts', params],
    queryFn:  () => getFilterOptions(params),
  })
  const deptOptions = filterOpts?.departments ?? []
  const formOptions = filterOpts?.forms ?? []

  // All data queries use the same params (dept + form + period)
  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', params], queryFn: () => getQCKpis(params) })
  const { data: trendData } = useQuery({ queryKey: ['qc-trends-qa', params], queryFn: () => getQCTrends({ ...params, kpis: 'avg_qa_score' }) })
  const { data: distData = [] } = useQuery({ queryKey: ['qc-dist', params], queryFn: () => getScoreDistribution(params) })
  const { data: catData  = [] } = useQuery({ queryKey: ['qc-cats', params], queryFn: () => getCategoryScores(params) })
  const { data: missData = [] } = useQuery({ queryKey: ['qc-miss', params], queryFn: () => getMissedQuestions(params) })
  const { data: deptComp = [] } = useQuery({ queryKey: ['qc-dept-cmp', params], queryFn: () => getQualityDeptComparison(params) })
  const { data: qaForms = [] } = useQuery({ queryKey: ['qc-qa-forms', params], queryFn: () => getQAFormsCompleted(params) })
  // Group the flat QA-forms rows into (QA person → form) blocks so we can render
  // a subtotal row per QA-person/form, mirroring the Tickets & Tasks report.
  // Rows arrive pre-sorted by qa → form → agent, so contiguous grouping is safe.
  // Subtotal Avg Score is completed-weighted (each agent's avg is over their
  // own completed count), which equals the group's overall average.
  const qaFormGroups = useMemo(() => {
    const groups: Array<{
      key: string; qaName: string; form: string
      rows: QAFormCompletedRow[]; completed: number; avgScore: number | null
    }> = []
    for (const row of qaForms) {
      const key = `${row.qaUserId}-${row.formId}`
      let g = groups.length > 0 && groups[groups.length - 1].key === key ? groups[groups.length - 1] : null
      if (!g) { g = { key, qaName: row.qaName, form: row.form, rows: [], completed: 0, avgScore: null }; groups.push(g) }
      g.rows.push(row)
    }
    for (const g of groups) {
      g.completed = g.rows.reduce((s, r) => s + r.completed, 0)
      let num = 0, den = 0
      for (const r of g.rows) if (r.avgScore != null) { num += r.avgScore * r.completed; den += r.completed }
      g.avgScore = den > 0 ? Math.round((num / den) * 10) / 10 : null
    }
    return groups
  }, [qaForms])
  const { data: formScores = [] } = useQuery({ queryKey: ['qc-forms', params], queryFn: () => getFormScores(params) })
  const { data: lowScores = [] } = useQuery({ queryKey: ['qc-low-scores', params], queryFn: () => getLowScoringAudits(params) })
  const { data: kpiConfig } = useKpiConfig()

  const cur       = kpiData?.current   ?? {}
  const prv       = kpiData?.prior     ?? {}
  const meta      = kpiData?.meta
  const priorMeta = kpiData?.priorMeta
  const qaTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['avg_qa_score'] != null ? Number(r['avg_qa_score']) : null })) ?? []

  // All thresholds resolved from ie_kpi_threshold (kpiDefs.ts as fallback)
  const qaThresh  = resolveThresholds('avg_qa_score', kpiConfig)
  const auditGoal = qaThresh.goal ?? 90
  const auditWarn = qaThresh.warn ?? null

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments}
        availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={forms} onFormsChange={setForms}
        availableForms={formOptions}
        businessDays={meta?.businessDays} priorBusinessDays={priorMeta?.businessDays}
        currentDateRange={meta?.startDate ? { start: meta.startDate, end: meta.endDate } : undefined}
        priorDateRange={priorMeta?.startDate ? { start: priorMeta.startDate, end: priorMeta.endDate } : undefined}
        onReset={resetFilters}
      />

      {isLoading && <QCPageSkeleton tiles={5} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality</h1>
          <p className="text-sm text-slate-500 mt-0.5">Detailed quality analytics — scores, disputes, categories, and missed questions.</p>
        </div>

        {/* KPI Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {['avg_qa_score','audits_assigned','audits_completed','audit_completion_rate','critical_fail_rate','avg_criticals_per_audit'].map(code => (
            <KpiTile
              key={code}
              kpiCode={code}
              value={cur[code] ?? null}
              priorValue={prv[code] ?? undefined}
              thresholds={resolveThresholds(code, kpiConfig)}
              filterContext={{ dept: departments.length > 0, form: forms.length > 0 }}
            />
          ))}
        </div>

        {/* Trend + Distribution charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection
            title="QA Score Trend"
            infoKpiCodes={['qa_score_trend']}
          >
            <TrendChart data={qaTrends} color="#00aeef" goalValue={auditGoal} height={120} metricLabel="%" />
          </InsightsSection>
          <InsightsSection
            title="Score Distribution"
            infoKpiCodes={['avg_qa_score']}
          >
            <ScoreHistogram data={distData} goalScore={auditGoal} />
          </InsightsSection>
        </div>

        {/* Dispute Analysis + Timeliness */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Dispute Analysis">
            {([
              ['Dispute Rate',          'dispute_rate',           cur.dispute_rate,           prv.dispute_rate,           '%'],
              ['Dispute Upheld Rate',   'dispute_upheld_rate',    cur.dispute_upheld_rate,    prv.dispute_upheld_rate,    '%'],
              ['Dispute Adjusted Rate', 'dispute_adjusted_rate',  cur.dispute_adjusted_rate,  prv.dispute_adjusted_rate,  '%'],
            ] as [string, string, number | null | undefined, number | null | undefined, string][]).map(([lbl, code, curVal, prvVal, sfx]) => {
              const th = resolveThresholds(code, kpiConfig)
              return (
                <StatRow key={code} label={lbl}
                  kpiCode={code}
                  value={fmt(curVal ?? null, '%')}
                  trend={{ current: curVal ?? null, prior: prvVal ?? null, direction: th.direction as 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL', suffix: sfx }}
                  thresholds={{ goal: th.goal, warn: th.warn, crit: th.crit, direction: th.direction, suffix: '%' }}
                />
              )
            })}
          </InsightsSection>
          <InsightsSection title="Timeliness">
            {([
              ['Avg Time to Audit',            'time_to_audit',                 cur.time_to_audit,                 prv.time_to_audit],
              ['Avg Dispute Resolution Time',  'avg_dispute_resolution_time',   cur.avg_dispute_resolution_time,   prv.avg_dispute_resolution_time],
            ] as [string, string, number | null | undefined, number | null | undefined][]).map(([lbl, code, curVal, prvVal]) => {
              const th = resolveThresholds(code, kpiConfig)
              return (
                <StatRow key={code} label={lbl}
                  kpiCode={code}
                  value={fmt(curVal ?? null, ' days')}
                  trend={{ current: curVal ?? null, prior: prvVal ?? null, direction: th.direction as 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL', suffix: 'd' }}
                  thresholds={{ goal: th.goal, warn: th.warn, crit: th.crit, direction: th.direction, suffix: ' days' }}
                />
              )
            })}
          </InsightsSection>
        </div>

        {/* Average Score by Form — expandable per-agent drill-down */}
        <FormScoresSection
          formScores={formScores} params={params}
          qaGoal={auditGoal} qaWarn={auditWarn ?? auditGoal - 10}
        />

        {/* QA Forms Below 90% — individual low-scoring audits */}
        <LowScoresSection audits={lowScores} qaThresh={qaThresh} />

        {/* Category Performance — expandable per-form, then per-category, then per-agent */}
        <CategoryPerformanceSection
          catData={catData} params={params}
          qaGoal={auditGoal} qaWarn={auditWarn ?? auditGoal - 10}
        />

        {/* Top Missed Questions */}
        <QCMissedQuestions questions={missData} />

        {/* QA Forms Completed — auditor x CSR x form, driven by the filters */}
        <InsightsSection title="QA Forms Completed">
          {qaForms.length === 0
            ? <p className="text-sm text-slate-400 text-center py-4">No data available.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-200">
                    {['QA Person','Form','Agent','Completed','Avg Score'].map(h => (
                      <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {qaFormGroups.map((group, gi) => (
                    <Fragment key={`${group.key}-${gi}`}>
                      {group.rows.map(row => (
                        <tr
                          key={`${row.qaUserId}-${row.csrUserId}-${row.formId}`}
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="py-2.5 pr-4 font-medium text-slate-800">{row.qaName}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{row.form}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{row.csrName}</td>
                          <td className="py-2.5 pr-4 text-slate-500">{row.completed}</td>
                          <td className="py-2.5">
                            <span className="flex items-center gap-1.5">
                              <StatusDot value={row.avgScore ?? 0} thresholds={qaThresh} />
                              <span className="font-semibold">{fmt(row.avgScore, '%')}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                        <td className="py-2.5 pr-4" colSpan={3}>Total — {group.qaName} · {group.form}</td>
                        <td className="py-2.5 pr-4 text-slate-700">{group.completed}</td>
                        <td className="py-2.5">
                          <span className="flex items-center gap-1.5">
                            <StatusDot value={group.avgScore ?? 0} thresholds={qaThresh} />
                            <span>{fmt(group.avgScore, '%')}</span>
                          </span>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>

        {/* Department Comparison */}
        <DeptComparisonSection
          deptComp={deptComp} qaThresh={qaThresh}
          auditGoal={auditGoal} auditWarn={auditWarn}
          onSelectDept={(d) => setDepartments([d])}
        />
      </div>}
    </div>
  )
}
