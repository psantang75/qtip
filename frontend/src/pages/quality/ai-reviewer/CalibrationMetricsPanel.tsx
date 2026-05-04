/**
 * CalibrationMetricsPanel — read-only metrics + recent diffs for one
 * AI-enabled form. Used by the AI Reviewer per-form management page.
 *
 * UI sections:
 *   1. Rolling stats — overall agreement, sample count, oldest data
 *      point, drift snapshot, and per-question agreement bars
 *   2. Recent diffs — last N (default 20) rows with AI-vs-Human
 *
 * No mutations. Settings (mode, guidance, sampling) live in the
 * surrounding Settings card on the parent page.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RcTooltip, Cell } from 'recharts'
import aiReviewerService, { type CalibrationDataPoint } from '@/services/aiReviewerService'
import { Progress } from '@/components/ui/progress'

const ROLLING_WINDOW = 50
const RECENT_LIMIT = 20

interface Props {
  formId: number
}

function pctOrDash(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return `${Math.round(v * 1000) / 10}%`
}

export function CalibrationMetricsPanel({ formId }: Props) {
  const metricsQ = useQuery({
    queryKey: ['ai-calibration-metrics', formId],
    queryFn: () => aiReviewerService.getCalibrationMetrics(formId, ROLLING_WINDOW),
    staleTime: 30 * 1000,
  })
  const recentQ = useQuery({
    queryKey: ['ai-calibration-recent', formId],
    queryFn: () => aiReviewerService.getCalibrationRecent(formId, RECENT_LIMIT),
    staleTime: 30 * 1000,
  })

  const metrics = metricsQ.data
  const recent = recentQ.data ?? []

  return (
    <div className="space-y-5">
      {/* ── 1. Rolling stats ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
          Rolling Agreement (last {ROLLING_WINDOW})
        </h2>
        {metricsQ.isLoading ? (
          <div className="h-12 bg-slate-100 animate-pulse rounded" />
        ) : metricsQ.isError ? (
          <p className="text-[13px] text-red-600">Failed to load metrics.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Stat
              label="Cohen's κ"
              value={kappaOrDash(metrics?.overall_kappa ?? null)}
              accent={kappaAccent(metrics?.overall_kappa ?? null)}
              hint="Chance-corrected agreement. >0.6 substantial · 0.4–0.6 moderate · <0.4 fair-or-worse."
            />
            <Stat
              label="Raw agreement"
              value={pctOrDash(metrics?.overall_agreement ?? null)}
              accent={agreementAccent(metrics?.overall_agreement ?? null)}
            />
            <Stat label="Sample size" value={String(metrics?.sample_count ?? 0)} />
            <Stat
              label="Oldest in window"
              value={metrics?.oldest_in_window_at ? new Date(metrics.oldest_in_window_at).toLocaleDateString() : '—'}
            />
            <Stat label="Last 30 days" value={String(metrics?.last_30d_count ?? 0)} />
          </div>
        )}

        {/* Drift comparison: rolling vs larger window */}
        {metrics?.drift_compare && metrics.overall_agreement != null && metrics.drift_compare.overall_agreement != null && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-[12px] font-semibold text-slate-700 mb-2 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Drift snapshot
            </h3>
            <div className="h-28">
              <ResponsiveContainer>
                <BarChart
                  data={[
                    { label: `Last ${metrics.window_size}`, agreement: Math.round((metrics.overall_agreement ?? 0) * 100) },
                    { label: `Last ${metrics.drift_compare.window_size}`, agreement: Math.round((metrics.drift_compare.overall_agreement ?? 0) * 100) },
                  ]}
                  margin={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                  <RcTooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="agreement" radius={[4, 4, 0, 0]} maxBarSize={56}>
                    {[
                      driftBarColor(metrics.overall_agreement ?? 0),
                      driftBarColor(metrics.drift_compare.overall_agreement ?? 0),
                    ].map((c, i) => (
                      <Cell key={i} fill={c} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              If the recent window is materially below the longer one, expect the AI's behavior to be drifting — review recent diffs and your KB changes.
            </p>
          </div>
        )}

        {/* Per-question breakdown */}
        {metrics?.per_question_agreement && metrics.per_question_agreement.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-[12px] font-semibold text-slate-700 mb-2">Per-question agreement</h3>
            <ul className="space-y-1.5">
              {metrics.per_question_agreement
                .slice()
                .sort((a, b) => a.agreement - b.agreement)
                .map((q) => (
                  <li key={q.question_id} className="flex items-center gap-3 text-[12px]">
                    <span className="font-mono text-slate-500 w-16 shrink-0">Q{q.question_id}</span>
                    <Progress value={q.agreement * 100} className="flex-1 h-2" />
                    <span className={'w-12 text-right font-mono ' + (q.agreement < 0.8 ? 'text-amber-700' : 'text-slate-700')}>
                      {pctOrDash(q.agreement)}
                    </span>
                    <span className="w-10 text-right text-slate-400">n={q.n}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 2. Recent diffs ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-[14px] font-semibold text-slate-900 mb-3">
          Recent calibration data points
        </h2>
        {recentQ.isLoading ? (
          <div className="h-24 bg-slate-100 animate-pulse rounded" />
        ) : recent.length === 0 ? (
          <p className="text-[12px] text-slate-500">No calibration rows yet — promote AI drafts or re-audit Trusted-mode samples to populate this list.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => (
              <RecentRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: string
  accent?: 'good' | 'warn' | 'bad'
  hint?: string
}) {
  const color =
    accent === 'good'
      ? 'text-emerald-700'
      : accent === 'warn'
        ? 'text-amber-700'
        : accent === 'bad'
          ? 'text-red-700'
          : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" title={hint ?? undefined}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={'text-lg font-bold ' + color}>{value}</div>
    </div>
  )
}

function agreementAccent(v: number | null | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (v == null || !isFinite(v)) return undefined
  if (v >= 0.9) return 'good'
  if (v >= 0.8) return 'warn'
  return 'bad'
}

function kappaOrDash(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toFixed(2)
}

function kappaAccent(v: number | null | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (v == null || !isFinite(v)) return undefined
  if (v >= 0.6) return 'good'
  if (v >= 0.4) return 'warn'
  return 'bad'
}

function driftBarColor(v: number): string {
  if (v >= 0.9) return '#10b981'
  if (v >= 0.8) return '#f59e0b'
  return '#ef4444'
}

function RecentRow({ row }: { row: CalibrationDataPoint }) {
  const ai = row.ai_answers ?? {}
  const human = row.human_answers ?? {}
  const diffs: Array<{ qid: string; ai: string; human: string }> = []
  for (const qid of Object.keys(human)) {
    const aVal = (ai[qid] ?? '').trim().toLowerCase()
    const hVal = (human[qid] ?? '').trim().toLowerCase()
    if (aVal !== hVal) diffs.push({ qid, ai: ai[qid] ?? '', human: human[qid] ?? '' })
  }
  return (
    <li className="py-2 flex items-start gap-3">
      <div className="w-20 shrink-0 text-[11px] text-slate-500">
        <div className="font-mono">#{row.id}</div>
        <div>{new Date(row.created_at).toLocaleDateString()}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-mono text-slate-700">Ticket {row.ticket_id}</span>
          <span className="text-[10px] text-slate-400 uppercase">{row.source.replace(/_/g, ' ')}</span>
          {row.ai_answers == null && (
            <span className="text-[10px] text-slate-400 italic">no AI run yet</span>
          )}
        </div>
        {diffs.length === 0 && row.ai_answers != null && (
          <div className="text-[12px] text-emerald-700 inline-flex items-center gap-1 mt-0.5">
            <CheckCircle2 className="h-3 w-3" /> Full agreement
          </div>
        )}
        {diffs.length > 0 && (
          <ul className="text-[11px] text-slate-700 mt-0.5 space-y-0.5">
            {diffs.slice(0, 5).map((d) => (
              <li key={d.qid} className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                <span className="font-mono text-slate-500 w-12 shrink-0">Q{d.qid}</span>
                <span className="text-slate-400">AI:</span>
                <span className="font-mono">{d.ai || '∅'}</span>
                <span className="text-slate-400">Human:</span>
                <span className="font-mono">{d.human || '∅'}</span>
              </li>
            ))}
            {diffs.length > 5 && (
              <li className="text-slate-400 italic pl-5">…and {diffs.length - 5} more</li>
            )}
          </ul>
        )}
      </div>
    </li>
  )
}
