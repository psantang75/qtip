/**
 * Latest golden-set eval run card.
 *
 * Shows the most recent ai_eval_runs row for the form: kappa,
 * pass/fail vs. previous, golden-set size, trigger source. The
 * "View results" button opens a drawer with per-question breakdown
 * for each evaluated submission so a regression can be diagnosed
 * without re-running.
 *
 * Empty-state-safe: when no eval has ever run, prompts the user to
 * either click "Run eval now" or wait for the next prompt change to
 * trigger one automatically.
 */

import { useState } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  PlayCircle,
} from 'lucide-react'
import aiReviewerService, {
  type EvalRunPerSubmission,
  type LatestEvalRun,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Props {
  formId: number
}

function fmtKappa(k: number | null | undefined): string {
  if (k == null) return '—'
  if (Number.isNaN(k)) return 'n/a'
  return k.toFixed(3)
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function LatestEvalRunCard({ formId }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const latestQ = useQuery({
    queryKey: ['ai-reviewer-eval-latest', formId],
    queryFn: () => aiReviewerService.getLatestEvalRun(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  const runMut = useMutation({
    mutationFn: () => aiReviewerService.runEvalManual(formId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-eval-latest', formId] })
      toast({
        title: data.pass ? 'Eval passed' : 'Eval regressed',
        description: `kappa = ${fmtKappa(data.overall_kappa)} on ${data.evaluated_count} of ${data.golden_set_count} golden submissions.`,
        variant: data.pass ? 'default' : 'destructive',
      })
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: "Couldn't run eval",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  const latest = latestQ.data ?? null

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-primary" />
            Golden-set regression eval
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Replays the held-out golden submissions through the current prompt + packs and computes Cohen's kappa. Runs
            automatically when you change a rule pack or per-form guidance, or click below.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="text-[12px] shrink-0"
        >
          {runMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1" />}
          Run eval now
        </Button>
      </div>

      <div className="p-4">
        {latestQ.isLoading ? (
          <div className="h-12 bg-slate-100 animate-pulse rounded" />
        ) : !latest ? (
          <p className="text-[12px] text-slate-400 italic">
            No eval run yet. Once you have a few golden submissions, the next rule-pack edit (or the button above) will
            produce a kappa baseline.
          </p>
        ) : (
          <SummaryGrid latest={latest} />
        )}
        {latest && (
          <div className="mt-3">
            <button
              type="button"
              className="text-[12px] text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
              onClick={() => setOpen(!open)}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {open ? 'Hide per-submission results' : 'View per-submission results'}
            </button>
            {open && (
              <div className="mt-2 max-h-[360px] overflow-y-auto rounded-md border border-slate-200">
                <ul className="divide-y divide-slate-100">
                  {(latest.results_json?.per_submission ?? []).map((s: EvalRunPerSubmission) => (
                    <SubmissionRow
                      key={s.submission_id}
                      s={s}
                      isExpanded={expanded.has(s.submission_id)}
                      onToggle={() => {
                        const next = new Set(expanded)
                        if (next.has(s.submission_id)) next.delete(s.submission_id)
                        else next.add(s.submission_id)
                        setExpanded(next)
                      }}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function SummaryGrid({ latest }: { latest: LatestEvalRun }) {
  const passColor = latest.pass ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'
  const PassIcon = latest.pass ? CheckCircle2 : AlertTriangle
  const prevK = latest.results_json?.prev_overall_kappa ?? null
  const delta = prevK != null && latest.overall_kappa != null ? latest.overall_kappa - prevK : null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <div className="text-[11px] text-slate-500">Overall kappa</div>
        <div className="text-[18px] font-mono font-semibold text-slate-900">{fmtKappa(latest.overall_kappa)}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-500">Δ vs previous</div>
        <div className={'text-[14px] font-mono ' + (delta != null && delta < 0 ? 'text-rose-600' : 'text-emerald-700')}>
          {delta == null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(3)}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-slate-500">Golden submissions</div>
        <div className="text-[14px] font-mono text-slate-800">{latest.golden_set_count}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-500">Status</div>
        <span className={'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + passColor}>
          <PassIcon className="h-3 w-3" />
          {latest.pass ? 'PASS' : 'REGRESSION'}
        </span>
      </div>
      <div className="col-span-2 sm:col-span-4 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
        Last ran {fmtDateTime(latest.ran_at)} · trigger: <span className="font-mono">{latest.triggered_by}</span> ·
        prompt hash: <span className="font-mono">{latest.prompt_hash.slice(0, 12)}…</span>
      </div>
    </div>
  )
}

function SubmissionRow({
  s,
  isExpanded,
  onToggle,
}: {
  s: EvalRunPerSubmission
  isExpanded: boolean
  onToggle: () => void
}) {
  const isSkipped = s.status === 'skipped'
  return (
    <li className="px-3 py-2 text-[12px]">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="text-slate-700 truncate">
            submission #{s.submission_id}
            {s.ticket_id != null && <span className="text-slate-400"> · ticket {s.ticket_id}</span>}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isSkipped ? (
            <span className="text-[11px] text-amber-700 italic">{s.reason ?? 'skipped'}</span>
          ) : (
            <>
              <span className="font-mono text-slate-700">κ {fmtKappa(s.kappa)}</span>
              {typeof s.kb_citation_count === 'number' && (
                <span className="text-slate-400">{s.kb_citation_count} KB</span>
              )}
            </>
          )}
        </div>
      </button>
      {isExpanded && !isSkipped && (
        <div className="mt-2 space-y-3">
          {s.questions && s.questions.length > 0 && (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="font-medium pb-1">Question</th>
                  <th className="font-medium pb-1">Golden</th>
                  <th className="font-medium pb-1">AI</th>
                  <th className="font-medium pb-1">Conf</th>
                  <th className="font-medium pb-1 text-right">Match</th>
                </tr>
              </thead>
              <tbody>
                {s.questions.map((q) => (
                  <tr key={q.question_id} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-slate-700 max-w-[260px] truncate" title={q.question_text}>
                      {q.question_text}
                    </td>
                    <td className="py-1 pr-2 font-mono text-emerald-700">{q.golden_value}</td>
                    <td className={'py-1 pr-2 font-mono ' + (q.match ? 'text-slate-700' : 'text-rose-700')}>
                      {q.ai_value || '(empty)'}
                    </td>
                    <td className="py-1 pr-2 text-slate-500">
                      {q.ai_confidence != null ? q.ai_confidence.toFixed(2) : '—'}
                    </td>
                    <td className="py-1 text-right">
                      {q.match ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600 inline" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Phase 7c — confidence summary (nominal + calibrated) */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 border-t border-slate-100 pt-2">
            <span>
              overall confidence: <span className="font-mono text-slate-800">
                {s.ai_overall_confidence != null ? s.ai_overall_confidence.toFixed(2) : '—'}
              </span>
            </span>
            <span>
              calibrated:{' '}
              <span className="font-mono text-slate-800">
                {s.ai_calibrated_confidence != null ? s.ai_calibrated_confidence.toFixed(2) : '—'}
              </span>
            </span>
            {typeof s.timeline_step_count === 'number' && (
              <span>timeline steps: <span className="font-mono">{s.timeline_step_count}</span></span>
            )}
            {typeof s.observation_count === 'number' && (
              <span>observations: <span className="font-mono">{s.observation_count}</span></span>
            )}
          </div>

          {s.kb_citations && s.kb_citations.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                KB citations ({s.kb_citations.length})
              </summary>
              <ul className="mt-1 list-disc pl-5 text-slate-600 space-y-0.5">
                {s.kb_citations.map((c) => (
                  <li key={c.id}>
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {c.name}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {s.timeline && s.timeline.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                AI-reconstructed timeline ({s.timeline.length})
              </summary>
              <ol className="mt-1 list-decimal pl-5 text-slate-600 space-y-0.5">
                {s.timeline.map((t) => (
                  <li key={t.step}>{t.description}</li>
                ))}
              </ol>
            </details>
          )}

          {s.observations && s.observations.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                Observations ({s.observations.length})
              </summary>
              <ul className="mt-1 list-disc pl-5 text-slate-600 space-y-0.5">
                {s.observations.map((o, i) => (
                  <li key={i}>
                    {o.category && <span className="text-slate-400 mr-1">[{o.category}]</span>}
                    {o.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  )
}
