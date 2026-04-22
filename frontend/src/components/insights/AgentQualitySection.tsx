import { InsightsSection, TrendChart, StatRow, ExpandableRow, StatusBadge } from '@/components/insights'
import type { CategoryScore } from '@/services/insightsQCService'
import type { FormSummaryItem, TrendPoint } from './agentProfileHelpers'
import { scoreColor, fmtN } from './agentProfileHelpers'

interface Props {
  qaTrend: TrendPoint[]
  qaGoal: number
  qaWarn: number
  ds: { total: number; upheld: number; adjusted: number; open: number; avgResolutionDays: number | null } | undefined
  formSummary: FormSummaryItem[]
  expandedForm: string | null
  setExpandedForm: (v: string | null) => void
  catScores: CategoryScore[]
  showAllCats: boolean
  setShowAllCats: (v: boolean) => void
}

export default function AgentQualitySection({
  qaTrend, qaGoal, qaWarn, ds, formSummary, expandedForm, setExpandedForm, catScores, showAllCats, setShowAllCats,
}: Props) {
  return (
    <>
      <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-primary">Quality</div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection title="QA Score Trend (6 Months)">
          {qaTrend.length > 0
            ? <TrendChart data={qaTrend} color="#00aeef" goalValue={qaGoal} height={110} metricLabel="%" />
            : <p className="text-sm text-slate-400 py-6 text-center">No QA score data in the last 6 months.</p>
          }
        </InsightsSection>
        <InsightsSection title="Dispute Activity">
          <StatRow label="Total Disputes Filed"           value={String(ds?.total ?? 0)} valueColor={(ds?.total ?? 0) > 0 ? 'text-orange-500' : 'text-emerald-600'} />
          <StatRow label="Disputes Upheld"                value={String(ds?.upheld ?? 0)} />
          <StatRow label="Disputes Adjusted"              value={String(ds?.adjusted ?? 0)} />
          <StatRow label="Open"                           value={String(ds?.open ?? 0)} valueColor={(ds?.open ?? 0) > 0 ? 'text-orange-500' : undefined} />
          <StatRow label="Avg Resolution Time"            value={fmtN(ds?.avgResolutionDays, ' days')} />
        </InsightsSection>
      </div>

      <InsightsSection title="Forms Performance">
        {formSummary.length === 0 && <p className="text-sm text-slate-400 py-3">No evaluations in this period.</p>}
        {formSummary.map(f => (
          <ExpandableRow
            key={f.form} isExpanded={expandedForm === f.form}
            onToggle={() => setExpandedForm(expandedForm === f.form ? null : f.form)}
            summary={
              <div className="flex items-center flex-1 min-w-0">
                <span className="font-medium text-slate-800 flex-1 truncate">{f.form}</span>
                <span className="text-xs text-slate-700 shrink-0">{f.count} Reviews</span>
                <span className={`text-sm font-bold shrink-0 ml-4 ${scoreColor(f.avg, qaGoal, qaWarn)}`}>{fmtN(f.avg, '%')} Average</span>
              </div>
            }
            detail={
              <div className="pt-1">
                <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                  <span className="w-20 shrink-0">Review ID</span><span className="w-28 shrink-0">Review Date</span><span className="w-28 shrink-0">Interaction Date</span><span className="w-16 shrink-0 text-right">Score</span>
                </div>
                {f.reviews.map(r => (
                  <div key={r.id} className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <span className="w-20 shrink-0 text-slate-400">#{r.id}</span>
                    <span className="w-28 shrink-0 text-slate-700">{r.date}</span>
                    <span className="w-28 shrink-0 text-slate-400">{r.callDate ?? '—'}</span>
                    <span className={`w-16 shrink-0 text-right font-semibold ${scoreColor(r.score, qaGoal, qaWarn)}`}>{r.score != null ? `${r.score.toFixed(1)}%` : '—'}</span>
                  </div>
                ))}
              </div>
            }
          />
        ))}
      </InsightsSection>

      <InsightsSection title="Category Performance">
        {catScores.length === 0 ? <p className="text-sm text-slate-400 py-2">No category data.</p> : (() => {
          const sorted = [...catScores].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
          const visible = showAllCats ? sorted : sorted.slice(0, 5)
          return (
            <>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                  {['Category','Form','Audits','Avg Score','vs Goal','Status'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>)}
                </tr></thead>
                <tbody>
                  {visible.map((c, i) => {
                    const delta = c.avgScore != null ? c.avgScore - qaGoal : null
                    return (
                      <tr key={`${c.form}-${c.category}-${i}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-medium text-slate-800">{c.category}</td>
                        <td className="py-2 pr-4 text-slate-500 text-xs">{c.form}</td>
                        <td className="py-2 pr-4 text-slate-500">{c.audits}</td>
                        <td className={`py-2 pr-4 font-semibold ${scoreColor(c.avgScore, qaGoal, qaWarn)}`}>{fmtN(c.avgScore, '%')}</td>
                        <td className={`py-2 pr-4 font-medium ${delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{delta != null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}</td>
                        <td className="py-2"><StatusBadge label={!delta || delta >= 0 ? 'On Track' : c.avgScore != null && c.avgScore >= qaWarn ? 'Near Goal' : 'Below Goal'} variant={!delta || delta >= 0 ? 'good' : c.avgScore != null && c.avgScore >= qaWarn ? 'warning' : 'bad'} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {sorted.length > 5 && (
                <button onClick={() => setShowAllCats(!showAllCats)} className="mt-3 text-xs text-primary hover:underline">
                  {showAllCats ? 'Show bottom 5 only' : `Show all ${sorted.length} categories`}
                </button>
              )}
            </>
          )
        })()}
      </InsightsSection>
    </>
  )
}
