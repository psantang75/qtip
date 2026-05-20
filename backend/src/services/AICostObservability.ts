/**
 * Cross-cutting (X1): cost / latency observability for the AI Reviewer.
 *
 * Aggregates `ai_call_logs` by `pass` (classification | trace |
 * synthesis | verification | single_pass) and optionally by `case_id`
 * so the AI Reviewer settings dashboard can show:
 *   - "Where does the per-case spend actually go?" (which pass dominates)
 *   - "How much wall-clock time does a typical case take end-to-end?"
 *   - "Which case_id ran out the cost guard?" (top-N hot cases)
 *
 * Stays in pure TypeScript (no SQL view) so the dashboard rolls
 * forward as soon as the migration applies — no second deploy required.
 * Heavy aggregations are bounded to the configured time window so a
 * misconfigured query can't scan years of logs.
 */

import prisma from '../config/prisma';
import { estimateUsdCost } from './aiCostEstimator';

export type CallLogPass =
  | 'classification'
  | 'trace'
  | 'synthesis'
  | 'verification'
  | 'single_pass';

export interface PassRollupRow {
  pass: CallLogPass;
  count: number;
  total_usd: number;
  avg_elapsed_ms: number;
  total_tokens_in: number;
  total_tokens_out: number;
}

export interface CaseRollupRow {
  case_id: string;
  passes: Record<CallLogPass | 'unknown', number>;
  total_usd: number;
  total_elapsed_ms: number;
}

export interface AICostObservabilityWindow {
  /** Lower bound (inclusive). Defaults to 30 days ago. */
  since?: Date;
  /** Optional form filter. */
  formId?: number | null;
  /** Cap how many rows are returned for the case-id rollup. */
  caseLimit?: number;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Sum cost / latency / volume per pass over the window. Used by the AI
 * Reviewer settings dashboard's "Where does our spend go?" panel.
 */
export async function getPassRollup(opts: AICostObservabilityWindow = {}): Promise<PassRollupRow[]> {
  const since = opts.since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await prisma.aiCallLog.findMany({
    where: {
      created_at: { gte: since },
      success: true,
      ...(opts.formId ? { form_id: opts.formId } : {}),
    },
    select: {
      pass: true,
      model: true,
      tokens_in: true,
      tokens_out: true,
      elapsed_ms: true,
    },
  });

  const acc = new Map<CallLogPass, PassRollupRow>();
  for (const r of rows) {
    const passKey = (r.pass as CallLogPass | undefined) ?? 'single_pass';
    let bucket = acc.get(passKey);
    if (!bucket) {
      bucket = {
        pass: passKey,
        count: 0,
        total_usd: 0,
        avg_elapsed_ms: 0,
        total_tokens_in: 0,
        total_tokens_out: 0,
      };
      acc.set(passKey, bucket);
    }
    bucket.count += 1;
    bucket.avg_elapsed_ms += Number(r.elapsed_ms);
    bucket.total_tokens_in += Number(r.tokens_in ?? 0);
    bucket.total_tokens_out += Number(r.tokens_out ?? 0);
    const est = estimateUsdCost(r.model, r.tokens_in, r.tokens_out);
    if (est && Number.isFinite(est.usd)) bucket.total_usd += est.usd;
  }
  for (const r of acc.values()) {
    r.avg_elapsed_ms = r.count > 0 ? Math.round(r.avg_elapsed_ms / r.count) : 0;
  }
  return [...acc.values()].sort((a, b) => b.total_usd - a.total_usd);
}

/**
 * Top-N rollup by case_id over the window. The AI Reviewer dashboard
 * uses this to show which multi-source cases are the most expensive
 * (and thus the best candidates for a cost-guard nudge).
 */
export async function getCaseRollup(opts: AICostObservabilityWindow = {}): Promise<CaseRollupRow[]> {
  const since = opts.since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 3600 * 1000);
  const limit = Math.max(1, Math.min(200, opts.caseLimit ?? 25));
  const rows = await prisma.aiCallLog.findMany({
    where: {
      created_at: { gte: since },
      success: true,
      case_id: { not: null },
      ...(opts.formId ? { form_id: opts.formId } : {}),
    },
    select: {
      case_id: true,
      pass: true,
      model: true,
      tokens_in: true,
      tokens_out: true,
      elapsed_ms: true,
    },
  });

  const acc = new Map<string, CaseRollupRow>();
  for (const r of rows) {
    if (!r.case_id) continue;
    let bucket = acc.get(r.case_id);
    if (!bucket) {
      bucket = {
        case_id: r.case_id,
        passes: { classification: 0, trace: 0, synthesis: 0, verification: 0, single_pass: 0, unknown: 0 },
        total_usd: 0,
        total_elapsed_ms: 0,
      };
      acc.set(r.case_id, bucket);
    }
    const passKey = (r.pass as CallLogPass | undefined) ?? 'unknown';
    bucket.passes[passKey] = (bucket.passes[passKey] ?? 0) + 1;
    bucket.total_elapsed_ms += Number(r.elapsed_ms);
    const est = estimateUsdCost(r.model, r.tokens_in, r.tokens_out);
    if (est && Number.isFinite(est.usd)) bucket.total_usd += est.usd;
  }
  return [...acc.values()].sort((a, b) => b.total_usd - a.total_usd).slice(0, limit);
}
