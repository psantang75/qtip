/**
 * Score breakdown tables — the canonical "Question Scores" + "Category
 * Scores" rendering used by the Form Builder Preview step and the
 * AuditFormPage Score Breakdown modal (AI draft review).
 *
 * Why this is its own component:
 *   - Form Builder Preview and AuditFormPage need the SAME breakdown
 *     view so reviewers + form authors see identical math. Inlining
 *     the markup in two places drifted before; one shared component
 *     makes drift impossible.
 *   - The breakdown is purely a function of the form spec, the
 *     reviewer's current answers, and the visibility map. No backend
 *     dependency (unlike `ScoreRenderer`, which expects a persisted
 *     `scoreBreakdown` payload). That makes it safe to render for an
 *     un-submitted draft (the AI Reviewer flow), the form-builder
 *     preview, or any future "live score" surface.
 *
 * Inputs intentionally mirror what every consumer already maintains in
 * local state — there's no extra computation, just rendering.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { scoreColor } from '@/services/qaService';
import { getMaxPossibleScore } from '@/utils/forms/scoringEngine';
import type { Form } from '@/types/form.types';
import type { CategoryRenderData, FormRenderData } from '@/utils/forms';

interface AnswerLike {
  question_id: number;
  answer: string;
  score: number;
  notes?: string;
}

/**
 * Display-format an answer value: Yes/No/N/A get the canonical
 * capitalization, everything else (radio option values, scale numbers,
 * free text) is passed through verbatim. Mirrors what FormRenderer
 * shows in the question UI so the breakdown reads consistently.
 */
function formatAnswerForDisplay(raw: string | undefined | null): string {
  if (raw == null) return '—';
  const trimmed = String(raw).trim();
  if (!trimmed) return '—';
  const lower = trimmed.toLowerCase();
  if (lower === 'yes') return 'Yes';
  if (lower === 'no') return 'No';
  if (lower === 'n/a' || lower === 'na') return 'N/A';
  return trimmed;
}

interface ScoreBreakdownTablesProps {
  /** The source form (used to look up max possible scores for each question). */
  form: Form;
  /** prepareFormForRender output — provides categoryScores aggregates and the
   *  CategoryRenderData[] used to drive the per-question rows. */
  formRenderData: FormRenderData;
  /** Current answers state, keyed by question_id. */
  answers: Record<number, AnswerLike>;
  /** Visibility map from processConditionalLogic. Hidden questions render
   *  with a "Visible: No" badge and contribute 0 to the math. */
  visibilityMap: Record<number, boolean>;
  /** Optional override for the displayed final score (e.g. when caller
   *  has already computed `totalScore` from `calculateFormScore`).
   *  Defaults to recomputing from categoryScores so the totals row is
   *  always internally consistent. */
  finalScoreOverride?: number;
}

