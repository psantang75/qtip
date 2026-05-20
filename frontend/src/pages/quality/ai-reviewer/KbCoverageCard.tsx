/**
 * KbCoverageCard — Tier-2 Item 4 KB Coverage dashboard.
 *
 * Reads `/api/ai-reviewer/forms/:formId/kb-coverage` and surfaces
 * which pivots from the case pivot detector are routinely returning
 * zero KB pages. A pivot flagged `gap: true` (cases >= 3 AND
 * avg_kb_hits < 1) gets the destructive-red treatment so the
 * Knowledge team can see at a glance which content holes to author
 * pages for.
 *
 * Mirrors the patterns from `CalibrationMapPanel` (TanStack Query,
 * the same card / table chrome). No new shadcn primitives — just the
 * existing `bg-destructive/10 text-destructive` classes the design
 * doc carves out for content gaps.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BookOpenCheck, Loader2 } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'

interface Props {
  formId: number
}

export function KbCoverageCard({ formId }: Props) {
  const coverageQ = useQuery({
    queryKey: ['ai-reviewer-kb-coverage', formId],
    queryFn: () => aiReviewerService.getKbCoverage(formId, 30),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 60 * 1000,
  })

  const data = coverageQ.data
  const pivots = data?.pivots ?? []
  const gapCount = pivots.filter((p) => p.gap).length

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <BookOpenCheck className="h-4 w-4 text-primary" />
            KB coverage by pivot
          </h3>
          <p className="mt-1 text-sm text-neutral-700">
            Topical pivots the AI Reviewer detected on recent cases (last{' '}
            {data?.window_days ?? 30} days) and how many KB pages each pivot's
            search returned. Pivots that fire often but find no KB pages are
            likely content gaps the Knowledge team should address.
          </p>
        </div>
        {data && (
          <div className="shrink-0 text-right text-xs text-neutral-700">
            <div>{data.total_cases} cases</div>
            {gapCount > 0 && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 font-semibold text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {gapCount} gap{gapCount === 1 ? '' : 's'}
              </div>
            )}
          </div>
        )}
      </header>

      {coverageQ.isLoading && (
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading KB coverage…
        </div>
      )}

      {coverageQ.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load KB coverage. Try again in a moment.
        </div>
      )}

      {!coverageQ.isLoading && !coverageQ.isError && pivots.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-neutral-700">
          No pivot data yet. The KB coverage rollup populates as the AI
          Reviewer runs cases through the pivot detector — give it a few
          submissions or a longer window.
        </div>
      )}

      {pivots.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-neutral-700">
              <th className="px-2 py-2 font-medium">Pivot</th>
              <th className="px-2 py-2 text-right font-medium">Cases</th>
              <th className="px-2 py-2 text-right font-medium">Avg KB hits</th>
              <th className="px-2 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pivots.map((p) => (
              <tr
                key={p.label}
                className={
                  p.gap
                    ? 'border-b border-destructive/20 bg-destructive/10'
                    : 'border-b border-slate-100'
                }
              >
                <td
                  className={
                    'px-2 py-2 font-medium ' +
                    (p.gap ? 'text-destructive' : 'text-neutral-900')
                  }
                >
                  {p.label}
                </td>
                <td className="px-2 py-2 text-right text-neutral-900">{p.cases}</td>
                <td className="px-2 py-2 text-right text-neutral-900">
                  {p.avg_kb_hits.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right">
                  {p.gap ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-1 text-xs font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      Content gap
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-700">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
