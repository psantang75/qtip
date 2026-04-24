import { useState } from 'react'
import { InsightsSection, TrendChart, StatRow, ExpandableRow } from '@/components/insights'
import type { CategoryScore, FormScore, KpiValues, AgentProfile } from '@/services/insightsQCService'
import { scoreColor, fmtN, type TrendPoint } from './agentProfileHelpers'
import { resolveThresholds, type KpiConfig } from '@/hooks/useKpiConfig'

interface Props {
  qaTrend: TrendPoint[]
  qaGoal: number
  qaWarn: number
  cur: KpiValues
  prv: KpiValues
  kpiConfig: KpiConfig | undefined
  formScores: FormScore[]
  catScores: CategoryScore[]
  showAllCats: boolean
  setShowAllCats: (v: boolean) => void
  recentAudits: AgentProfile['recentAudits']
}

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

export default function AgentQualitySection({
  qaTrend, qaGoal, qaWarn, cur, prv, kpiConfig,
  formScores,
  catScores, showAllCats, setShowAllCats,
  recentAudits,
}: Props) {
  // Group this agent's recent reviews by form so each expandable form row
  // can show its own per-review history (matches the past Forms Performance
  // drill-down). Built once per render — recentAudits is already resident.
  const reviewsByForm = new Map<string, AgentProfile['recentAudits']>()
  for (const r of recentAudits ?? []) {
    const list = reviewsByForm.get(r.form) ?? []
    list.push(r)
    reviewsByForm.set(r.form, list)
  }

  // Group categories by form for the Category Performance section. Each form
  // row's summary aggregates its categories' avg score; expanding shows the
  // per-category detail for that form (categories are scoped per form, so
  // grouping mirrors the user's mental model).
  const formsWithCats = (() => {
    const map = new Map<string, { form: string; categories: CategoryScore[] }>()
    for (const c of catScores) {
      if (!map.has(c.form)) map.set(c.form, { form: c.form, categories: [] })
      map.get(c.form)!.categories.push(c)
    }
    return [...map.values()].map(g => {
      const scored = g.categories.filter(c => c.avgScore != null)
      const avg    = scored.length
        ? scored.reduce((sum, c) => sum + (c.avgScore ?? 0), 0) / scored.length
        : null
      const audits = g.categories.reduce((sum, c) => sum + c.audits, 0)
      return { ...g, avgScore: avg, audits }
    }).sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
  })()
  const visibleForms = showAllCats ? formsWithCats : formsWithCats.slice(0, 5)

  const [expandedFormScores, setExpandedFormScores] = useState<number | null>(null)
  const [expandedCatForm,    setExpandedCatForm]    = useState<string | null>(null)

  return (
    <>
      <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-primary">Quality</div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection title="QA Score Trend" infoKpiCodes={['qa_score_trend']}>
          {qaTrend.length > 0
            ? <TrendChart data={qaTrend} color="#00aeef" goalValue={qaGoal} height={120} metricLabel="%" />
            : <p className="text-sm text-slate-400 py-6 text-center">No QA score data in the last 6 months.</p>
          }
        </InsightsSection>

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
      </div>

      <InsightsSection title="Timeliness">
        {([
          ['Avg Time to Audit',           'time_to_audit',                cur.time_to_audit,                prv.time_to_audit],
          ['Avg Dispute Resolution Time', 'avg_dispute_resolution_time',  cur.avg_dispute_resolution_time,  prv.avg_dispute_resolution_time],
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

      {/* Average Score by Form — expandable per-review drill-down for this
          agent. Matches the previous Forms Performance layout and the
          Top Missed Questions visual language. */}
      <InsightsSection title="Average Score by Form" infoKpiCodes={['avg_score_by_form']}>
        {formScores.length === 0
          ? <p className="text-sm text-slate-400 text-center py-4">No form data for this period.</p>
          : formScores.map(row => {
              const reviews = reviewsByForm.get(row.form) ?? []
              const isExp   = expandedFormScores === row.id
              return (
                <ExpandableRow
                  key={row.id}
                  isExpanded={isExp}
                  onToggle={() => setExpandedFormScores(isExp ? null : row.id)}
                  summary={
                    <div className="flex items-center flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{row.form}</span>
                      <span className="text-xs text-slate-700 shrink-0">{row.submissions} Reviews</span>
                      <span className={`text-sm font-bold shrink-0 ml-4 ${scoreColor(row.avgScore, qaGoal, qaWarn)}`}>{fmtN(row.avgScore, '%')} Average</span>
                    </div>
                  }
                  detail={
                    reviews.length === 0 ? (
                      <p className="text-xs text-slate-400">No recent reviews on this form.</p>
                    ) : (
                      <div className="pt-1">
                        <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                          <span className="w-20 shrink-0">Review ID</span>
                          <span className="w-28 shrink-0">Review Date</span>
                          <span className="w-28 shrink-0">Interaction Date</span>
                          <span className="w-16 shrink-0 text-right">Score</span>
                        </div>
                        {reviews.map(r => (
                          <div key={r.id} className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                            <span className="w-20 shrink-0 text-slate-400">#{r.id}</span>
                            <span className="w-28 shrink-0 text-slate-700">{r.date}</span>
                            <span className="w-28 shrink-0 text-slate-400">{r.callDate ?? '—'}</span>
                            <span className={`w-16 shrink-0 text-right font-semibold ${scoreColor(r.score, qaGoal, qaWarn)}`}>{r.score != null ? `${r.score.toFixed(1)}%` : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )
                  }
                />
              )
            })
        }
      </InsightsSection>

      {/* Category Performance — grouped by form. Each row is a form whose
          summary shows its average category score; expanding reveals this
          agent's score on every category within that form. */}
      <InsightsSection title="Category Performance" infoKpiCodes={['category_performance']}>
        {formsWithCats.length === 0
          ? <p className="text-sm text-slate-400 text-center py-4">No category data for the selected period.</p>
          : visibleForms.map(group => {
              const isExp = expandedCatForm === group.form
              return (
                <ExpandableRow
                  key={group.form}
                  isExpanded={isExp}
                  onToggle={() => setExpandedCatForm(isExp ? null : group.form)}
                  summary={
                    <div className="flex items-center flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{group.form}</span>
                      <span className="text-xs text-slate-700 shrink-0">{group.categories.length} Categories</span>
                      <span className={`text-sm font-bold shrink-0 ml-4 ${scoreColor(group.avgScore, qaGoal, qaWarn)}`}>{fmtN(group.avgScore, '%')} Average</span>
                    </div>
                  }
                  detail={
                    <div className="pt-1">
                      <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                        <span className="flex-1 min-w-0">Category</span>
                        <span className="w-20 shrink-0 text-right">Reviews</span>
                        <span className="w-20 shrink-0 text-right">Score</span>
                        <span className="w-16 shrink-0 text-right">vs Goal</span>
                      </div>
                      {[...group.categories].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0)).map((c, i) => {
                        const delta = c.avgScore != null ? c.avgScore - qaGoal : null
                        return (
                          <div key={c.categoryId ?? `${c.category}-${i}`} className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                            <span className="flex-1 min-w-0 truncate text-slate-800">{c.category}</span>
                            <span className="w-20 shrink-0 text-right text-slate-500">{c.audits}</span>
                            <span className={`w-20 shrink-0 text-right font-semibold ${scoreColor(c.avgScore, qaGoal, qaWarn)}`}>{fmtN(c.avgScore, '%')}</span>
                            <span className={`w-16 shrink-0 text-right font-medium ${delta == null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {delta == null ? '—' : delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                            </span>
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
          <button onClick={() => setShowAllCats(!showAllCats)} className="mt-3 text-xs text-primary hover:underline">
            {showAllCats ? 'Show bottom 5 only' : `Show all ${formsWithCats.length} forms`}
          </button>
        )}
      </InsightsSection>
    </>
  )
}
