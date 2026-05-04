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

export interface CallLogMeta {
  /** 'anthropic' | 'openai' (or future providers). */
  provider: string;
  /** Stable string identifying which feature initiated the call (e.g. 'ai_reviewer.ticket'). */
  purpose: string;
  ticketId?: number | null;
  formId?: number | null;
  submissionId?: number | null;
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
    // Fire-and-forget: don't await on the happy path to keep latency tight.
    void persist({
      provider: meta.provider,
      model: out.model,
      purpose: meta.purpose,
      ticket_id: meta.ticketId ?? null,
      submission_id: meta.submissionId ?? null,
      form_id: meta.formId ?? null,
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
      ticket_id: meta.ticketId ?? null,
      submission_id: meta.submissionId ?? null,
      form_id: meta.formId ?? null,
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
