/**
 * Tier-2 Item 4 — KB Coverage dashboard aggregator.
 *
 * Reads recent submissions on a form, walks each `ai_extras.pivots`
 * array, and rolls them up into per-pivot averages so the dashboard
 * can surface "this pivot fires often but never finds KB pages" gaps.
 *
 * A pivot is flagged as `gap: true` when:
 *   - It has appeared in `>= MIN_CASES_FOR_GAP` submissions in the
 *     window (so a one-off zero-hit isn't surfaced as a content gap).
 *   - AND the AVERAGE `kb_hit_count` across those submissions is
 *     `< 1.0` (the search routinely returns nothing).
 *
 * The aggregator is intentionally pure: prisma rows in, summary out.
 * The calling route reads the rows and (in tests) we feed in synthetic
 * rows directly.
 */

const MIN_CASES_FOR_GAP = 3;

export interface KbCoveragePivot {
  /** Normalised pivot label (lowercased + trimmed). */
  label: string;
  /** Number of submissions in the window where this pivot fired. */
  cases: number;
  /** Mean `kb_hit_count` across those submissions, rounded to 2 decimals. */
  avg_kb_hits: number;
  /** True when `cases >= 3 AND avg_kb_hits < 1` (content gap signal). */
  gap: boolean;
}

export interface KbCoverageReport {
  form_id: number;
  window_days: number;
  total_cases: number;
  pivots: KbCoveragePivot[];
}

/**
 * Shape of the prisma submission row the aggregator needs. Only the
 * `ai_extras.pivots` array is ever read — every other field is
 * irrelevant. Defined as a structural type so callers don't have to
 * pull in the Submission model just to build test fixtures.
 */
export interface SubmissionAiExtras {
  ai_extras?: unknown;
}

/**
 * Aggregate per-pivot KB coverage across a list of submissions for
 * a single form.
 */
export function aggregateKbCoverage(
  formId: number,
  windowDays: number,
  submissions: SubmissionAiExtras[]
): KbCoverageReport {
  // Bucket by lowercased pivot label so trivial casing differences in
  // the pivot detector's output don't fragment the rollup.
  const buckets = new Map<string, { cases: number; sumHits: number; rawLabel: string }>();
  for (const s of submissions) {
    const extras = s?.ai_extras as { pivots?: unknown } | null | undefined;
    if (!extras || !Array.isArray(extras.pivots)) continue;
    for (const p of extras.pivots) {
      if (!p || typeof p !== 'object') continue;
      const label = String((p as { label?: unknown }).label ?? '').trim();
      if (!label) continue;
      const hits = Number((p as { kb_hit_count?: unknown }).kb_hit_count);
      if (!Number.isFinite(hits)) continue;
      const key = label.toLowerCase();
      const bucket = buckets.get(key) ?? { cases: 0, sumHits: 0, rawLabel: label };
      bucket.cases += 1;
      bucket.sumHits += Math.max(0, hits);
      buckets.set(key, bucket);
    }
  }
  const pivots: KbCoveragePivot[] = [];
  for (const bucket of buckets.values()) {
    const avg = bucket.cases > 0 ? bucket.sumHits / bucket.cases : 0;
    pivots.push({
      label: bucket.rawLabel,
      cases: bucket.cases,
      avg_kb_hits: round2(avg),
      gap: bucket.cases >= MIN_CASES_FOR_GAP && avg < 1,
    });
  }
  // Stable ordering: gaps first (so reviewers see content holes
  // immediately), then by case volume desc, then by label asc.
  pivots.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap ? -1 : 1;
    if (b.cases !== a.cases) return b.cases - a.cases;
    return a.label.localeCompare(b.label);
  });
  return {
    form_id: formId,
    window_days: windowDays,
    total_cases: submissions.length,
    pivots,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
