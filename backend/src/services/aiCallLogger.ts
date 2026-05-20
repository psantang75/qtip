/**
 * AI call audit logger.
 *
 * Wraps every LLM invocation by the AI Reviewer with a fire-and-forget
 * insert into `ai_call_logs`. The logger NEVER throws — a logging
 * failure must not bubble into the LLM call path. (Phase 3 of the AI
 * Reviewer Maturity Rollout.)
 *
 * Use `withCallLog(meta, prompt, fn)`:
 *   - On success, persists provider/model/elapsed/tokens/etc and returns fn's result.
 *   - On error, persists success=0 with the error code/message, then rethrows so
 *     the existing error-handling paths keep their semantics.
 *
 * The meta passed in identifies WHO is calling and WHAT context to associate;
 * the prompt argument is hashed (SHA-256) so we can diff prompt changes across
 * runs without storing the full text on every call.
 */

import { createHash } from 'crypto';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { estimateUsdCost, type CostEstimate } from './aiCostEstimator';

export type CallLogPass =
  | 'classification'
  | 'pivot_detection'
  | 'trace'
  | 'synthesis'
  // Chunked synthesis pipeline (large forms, >= AI_REVIEWER_CHUNKED_SYNTHESIS_THRESHOLD
  // gradeable questions): the legacy 'synthesis' pass is split into a
  // reasoning-only pass on Opus and N parallel answer-chunk passes on
  // Sonnet (one per form category). Both kinds are still logically
  // "synthesis" — separate buckets only exist so cost rollups can
  // attribute spend correctly across the two model tiers.
  //
  // Length note: `ai_call_logs.pass` is VARCHAR(16). 'syn_reasoning' is
  // 13 chars, 'syn_answers' is 11 chars, 'syn_reconcile' is 13 chars —
  // all safely fit. The longer 'synthesis_*' spelling overflowed the
  // column at runtime.
  | 'syn_reasoning'
  | 'syn_answers'
  // Per-question reconciliation pass — fires only when the chunk
  // pass flags `dissent: true` on a draft verdict (W1.3 of the
  // consistency refactor). Zero calls on healthy runs.
  | 'syn_reconcile'
  | 'verification'
  | 'single_pass';

export interface CallLogMeta {
  /** 'anthropic' | 'openai' (or future providers). */
  provider: string;
  /** Stable string identifying which feature initiated the call (e.g. 'ai_reviewer.ticket'). */
  purpose: string;
  ticketId?: number | null;
  formId?: number | null;
  submissionId?: number | null;
  /**
   * Cross-cutting (X1): which two-pass stage produced this call. The
   * X1 dashboard query groups by (pass, case_id) so cost and latency
   * can be attributed to the actual orchestration stage. Defaults to
   * 'single_pass' for the legacy one-call path so the existing fleet
   * keeps a stable bucket without needing a backfill.
   */
  pass?: CallLogPass;
  /** Cross-cutting (X1): submissions.case_id for multi-source cases. */
  caseId?: string | null;
  /**
   * Optional per-call USD cost sink. When provided, `withCallLog`
   * computes `estimateUsdCost(model, tokensIn, tokensOut)` after the
   * wrapped call succeeds and invokes this callback once with the
   * result (null if no usable token counts came back). Callers that
   * orchestrate multiple LLM passes per logical run (e.g. the
   * `reviewCase` two-pass orchestrator: classifier + N x trace +
   * synthesis + optional verification) use this to sum the *total*
   * cost across passes — historically only the synthesis call's cost
   * was reported back to the UI, which under-counted multi-source
   * runs by 30-50%. Best-effort: any throw in the callback is caught
   * and warn-logged so a buggy sink can never derail the LLM call.
   */
  onCost?: (cost: CostEstimate | null) => void;
}

export interface CallLogResult<T> {
  /** Whatever the caller wants to return downstream. */
  result: T;
  /** The model that actually answered (after any provider-side defaults). */
  model: string;
  /** Raw response text (or stringified) — only its length is persisted. */
  rawResponse: string;
  /** True if the LLM was called twice (JSON-retry path). */
  retried: boolean;
  /** Optional usage stats from the provider. */
  tokensIn?: number | null;
  tokensOut?: number | null;
}

function hashPrompt(promptText: string): string {
  return createHash('sha256').update(promptText, 'utf8').digest('hex');
}

/** Persist a row. Best-effort: any error is caught, logged once, and dropped. */
async function persist(record: Record<string, unknown>): Promise<void> {
  try {
    await prisma.aiCallLog.create({ data: record as never });
  } catch (err) {
    // Use warn (not error) so a busted log table never spams the error
    // channel and never derails the main flow.
    logger.warn(`[ai-call-logger] failed to write trace: ${(err as Error).message}`);
  }
}

/**
 * Wrap an LLM call with audit logging. The returned promise resolves to
 * whatever the wrapped function's `result` field contains.
 */
export async function withCallLog<T>(
  meta: CallLogMeta,
  prompt: { system: string; user: string },
  fn: () => Promise<CallLogResult<T>>
): Promise<T> {
  const promptText = `${prompt.system}\n\n${prompt.user}`;
  const promptHash = hashPrompt(promptText);
  const promptChars = promptText.length;
  const started = Date.now();

  try {
    const out = await fn();
    const elapsed = Date.now() - started;
    // Per-call cost sink (best-effort). Computed once per success so
    // callers like `reviewCase` can sum costs across an entire
    // orchestrated run without each pass re-implementing pricing.
    if (meta.onCost) {
      try {
        const cost = estimateUsdCost(out.model, out.tokensIn, out.tokensOut);
        meta.onCost(cost);
      } catch (sinkErr) {
        logger.warn(
          `[ai-call-logger] onCost sink threw (non-fatal): ${(sinkErr as Error).message}`
        );
      }
    }
    void persist({
      provider: meta.provider,
      model: out.model,
      purpose: meta.purpose,
      pass: meta.pass ?? 'single_pass',
      ticket_id: meta.ticketId ?? null,
      submission_id: meta.submissionId ?? null,
      form_id: meta.formId ?? null,
      case_id: meta.caseId ?? null,
      prompt_hash: promptHash,
      prompt_chars: promptChars,
      response_chars: out.rawResponse.length,
      tokens_in: out.tokensIn ?? null,
      tokens_out: out.tokensOut ?? null,
      elapsed_ms: elapsed,
      retried: out.retried,
      success: true,
      error_code: null,
      error_message: null,
    });
    return out.result;
  } catch (err) {
    const elapsed = Date.now() - started;
    const e = err as Error & { code?: string };
    void persist({
      provider: meta.provider,
      model: 'unknown',
      purpose: meta.purpose,
      pass: meta.pass ?? 'single_pass',
      ticket_id: meta.ticketId ?? null,
      submission_id: meta.submissionId ?? null,
      form_id: meta.formId ?? null,
      case_id: meta.caseId ?? null,
      prompt_hash: promptHash,
      prompt_chars: promptChars,
      response_chars: 0,
      tokens_in: null,
      tokens_out: null,
      elapsed_ms: elapsed,
      retried: false,
      success: false,
      error_code: (e.code ?? e.name ?? 'ERROR').slice(0, 64),
      error_message: (e.message ?? String(e)).slice(0, 4000),
    });
    throw err;
  }
}
