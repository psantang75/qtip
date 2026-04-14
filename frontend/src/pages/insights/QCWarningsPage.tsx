import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, InsightsSection, KpiTile, StatusBadge, ExpandableRow, QCPageSkeleton, ErrorCard } from '@/components/insights'
import WarningsPipelineSection from '@/components/insights/WarningsPipelineSection'
import WarningsActiveSection from '@/components/insights/WarningsActiveSection'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getQCKpis, getFilterOptions, getWriteUpPipeline, getActiveWriteUps,
  getEscalationData, getPolicyViolations, getWarningsDeptComparison,
} from '@/services/insightsQCService'

const TYPE_LABEL: Record<string, string> = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' }
const TYPE_COLOR: Record<string, string> = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' }
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', AWAITING_SIGNATURE: 'Awaiting Sig.', SIGNED: 'Signed', FOLLOW_UP_PENDING: 'Follow-Up', CLOSED: 'Closed' }

function TypeBadge({ type }: { type: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${TYPE_COLOR[type] ?? 'text-slate-600 bg-slate-100 border-slate-200'}`}>{TYPE_LABEL[type] ?? type}</span>
}
function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

export default function QCWarningsPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          resetFilters, params } = useQCFilters()
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null)
  const [showAllPolicies, setShowAllPolicies] = useState(false)

  const apiParams = useMemo(() => ({ ...params }), [params])

  const { data: kpiConfig } = useKpiConfig()
  const { data: filterOpts } = useQuery({ queryKey: ['qc-filter-opts', apiParams], queryFn: () => getFilterOptions(apiParams) })
  const deptOptions = filterOpts?.departments ?? []
  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', apiParams], queryFn: () => getQCKpis(apiParams) })
  const { data: pipeline }      = useQuery({ queryKey: ['qc-pipeline', apiParams],        queryFn: () => getWriteUpPipeline(apiParams) })
  const { data: activeWUs = []} = useQuery({ queryKey: ['qc-active-wu', apiParams],       queryFn: () => getActiveWriteUps(apiParams) })
  const { data: escalation }    = useQuery({ queryKey: ['qc-escalation', apiParams],      queryFn: () => getEscalationData(apiParams) })
  const { data: policies = [] } = useQuery({ queryKey: ['qc-policies', apiParams],        queryFn: () => getPolicyViolations(apiParams) })
  const { data: deptComp = [] } = useQuery({ queryKey: ['qc-warn-dept', apiParams],       queryFn: () => getWarningsDeptComparison(apiParams) })

  const cur       = kpiData?.current   ?? {}
  const prv       = kpiData?.prior     ?? {}
  const meta      = kpiData?.meta
  const priorMeta = kpiData?.priorMeta

  const maxPolicy  = Math.max(...policies.map(p => p.count), 1)

  const navAgent = (userId: number) => navigate(`/app/insights/qc-agents?agent=${userId}`)

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
      {isLoading && <QCPageSkeleton tiles={3} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Performance Warnings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Tracking performance warnings, escalations, and resolution across the organization.</p>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-3">
          {['total_writeups_issued','escalation_rate','repeat_offender_rate'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined}
              thresholds={resolveThresholds(code, kpiConfig)} />
          ))}
        </div>

        {/* Pipeline + Type Distribution */}
        <WarningsPipelineSection pipeline={pipeline} />

        {/* Active Performance Warnings + Escalation + Repeat */}
        <WarningsActiveSection
          activeWriteUps={activeWUs}
          escalation={escalation}
          cur={cur}
          onNavAgent={navAgent}
        />

        {/* Most Violated Policies */}
        <InsightsSection title="Most Violated Policies">
          {policies.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No policy violations data for this period.</p>}
          {(showAllPolicies ? policies : policies.slice(0, 5)).map(pol => (
            <ExpandableRow
              key={pol.policy}
              isExpanded={expandedPolicy === pol.policy}
              onToggle={() => setExpandedPolicy(expandedPolicy === pol.policy ? null : pol.policy)}
              summary={
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-800 flex-1 truncate">{pol.policy}</span>
                  <span className="text-xs text-slate-400 shrink-0">{pol.count} violations · {pol.agentCount} agents</span>
                  <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(pol.count / maxPolicy) * 100}%` }} />
                  </div>
                </div>
              }
              detail={
                pol.agentDetails.length === 0 ? <p className="text-xs text-slate-400">No agent data available.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-400 border-b border-slate-200">
                      {['Agent','Department','Type','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {pol.agentDetails.map(a => (
                        <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-white cursor-pointer" onClick={() => navAgent(a.userId)}>
                          <td className="py-1.5 pr-3 font-medium text-primary">{a.name}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{a.dept}</td>
                          <td className="py-1.5 pr-3"><TypeBadge type={a.type} /></td>
                          <td className="py-1.5 text-slate-500">{STATUS_LABEL[a.status] ?? a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            />
          ))}
          {policies.length > 5 && (
            <button onClick={() => setShowAllPolicies(!showAllPolicies)} className="mt-3 text-xs text-primary hover:underline">
              {showAllPolicies ? 'Show top 5 only' : `Show all ${policies.length} policies`}
            </button>
          )}
        </InsightsSection>

        {/* Dept Comparison */}
        <InsightsSection title="Department Performance Warning Comparison">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
              {['Department','Warnings','Closed','Resolution Rate'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
            </tr></thead>
            <tbody>
              {deptComp.map(row => (
                <tr key={row.dept} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => setDepartments([row.dept])}>
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{row.dept}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.writeups}</td>
                  <td className="py-2.5 pr-4 text-emerald-600">{row.closed}</td>
                  <td className="py-2.5">
                    {(() => {
                      const th = resolveThresholds('writeup_resolution_rate', kpiConfig)
                      const v = row.resolutionRate
                      const color = th.goal != null && v >= th.goal ? 'text-emerald-600'
                        : th.warn != null && v >= th.warn ? 'text-orange-500' : 'text-red-600'
                      return <span className={`font-medium ${color}`}>{fmt(v, '%')}</span>
                    })()}
                  </td>
                </tr>
              ))}
              {deptComp.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-sm text-slate-400">No data available.</td></tr>}
            </tbody>
          </table>
        </InsightsSection>
      </div>}
    </div>
  )
}
