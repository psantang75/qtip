import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Target, BookOpen, AlertTriangle } from 'lucide-react'
import {
  InsightsFilterBar, InsightsSection, KpiTile, TrendChart,
  QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import type { KpiConfig } from '@/hooks/useKpiConfig'
import { getQCKpis, getQCTrends, getQCAgents, getFilterOptions } from '@/services/insightsQCService'
import type { AgentSummary } from '@/services/insightsQCService'

// ── Local helpers ─────────────────────────────────────────────────────────────

function KpiSection({
  icon, label, path, cols, codes, cur, prv, kpiConfig,
}: {
  icon: React.ReactNode; label: string; path: string; cols: number
  codes: string[]; cur: Record<string, number | null>; prv: Record<string, number | null>
  kpiConfig: KpiConfig | undefined
}) {
  const navigate = useNavigate()
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => navigate(path)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">{icon} {label}</span>
        <ChevronRight size={14} className="text-slate-400" />
      </button>
      <div className={`grid gap-3 p-4 ${
        cols === 5 ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5' :
        cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'
      }`}>
        {codes.map(code => (
          <KpiTile
            key={code} kpiCode={code} small
            value={cur[code] ?? null}
            priorValue={prv[code] !== undefined ? (prv[code] ?? undefined) : undefined}
            thresholds={resolveThresholds(code, kpiConfig)}
          />
        ))}
      </div>
    </div>
  )
}