export function ScoreBreakdownTables({
  form,
  formRenderData,
  answers,
  visibilityMap,
  finalScoreOverride,
}: ScoreBreakdownTablesProps) {
  if (!formRenderData?.categories) {
    return (
      <div className="p-4 text-[13px] text-slate-400 text-center">
        No score data available.
      </div>
    );
  }

  // Pre-flatten the form's questions once so the per-row max-score
  // lookup doesn't re-traverse `form.categories` on every render.
  const allFormQuestions = React.useMemo(
    () => form.categories.flatMap((c) => c.questions),
    [form.categories],
  );

  return (
    <div className="space-y-3">

      {/* ── Question Scores table ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-800">Question Scores</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium text-slate-600">Question</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Answer</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Score</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Visible</th>
              </tr>
            </thead>
            <tbody>
              {(formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                const scoringQs = (cat.allQuestions || []).filter((q: any) => {
                  const t = (q.type || q.question_type || '').toLowerCase();
                  return !['text', 'sub_category', 'info_block'].includes(t);
                });
                if (!scoringQs.length) return null;
                return (
                  <React.Fragment key={`cat-${ci}`}>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={7} className="px-3 py-2 font-semibold text-slate-700">
                        <div className="flex justify-between">
                          <span>{cat.name}</span>
                          <span className="font-normal text-slate-500">
                            Weight: {(cat.weight * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                    {scoringQs.map((q: any, qi: number) => {
                      const ans = answers[q.id];
                      const vis = visibilityMap[q.id] !== false;
                      const qScore = Number(ans?.score) || 0;
                      // Resolve the source-of-truth question once so we
                      // can pull both the max-score AND `is_critical`
                      // off the same record (the prepared render data
                      // sometimes loses those flags during shaping).
                      const orig = allFormQuestions.find((x: any) => x.id === q.id);
                      let maxScore = 0;
                      if (vis && orig) {
                        const isNA =
                          ans?.answer?.toLowerCase() === 'na' ||
                          ans?.answer?.toLowerCase() === 'n/a';
                        maxScore = isNA && orig.is_na_allowed ? 0 : getMaxPossibleScore(orig);
                      }
                      const isCritical =
                        (orig as any)?.is_critical === true ||
                        (orig as any)?.is_critical === 1 ||
                        q.isCritical === true;
                      const rawAns = String(ans?.answer ?? '').trim().toLowerCase();
                      // A critical question "fails" when the reviewer
                      // answers no/false. Criticals answered yes / N/A
                      // (when N/A is allowed) are treated as passing
                      // and only get the plain outline "Critical" pill
                      // so the reviewer still sees the question matters.
                      const criticalMissed = isCritical && vis && (rawAns === 'no' || rawAns === 'false');
                      const catW = Number(cat.weight) || 0;
                      return (
                        <tr
                          key={`q-${ci}-${qi}`}
                          className={cn(
                            'border-b border-slate-100 hover:bg-slate-50/50 align-top transition-colors',
                            criticalMissed && 'bg-red-50/60 hover:bg-red-50',
                          )}
                        >
                          <td className="px-3 py-2 text-slate-600 pl-6 leading-snug whitespace-normal break-words">
                            <span className="inline-flex items-start gap-2 flex-wrap">
                              <span>{q.text}</span>
                              {criticalMissed && (
                                <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                  Critical fail
                                </span>
                              )}
                              {isCritical && !criticalMissed && (
                                <span className="inline-flex items-center rounded-full bg-white text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                                  Critical
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap">
                            {vis ? formatAnswerForDisplay(ans?.answer) : '—'}
                          </td>
                          <td className="px-2 py-2 text-center text-slate-600">{vis ? qScore : 0}</td>
                          <td className="px-2 py-2 text-center text-slate-600">{maxScore}</td>
                          <td className="px-2 py-2 text-center text-slate-600">
                            {vis ? (qScore * catW).toFixed(2) : '0.00'}
                          </td>
                          <td className="px-2 py-2 text-center text-slate-600">
                            {(maxScore * catW).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={vis ? 'text-emerald-600 font-medium' : 'text-red-500'}>
                              {vis ? 'Yes' : 'No'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Category Scores table + totals + final score ──────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-800">Category Scores</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium text-slate-600">Category</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Earned</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Cat%</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Weight</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let totalWtdNum = 0;
                let totalWtdDen = 0;
                const rows = (formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                  const cs = formRenderData.categoryScores?.[cat.id];
                  const earned = Number(cs?.earnedPoints) || 0;
                  const possible = Number(cs?.possiblePoints) || 0;
                  const catPct = possible > 0 ? (earned / possible) * 100 : 0;
                  const w = Number(cat.weight) || 0;
                  const wNum = earned * w;
                  const wDen = possible * w;
                  if (possible > 0) {
                    totalWtdNum += wNum;
                    totalWtdDen += wDen;
                  }
                  return (
                    <tr key={ci} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700 font-medium">{cat.name}</td>
                      <td className="px-2 py-2 text-center text-slate-600">{earned}</td>
                      <td className="px-2 py-2 text-center text-slate-600">{possible}</td>
                      <td className="px-2 py-2 text-center text-slate-600">{catPct.toFixed(0)}%</td>
                      <td className="px-2 py-2 text-center text-slate-600">{(w * 100).toFixed(0)}%</td>
                      <td className="px-2 py-2 text-center text-slate-600">{wNum.toFixed(2)}</td>
                      <td className="px-2 py-2 text-center text-slate-600">{wDen.toFixed(2)}</td>
                    </tr>
                  );
                });
                const computedFinal = totalWtdDen > 0 ? (totalWtdNum / totalWtdDen) * 100 : 0;
                const finalScore = finalScoreOverride ?? computedFinal;
                return [
                  ...rows,
                  <tr key="totals" className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
                    <td className="px-3 py-2 text-slate-800">TOTALS</td>
                    <td colSpan={4} />
                    <td className="px-2 py-2 text-center text-slate-800">{totalWtdNum.toFixed(2)}</td>
                    <td className="px-2 py-2 text-center text-slate-800">{totalWtdDen.toFixed(2)}</td>
                  </tr>,
                  <tr key="final" className="bg-primary/10">
                    <td colSpan={6} className="px-3 py-2 text-right text-slate-700 font-semibold text-sm">
                      Final Score
                    </td>
                    <td className={cn('px-2 py-2 text-center font-bold text-sm', scoreColor(finalScore))}>
                      {finalScore.toFixed(2)}%
                    </td>
                  </tr>,
                ];
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── How Scoring Works ─────────────────────────────────────── */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">How Scoring Works</h3>
        <ul className="text-xs text-slate-600 space-y-1.5">
          <li>• <strong>N/A answers</strong> and hidden conditional questions are excluded from scoring.</li>
          <li>• <strong>Weighted Score</strong> = question score × category weight.</li>
          <li>• <strong>Final Score</strong> = total weighted earned ÷ total weighted possible × 100.</li>
          <li>• Text, Info Block, and Sub-Category questions are not scored.</li>
        </ul>
      </div>
    </div>
  );
}

export default ScoreBreakdownTables;
