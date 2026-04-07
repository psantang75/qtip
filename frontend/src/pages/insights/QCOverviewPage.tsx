import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import {
  InsightsFilterBar, InsightsSection, KpiTile, TrendChart,
  QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { getQCKpis, getQCTrends, getQCAgents } from '@/services/insightsQCService'
import departmentService from '@/services/departmentService'
import type { AgentSummary } from '@/services/insightsQCService'

// ── Local helpers ─────────────────────────────────────────────────────────────

function KpiSection({
  emoji, label, path, cols, codes, cur, prv,
}: {
  emoji: string; label: string; path: string; cols: number
  codes: string[]; cur: Record<string, number | null>; prv: Record<string, number | null>
}) {
  const navigate = useNavigate()
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => navigate(path)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
      >
        <span className="text-[13px] font-semibold text-slate-700">{emoji} {label}</span>
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
          />
        ))}
      </div>
    </div>
  )
}

function AgentTable({ agents, highlight }: { agents: AgentSummary[]; highlight: 'red' | 'green' }) {
  const navigate = useNavigate()
  const hoverCls = highlight === 'red' ? 'hover:bg-red-50' : 'hover:bg-emerald-50'
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400 border-b border-slate-200">
          {['#', 'Agent', 'Dept', 'QA', 'Trend', 'Cadence', 'Disputes', 'W-Ups'].map(h => (
            <th key={h} className="text-left py-1.5 font-medium pr-2 last:pr-0">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {agents.map((a, i) => (
          <tr
            key={a.userId}
            className={`border-b border-slate-100 last:border-0 ${hoverCls} cursor-pointer`}
            onClick={() => navigate('/app/insights/qc-agents', { state: { preselectedUserId: a.userId } })}
          >
            <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
            <td className="py-2 pr-2 font-medium text-slate-800">{a.name}</td>
            <td className="py-2 pr-2 text-slate-500">{a.dept}</td>
            <td className={`py-2 pr-2 font-semibold ${(a.qa ?? 0) >= 90 ? 'text-emerald-600' : (a.qa ?? 0) >= 80 ? 'text-slate-700' : 'text-red-600'}`}>
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
          customStart, setCustomStart, customEnd, setCustomEnd, params } = useQCFilters()

  const { data: deptsData } = useQuery({
    queryKey: ['dept-list-filter'],
    queryFn:  () => departmentService.getDepartments(1, 100, { is_active: true }),
    staleTime: 10 * 60 * 1000,
  })
  const deptOptions = deptsData?.items.map(d => d.department_name) ?? []
  const nameToId    = useMemo(() =>
    Object.fromEntries((deptsData?.items ?? []).map(d => [d.department_name, d.id])),
  [deptsData])

  const apiParams = useMemo(() => ({
    ...params,
    departments: departments.length
      ? departments.map(n => nameToId[n]).filter(Boolean).join(',')
      : undefined,
  }), [params, departments, nameToId])

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

  const cur = kpiData?.current ?? {}
  const prv = kpiData?.prior   ?? {}

  const qaTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: Number(r['avg_qa_score'] ?? 0) })) ?? []
  const coTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: Number(r['coaching_completion_rate'] ?? 0) })) ?? []

  const ranked      = [...agentsData].filter(a => a.qa !== null).sort((a, b) => (a.qa ?? 0) - (b.qa ?? 0))
  const bottom5     = ranked.slice(0, 5)
  const top5        = [...ranked].reverse().slice(0, 5)
  const deptLabel   = departments.length === 0 ? 'All Departments' : departments.join(', ')
  const periodLabel = period

  return (
    <div>
      <div className="-mx-6 -mt-6 mb-5">
        <InsightsFilterBar
          selectedDepts={departments} onDeptsChange={setDepartments}
          availableDepts={deptOptions}
          period={period} onPeriodChange={setPeriod}
          customStart={customStart} customEnd={customEnd}
          onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        />
      </div>

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

        <KpiSection emoji="🎯" label="Quality — click to drill down"
          path="/app/insights/qc-quality" cols={5}
          codes={['audits_assigned','audits_completed','audit_completion_rate','avg_qa_score','critical_fail_rate']}
          cur={cur} prv={prv}
        />

        <KpiSection emoji="📚" label="Coaching — click to drill down"
          path="/app/insights/qc-coaching" cols={4}
          codes={['coaching_sessions_assigned','coaching_sessions_completed','coaching_completion_rate','quiz_pass_rate']}
          cur={cur} prv={prv}
        />

        <KpiSection emoji="⚠️" label="Performance Warnings — click to drill down"
          path="/app/insights/qc-warnings" cols={3}
          codes={['total_writeups_issued','escalation_rate','repeat_offender_rate']}
          cur={cur} prv={prv}
        />

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="6-Month QA Score Trend">
            <TrendChart data={qaTrends} color="#00aeef" goalValue={90} height={110} metricLabel="%" />
          </InsightsSection>
          <InsightsSection title="6-Month Coaching Completion Trend">
            <TrendChart data={coTrends} color="#8b5cf6" goalValue={92} height={110} metricLabel="%" />
          </InsightsSection>
        </div>

        {/* Agent leaderboard */}
        <InsightsSection title="Agent Leaderboard">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold text-red-600 mb-2">▼ Bottom 5 — Needs Attention</div>
              {bottom5.length > 0
                ? <AgentTable agents={bottom5} highlight="red" />
                : <p className="text-xs text-slate-400">No agent data for this period.</p>
              }
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-600 mb-2">▲ Top 5 — Top Performers</div>
              {top5.length > 0
                ? <AgentTable agents={top5} highlight="green" />
                : <p className="text-xs text-slate-400">No agent data for this period.</p>
              }
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-right">
            <Link to="/app/insights/qc-agents" className="text-xs text-[#00aeef] hover:underline">
              View full agent leaderboard →
            </Link>
          </div>
        </InsightsSection>
      </div>}
    </div>
  )
}
