import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, InsightsSection, KpiTile, StatRow, StatusBadge, ExpandableRow, QCPageSkeleton, ErrorCard } from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getQCKpis, getWriteUpPipeline, getActiveWriteUps,
  getEscalationData, getPolicyViolations, getWarningsDeptComparison,
} from '@/services/insightsQCService'

const TYPE_LABEL: Record<string, string> = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' }
const TYPE_COLOR: Record<string, string> = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' }
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', DELIVERED: 'Delivered', AWAITING_SIGNATURE: 'Awaiting Sig.', SIGNED: 'Signed', FOLLOW_UP_PENDING: 'Follow-Up', CLOSED: 'Closed' }
const STATUS_DOT: Record<string, string>  = { DRAFT: 'bg-slate-400', SCHEDULED: 'bg-purple-500', DELIVERED: 'bg-[#00aeef]', AWAITING_SIGNATURE: 'bg-orange-500', SIGNED: 'bg-yellow-500', FOLLOW_UP_PENDING: 'bg-red-500', CLOSED: 'bg-emerald-500' }

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

  const apiParams = useMemo(() => ({ ...params }), [params])

  const { data: kpiConfig } = useKpiConfig()
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

  const byStatus   = pipeline?.byStatus ?? {}
  const byType     = pipeline?.byType   ?? {}
  const totalType  = Object.values(byType).reduce((a, b) => a + b, 0)
  const repeatWUs  = activeWUs.filter(w => w.priorCount > 0)
  const maxPolicy  = Math.max(...policies.map(p => p.count), 1)

  const navAgent = (userId: number) => navigate('/app/insights/qc-agents', { state: { preselectedUserId: userId } })

  const [animateBars, setAnimateBars] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateBars(true))
    return () => { cancelAnimationFrame(id); setAnimateBars(false) }
  }, [byType])

  const PIPELINE_STATUSES = [
    { key: 'DRAFT',             label: 'Draft',             dotCls: 'bg-slate-400'   },
    { key: 'SCHEDULED',         label: 'Scheduled',         dotCls: 'bg-purple-500'  },
    { key: 'DELIVERED',         label: 'Delivered',         dotCls: 'bg-[#00aeef]'   },
    { key: 'AWAITING_SIGNATURE',label: 'Awaiting Signature',dotCls: 'bg-orange-500'  },
    { key: 'SIGNED',            label: 'Signed',            dotCls: 'bg-yellow-500'  },
    { key: 'FOLLOW_UP_PENDING', label: 'Follow-Up Pending', dotCls: 'bg-red-500'     },
    { key: 'CLOSED',            label: 'Closed',            dotCls: 'bg-emerald-500' },
  ]

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={[]}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Performance Warning Status Pipeline" description="Current state of all performance warnings in the selected period.">
            {PIPELINE_STATUSES.map((s, i) => (
              <div key={s.key} className={`flex items-center justify-between py-2 ${i < PIPELINE_STATUSES.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <span className="text-sm font-medium text-slate-700">{s.label}</span>
                <span className={`text-sm font-bold ${(byStatus[s.key] ?? 0) > 0 ? s.dotCls.replace('bg-', 'text-').replace('50', '600') : 'text-slate-300'}`}>
                  {byStatus[s.key] ?? 0}
                </span>
              </div>
            ))}
            <div className="flex justify-between py-2.5 border-t-2 border-slate-200 mt-1">
              <span className="text-sm font-bold text-slate-800">Total Active</span>
              <span className="text-sm font-bold text-slate-800">{pipeline?.total ?? 0}</span>
            </div>
          </InsightsSection>

          <InsightsSection title="Type Distribution" description="Severity breakdown across the escalation path.">
            {[
              { key: 'VERBAL_WARNING',  label: 'Verbal Warning' },
              { key: 'WRITTEN_WARNING', label: 'Written Warning' },
              { key: 'FINAL_WARNING',   label: 'Final Warning' },
            ].map((t, i) => {
              const count = byType[t.key] ?? 0
              const pct   = totalType > 0 ? Math.round((count / totalType) * 100) : 0
              return (
                <div key={t.key} className="mb-3.5">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{t.label}</span>
                    <span className="text-slate-400">{count} ({pct}%)</span>
                  </div>
                  <div className="h-5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full rounded bg-[#00aeef]/70 transition-all duration-700 ease-out"
                      style={{ width: animateBars ? `${pct}%` : '0%', transitionDelay: `${i * 80}ms` }}
                    />
                  </div>
                </div>
              )
            })}
            <div className="mt-3 space-y-0">
              <StatRow label="Avg Days to Closure"  value={fmt(pipeline?.avgDaysToClose, ' days')} />
              <StatRow label="Pending Follow-Ups"   value={String(pipeline?.pendingFollowUps ?? 0)} valueColor={(pipeline?.pendingFollowUps ?? 0) > 0 ? 'text-orange-500' : undefined} />
              <StatRow label="Overdue Follow-Ups"   value={String(pipeline?.overdueFollowUps ?? 0)} valueColor={(pipeline?.overdueFollowUps ?? 0) > 0 ? 'text-red-600' : undefined} />
            </div>
          </InsightsSection>
        </div>

        {/* Active Performance Warnings */}
        <InsightsSection title="Active Performance Warnings" description="Click a row to view the agent's performance profile.">
          {activeWUs.length === 0
            ? <p className="text-sm text-slate-400 text-center py-4">No active performance warnings for this period.</p>
            : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                  {['Agent','Dept','Type','Status','Created','Meeting','Follow-Up','Prior','Policies'].map(h => <th key={h} className="text-left pb-2 font-medium pr-3 last:pr-0">{h}</th>)}
                </tr></thead>
                <tbody>
                  {activeWUs.map(w => (
                    <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-red-50 cursor-pointer" onClick={() => navAgent(w.userId)}>
                      <td className="py-2.5 pr-3 font-medium text-[#00aeef]">{w.agent}</td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">{w.dept}</td>
                      <td className="py-2.5 pr-3"><TypeBadge type={w.type} /></td>
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[w.status] ?? 'bg-slate-300'}`} />
                          <span className="text-xs text-slate-600">{STATUS_LABEL[w.status] ?? w.status}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">{w.date}</td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">{w.meetingDate ?? '—'}</td>
                      <td className={`py-2.5 pr-3 text-xs ${w.followUpDate ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>{w.followUpDate ?? '—'}</td>
                      <td className={`py-2.5 pr-3 font-bold ${w.priorCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{w.priorCount}</td>
                      <td className="py-2.5 text-xs text-slate-500 max-w-[160px] truncate">{w.policies.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>

        {/* Escalation + Repeat Agents */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Escalation Path">
            <div className="flex items-center gap-3 py-3 mb-3">
              {[
                { label: 'Verbal',  count: escalation?.verbal  ?? 0, ring: 'border-yellow-400', bg: 'bg-yellow-50',  text: 'text-yellow-600' },
                { label: 'Written', count: escalation?.written ?? 0, ring: 'border-orange-400', bg: 'bg-orange-50',  text: 'text-orange-600' },
                { label: 'Final',   count: escalation?.final   ?? 0, ring: 'border-red-400',    bg: 'bg-red-50',     text: 'text-red-600'    },
              ].map((b, i) => (
                <span key={b.label} className="flex items-center gap-2">
                  <div className={`${b.bg} border ${b.ring} rounded-lg px-4 py-2.5 text-center min-w-[70px]`}>
                    <div className="text-[11px] text-slate-500">{b.label}</div>
                    <div className={`text-2xl font-bold ${b.text}`}>{b.count}</div>
                  </div>
                  {i < 2 && <span className="text-slate-400 text-lg">→</span>}
                </span>
              ))}
            </div>
            <StatRow label="Escalation Rate" value={fmt(cur.escalation_rate, '%')} />
            <StatRow label="Repeat Offender Rate" value={fmt(cur.repeat_offender_rate, '%')} />
            <StatRow label="Agents on Final Warning" value={String(escalation?.final ?? 0)} valueColor={(escalation?.final ?? 0) > 0 ? 'text-red-600' : undefined} />
          </InsightsSection>

          <InsightsSection title="Repeat Warning Agents" description="Agents with prior performance warnings within the period.">
            {repeatWUs.length === 0
              ? <p className="text-sm text-slate-400 py-4">No repeat agents in this period.</p>
              : repeatWUs.map(w => (
                <div key={w.id} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 hover:bg-red-50 cursor-pointer rounded" onClick={() => navAgent(w.userId)}>
                  <span className="text-sm font-medium text-[#00aeef]">{w.agent}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Prior: {w.priorCount}</span>
                    <span className="text-slate-300">·</span>
                    <TypeBadge type={w.type} />
                    <span className="text-xs text-slate-500">{STATUS_LABEL[w.status] ?? w.status}</span>
                  </div>
                </div>
              ))
            }
          </InsightsSection>
        </div>

        {/* Most Violated Policies */}
        <InsightsSection title="Most Violated Policies" description="Click a policy to see which agents were cited.">
          {policies.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No policy violations data for this period.</p>}
          {policies.map(pol => (
            <ExpandableRow
              key={pol.policy}
              isExpanded={expandedPolicy === pol.policy}
              onToggle={() => setExpandedPolicy(expandedPolicy === pol.policy ? null : pol.policy)}
              summary={
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-800 flex-1 truncate">{pol.policy}</span>
                  <span className="text-xs text-slate-400 shrink-0">{pol.count} violations · {pol.agentCount} agents</span>
                  <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                    <div className={`h-full rounded-full ${pol.count >= 3 ? 'bg-red-400' : pol.count >= 2 ? 'bg-orange-400' : 'bg-[#00aeef]/70'}`} style={{ width: `${(pol.count / maxPolicy) * 100}%` }} />
                  </div>
                </div>
              }
              detail={
                pol.agentDetails.length === 0 ? <p className="text-xs text-slate-400">No agent data available.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-400 border-b border-slate-200">
                      {['Agent','Dept','Type','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {pol.agentDetails.map(a => (
                        <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-white cursor-pointer" onClick={() => navAgent(a.userId)}>
                          <td className="py-1.5 pr-3 font-medium text-[#00aeef]">{a.name}</td>
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
                    <span className={`font-medium ${row.resolutionRate >= 90 ? 'text-emerald-600' : row.resolutionRate >= 75 ? 'text-orange-500' : 'text-red-600'}`}>
                      {fmt(row.resolutionRate, '%')}
                    </span>
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
