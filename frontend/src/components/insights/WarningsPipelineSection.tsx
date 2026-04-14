import { useEffect, useState } from 'react'
import { InsightsSection, StatRow } from '@/components/insights'

interface PipelineData {
  total: number
  byStatus: Record<string, number>
  byType: Record<string, number>
  avgDaysToClose: number | null
  pendingFollowUps: number
  overdueFollowUps: number
}

interface Props {
  pipeline: PipelineData | undefined
}

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

const PIPELINE_STATUSES = [
  { key: 'DRAFT',              label: 'Draft' },
  { key: 'SCHEDULED',          label: 'Scheduled' },
  { key: 'AWAITING_SIGNATURE', label: 'Awaiting Signature' },
  { key: 'SIGNED',             label: 'Signed' },
  { key: 'FOLLOW_UP_PENDING',  label: 'Follow-Up Pending' },
  { key: 'CLOSED',             label: 'Closed' },
]

export default function WarningsPipelineSection({ pipeline }: Props) {
  const byStatus  = pipeline?.byStatus ?? {}
  const byType    = pipeline?.byType   ?? {}
  const totalType = Object.values(byType).reduce((a, b) => a + b, 0)

  const [animateBars, setAnimateBars] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateBars(true))
    return () => { cancelAnimationFrame(id); setAnimateBars(false) }
  }, [byType])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <InsightsSection title="Status Pipeline">
        {PIPELINE_STATUSES.map((s, i) => (
          <div key={s.key} className={`flex items-center justify-between py-2 ${i < PIPELINE_STATUSES.length - 1 ? 'border-b border-slate-100' : ''}`}>
            <span className="text-sm font-medium text-slate-700">{s.label}</span>
            <span className={`text-sm font-bold ${(byStatus[s.key] ?? 0) > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
              {byStatus[s.key] ?? 0}
            </span>
          </div>
        ))}
        <div className="flex justify-between py-2.5 border-t-2 border-slate-200 mt-1">
          <span className="text-sm font-bold text-slate-800">Total Active</span>
          <span className="text-sm font-bold text-slate-800">{pipeline?.total ?? 0}</span>
        </div>
      </InsightsSection>

      <InsightsSection title="Type Distribution">
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
                  className="h-full rounded bg-primary/70 transition-all duration-700 ease-out"
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
  )
}