function AgentTable({ agents, highlight, qaGoal, qaWarn }: { agents: AgentSummary[]; highlight: 'red' | 'green'; qaGoal: number; qaWarn: number }) {
  const navigate = useNavigate()
  const hoverCls = highlight === 'red' ? 'hover:bg-red-50' : 'hover:bg-emerald-50'
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400 border-b border-slate-200">
          {['#', 'Agent', 'Department', 'QA', 'Trend', 'Cadence', 'Disputes', 'Warnings'].map(h => (
            <th key={h} className="text-left py-1.5 font-medium pr-2 last:pr-0">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {agents.map((a, i) => (
          <tr
            key={a.userId}
            className={`border-b border-slate-100 last:border-0 ${hoverCls} cursor-pointer`}
            onClick={() => navigate(`/app/insights/qc-agents?agent=${a.userId}`)}
          >
            <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
            <td className="py-2 pr-2 font-medium text-slate-800">{a.name}</td>
            <td className="py-2 pr-2 text-slate-500">{a.dept}</td>
            <td className={`py-2 pr-2 font-semibold ${(a.qa ?? 0) >= qaGoal ? 'text-emerald-600' : (a.qa ?? 0) >= qaWarn ? 'text-slate-700' : 'text-red-600'}`}>
              {a.qa != null ? `${a.qa.toFixed(1)}%` : '—'}
            </td>
            <td className={`py-2 pr-2 font-medium ${a.trend.startsWith('+') ? 'text-emerald-600' : a.trend.startsWith('-') ? 'text-red-500' : 'text-slate-400'}`}>
              {a.trend}
            </td>
            <td className="py-2 pr-2 text-slate-600">{a.cadence}/{a.expected}</td>
            <td className="py-2 pr-2 text-slate-600">{a.disputes}</td>
            <td className={`py-2 font-medium ${a.writeups > 0 ? 'text-red-600' : 'text-slate-500'}`}>{a.writeups}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QCOverviewPage() {
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          resetFilters, params } = useQCFilters()

  const apiParams = useMemo(() => ({ ...params }), [params])

  const { data: kpiConfig } = useKpiConfig()

  const { data: filterOpts } = useQuery({
    queryKey: ['qc-filter-opts', apiParams],
    queryFn:  () => getFilterOptions(apiParams),
  })
  const deptOptions = filterOpts?.departments ?? []

  const { data: kpiData, isLoading, isError, refetch } = useQuery({
    queryKey: ['qc-kpis', apiParams],
    queryFn:  () => getQCKpis(apiParams),
  })
  const { data: trendData } = useQuery({
    queryKey: ['qc-trends', apiParams],
    queryFn:  () => getQCTrends({ ...apiParams, kpis: 'avg_qa_score,coaching_completion_rate' }),
  })
  const { data: agentsData = [] } = useQuery({
    queryKey: ['qc-agents', apiParams],
    queryFn:  () => getQCAgents(apiParams),
  })

  const cur       = kpiData?.current   ?? {}
  const prv       = kpiData?.prior     ?? {}
  const meta      = kpiData?.meta
  const priorMeta = kpiData?.priorMeta

  const qaTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['avg_qa_score'] != null ? Number(r['avg_qa_score']) : null })) ?? []
  const coTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['coaching_completion_rate'] != null ? Number(r['coaching_completion_rate']) : null })) ?? []

  const qaThresh = resolveThresholds('avg_qa_score', kpiConfig)
  const qaGoal = qaThresh.goal ?? 90
  const qaWarn = qaThresh.warn ?? 80
  const ranked      = [...agentsData].filter(a => a.qa !== null).sort((a, b) => (a.qa ?? 0) - (b.qa ?? 0))
  const bottom5     = ranked.slice(0, 5)
  const top5        = [...ranked].reverse().slice(0, 5)
  const deptLabel   = departments.length === 0 ? 'All Departments' : departments.join(', ')
  const periodLabel = period

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments}
        availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        businessDays={meta?.businessDays} priorBusinessDays={priorMeta?.businessDays}
        priorDateRange={priorMeta?.startDate ? { start: priorMeta.startDate, end: priorMeta.endDate } : undefined}
        onReset={resetFilters}
      />

      {isLoading && <QCPageSkeleton tiles={5} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality &amp; Coaching Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {deptLabel} · {periodLabel} ·{' '}
            <span className="text-slate-400">Pace targets managed in Insights Engine Settings → KPI Thresholds</span>
          </p>
        </div>

        <KpiSection icon={<Target size={15} className="text-primary" />} label="Quality — click to drill down"
          path="/app/insights/qc-quality" cols={5}
          codes={['audits_assigned','audits_completed','audit_completion_rate','avg_qa_score','critical_fail_rate']}
          cur={cur} prv={prv} kpiConfig={kpiConfig}
        />

        <KpiSection icon={<BookOpen size={15} className="text-primary" />} label="Coaching — click to drill down"
          path="/app/insights/qc-coaching" cols={4}
          codes={['coaching_sessions_assigned','coaching_sessions_completed','coaching_completion_rate','quiz_pass_rate']}
          cur={cur} prv={prv} kpiConfig={kpiConfig}
        />

        <KpiSection icon={<AlertTriangle size={15} className="text-primary" />} label="Performance Warnings — click to drill down"
          path="/app/insights/qc-warnings" cols={3}
          codes={['total_writeups_issued','escalation_rate','repeat_offender_rate']}
          cur={cur} prv={prv} kpiConfig={kpiConfig}
        />

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="6-Month QA Score Trend">
            <TrendChart data={qaTrends} color="#00aeef"
              goalValue={qaGoal}
              height={110} metricLabel="%" />
          </InsightsSection>
          <InsightsSection title="6-Month Coaching Completion Trend">
            <TrendChart data={coTrends} color="#00aeef"
              goalValue={resolveThresholds('coaching_completion_rate', kpiConfig).goal ?? 92}
              height={110} metricLabel="%" />
          </InsightsSection>
        </div>

        {/* Agent leaderboard */}
        <InsightsSection title="Agent Leaderboard">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold text-emerald-600 mb-2">▲ Top 5 — Top Performers</div>
              {top5.length > 0
                ? <AgentTable agents={top5} highlight="green" qaGoal={qaGoal} qaWarn={qaWarn} />
                : <p className="text-xs text-slate-400">No agent data for this period.</p>
              }
            </div>
            <div>
              <div className="text-xs font-semibold text-red-600 mb-2">▼ Bottom 5 — Needs Attention</div>
              {bottom5.length > 0
                ? <AgentTable agents={bottom5} highlight="red" qaGoal={qaGoal} qaWarn={qaWarn} />
                : <p className="text-xs text-slate-400">No agent data for this period.</p>
              }
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-right">
            <Link to="/app/insights/qc-agents" className="text-xs text-primary hover:underline">
              View full agent leaderboard →
            </Link>
          </div>
        </InsightsSection>
      </div>}
    </div>
  )
}
