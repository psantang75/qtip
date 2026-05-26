/**
 * Provider-agnostic chat-completion wrapper. Lets the AI Reviewer
 * synthesis pipeline (Pass 2A reasoning, Pass 2B answer chunks, Pass 2
 * verification) call EITHER Claude (Anthropic) OR ChatGPT (OpenAI)
 * from the same code path, controlled by the per-form
 * `ai_model_provider` column.
 *
 * Why a wrapper instead of two parallel callers:
 *  - The orchestrator picks a provider once at the top of the run; we
 *    don't want every downstream wrapper sprinkling provider checks.
 *  - Cost + timing accounting needs a NORMALIZED shape: every call
 *    returns `{ text, tokensIn, tokensOut, model, latencyMs }`
 *    regardless of which API was on the wire.
 *  - JSON-mode handling differs (Anthropic relies on prompt discipline;
 *    OpenAI has a native `response_format: { type: 'json_object' }` flag
 *    that materially improves parse reliability). We surface the same
 *    `responseFormat: 'json_object'` option on both sides; OpenAI
 *    honours it natively, Anthropic ignores it (the system prompt
 *    already enforces JSON output).
 *  - Retry semantics stay the orchestrator's concern. This wrapper does
 *    ONE call and returns the raw text; the caller decides whether to
 *    retry with a sterner system prompt.
 *
 * NOT in scope for this wrapper: streaming. The synthesis passes are
 * one-shot JSON object emitters — there is no UX value in streaming
 * tokens to the QA reviewer. If we add streaming later it goes in a
 * sibling function (`streamChatModel`) so existing call sites don't
 * have to refactor.
 */

import { aiConfig } from '../../config/ai';
import logger from '../../config/logger';
import { getAnthropicClient } from './AnthropicClient';
import { getOpenAIClient } from './OpenAIClient';

export type ModelProvider = 'anthropic' | 'openai';

export interface ChatModelOptions {
  /** Universal system prompt. Both providers accept it as a separate field. */
  system: string;
  /** Single user-turn message body. We do NOT support multi-turn here — synthesis is one-shot. */
  user: string;
  /**
   * Optional model override. When omitted, the wrapper picks the
   * provider's `defaultModel` from `aiConfig`. Set when the caller
   * wants a cheaper model (e.g. answer chunks use Sonnet / gpt-5-mini).
   */
  model?: string;
  /**
   * Max output tokens. Sized by the caller per pass — reasoning is
   * ~3k chars, answer chunks ~2k chars, trace ~5k chars; 8000 is the
   * common ceiling.
   */
  maxTokens: number;
  /**
   * Per-call wall-clock timeout (ms). Caller passes this through to
   * the SDK. Default 10 minutes.
   */
  timeoutMs?: number;
  /**
   * When `'json_object'`, request JSON mode on providers that support
   * it (OpenAI). Anthropic ignores this — the system prompt already
   * enforces JSON output via the addenda contract.
   */
  responseFormat?: 'json_object' | 'text';
  /**
   * Optional Anthropic tool definitions. When supplied, the call is
   * issued with `tools` + `tool_choice` so the model is forced to
   * emit a structured tool_use block matching the tool's
   * `input_schema`. This is how the answers pass enforces per-question
   * value enums (RADIO/MULTI_SELECT) at the API layer instead of
   * relying on prompt discipline. OpenAI ignores this — the OpenAI
   * branch is text/JSON only for now.
   */
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  /**
   * Force-call a specific tool by name. Mirrors Anthropic's
   * `tool_choice: { type: 'tool', name }`. When omitted but `tools` is
   * provided, the model may CHOOSE whether to call a tool.
   */
  toolChoice?: { type: 'tool'; name: string };
}

export interface ChatModelResult {
  /** Raw text response from the model. */
  text: string;
  /** Input tokens billed by the provider; null when the provider didn't return usage. */
  tokensIn: number | null;
  /** Output tokens billed by the provider; null when the provider didn't return usage. */
  tokensOut: number | null;
  /** Wall-clock latency for this single call, in milliseconds. */
  latencyMs: number;
  /** Resolved model name (after defaulting). Useful for logs + the compare UI. */
  model: string;
  /** Echo of the provider so the call site doesn't have to thread it. */
  provider: ModelProvider;
  /**
   * Optional finish-reason hint, when the provider exposes one. Anthropic
   * returns `stop_reason`, OpenAI returns `finish_reason`; both surface
   * here as a single field so the retry layer can detect `max_tokens`
   * truncation uniformly.
   */
  stopReason: string | null;
  /**
   * Anthropic tool-use payload, when the call was issued with `tools`
   * and the model emitted a `tool_use` block. The shape is the model's
   * parsed `input` JSON — i.e. the structured arguments it picked for
   * the forced tool. `null` when no tool was called (text-only
   * response) or when the provider doesn't support tools.
   */
  toolInput: unknown | null;
}

/**
 * Resolve the model name to use for a given provider + optional override.
 * Centralized so the env-var contract is consistent across call sites.
 */
export function resolveModelName(
  provider: ModelProvider,
  override?: string
): string {
  if (override && override.length > 0) return override;
  if (provider === 'openai') {
    return aiConfig.openai?.defaultModel ?? 'gpt-5';
  }
  return aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
}

/**
 * Provider-agnostic chat-completion call. ONE round-trip with a small
 * inline retry layer for transient transport errors (Anthropic 529
 * `overloaded_error`, generic 5xx, network resets). Hard semantic
 * errors (4xx other than 429/529, validation failures) are NOT
 * retried — they would just fail the same way.
 *
 * The retry layer is intentionally tight: at most 2 retries with
 * exponential backoff (500ms, 1500ms). Wider retry strategies belong
 * to the orchestrator, which already owns prompt-level retry (e.g.
 * sending a sterner "respond with ONLY JSON" instruction).
 */
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_BACKOFFS_MS = [500, 1500];

function isTransientProviderError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 529 || e.status === 503 || e.status === 502 || e.status === 504) return true;
  if (e.status === 429) return true;
  if (typeof e.message === 'string') {
    if (/overloaded_error/i.test(e.message)) return true;
    if (/\b(ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET)\b/.test(e.message)) return true;
  }
  return false;
}

export async function callChatModel(
  provider: ModelProvider,
  opts: ChatModelOptions
): Promise<ChatModelResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await callChatModelOnce(provider, opts);
    } catch (err) {
      lastErr = err;
      if (attempt >= TRANSIENT_RETRY_ATTEMPTS) break;
      if (!isTransientProviderError(err)) break;
      const wait = TRANSIENT_RETRY_BACKOFFS_MS[attempt] ?? 1500;
      logger.warn(
        `[chat-model] transient ${provider} error (attempt ${attempt + 1}/${TRANSIENT_RETRY_ATTEMPTS + 1}); ` +
          `retrying after ${wait}ms: ${(err as Error).message}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function callChatModelOnce(
  provider: ModelProvider,
  opts: ChatModelOptions
): Promise<ChatModelResult> {
  const model = resolveModelName(provider, opts.model);
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const started = Date.now();

  if (provider === 'openai') {
    const client = getOpenAIClient();
    // Chat Completions is the right call shape here — `system` as the
    // first message, `user` as the second. `response_format` is
    // honoured only when set; we forward `json_object` so the
    // synthesis JSON contract holds even when Claude-tuned prompts
    // run on GPT.
    //
    // GPT-5 and the o-series reasoning models REQUIRE
    // `max_completion_tokens` (the legacy `max_tokens` knob is rejected
    // with a 400). Older chat models (gpt-4 family) still accept
    // `max_tokens`. Switch on the model name — anything matching
    // /^(gpt-5|gpt-6|o\d)/ goes via `max_completion_tokens`, everything
    // else stays on `max_tokens` for back-compat.
    const usesCompletionTokens = /^(gpt-5|gpt-6|o\d)/i.test(model);
    // GPT-5 and the o-series count INTERNAL reasoning tokens against
    // max_completion_tokens — the model can burn the whole budget on
    // hidden reasoning and emit zero visible text. Add a fixed
    // reasoning headroom for those models so the caller's
    // visible-text budget is preserved. Anthropic / older OpenAI
    // models don't have this confusion.
    const REASONING_HEADROOM = 8000;
    const tokenArg = usesCompletionTokens
      ? { max_completion_tokens: opts.maxTokens + REASONING_HEADROOM }
      : { max_tokens: opts.maxTokens };
    const res = await client.chat.completions.create(
      {
        model,
        ...tokenArg,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        ...(opts.responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      },
      { timeout: timeoutMs, maxRetries: 0 }
    );
    const latencyMs = Date.now() - started;
    const choice = res.choices?.[0];
    const text = choice?.message?.content ?? '';
    const tokensIn = res.usage?.prompt_tokens ?? null;
    const tokensOut = res.usage?.completion_tokens ?? null;
    const stopReason = choice?.finish_reason ?? null;
    return { text, tokensIn, tokensOut, latencyMs, model, provider, stopReason, toolInput: null };
  }

  // Anthropic default branch.
  const client = getAnthropicClient();
  // Tool-use mode: when the caller passes `tools`, forward them along
  // with `tool_choice`. Anthropic will respond with a `tool_use` block
  // whose `input` is JSON validated against the tool's `input_schema`
  // — which is the entire point (per-question value enums become
  // enforceable at the wire instead of being prompt suggestions).
  const toolArgs = opts.tools
    ? {
        tools: opts.tools as unknown as Parameters<typeof client.messages.create>[0]['tools'],
        ...(opts.toolChoice
          ? { tool_choice: opts.toolChoice as unknown as Parameters<typeof client.messages.create>[0]['tool_choice'] }
          : {}),
      }
    : {};
  const res = await client.messages.create(
    {
      model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      ...toolArgs,
    },
    { timeout: timeoutMs, maxRetries: 0 }
  );
  const latencyMs = Date.now() - started;
  const block = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
  // Tool-use mode: extract the FIRST tool_use block's parsed input.
  // We only force one tool at a time today; multi-tool calls would
  // need this code revisited (and we'd surface an array instead).
  const toolBlock = res.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; name: string; input: unknown }
    | undefined;
  if (opts.tools && !toolBlock) {
    logger.warn(
      `[chat-model] Anthropic was given tools but emitted no tool_use block (model=${model}, ` +
        `forced=${opts.toolChoice?.name ?? 'none'})`
    );
  }
  if (!block && !toolBlock) {
    logger.warn(`[chat-model] Anthropic response had no text or tool_use block (model=${model})`);
  }
  const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const tokensIn = usage?.input_tokens ?? null;
  const tokensOut = usage?.output_tokens ?? null;
  const stopReason = (res as { stop_reason?: string | null }).stop_reason ?? null;
  return {
    text: block?.text ?? '',
    tokensIn,
    tokensOut,
    latencyMs,
    model,
    provider,
    stopReason,
    toolInput: toolBlock?.input ?? null,
  };
}

/**
 * Resolve the "cheap" model for a provider — used by answer chunks
 * (Pass 2B) and the trace pass where speed + cost dominate. Same env
 * contract as before for Anthropic (`ANTHROPIC_CHEAP_MODEL`); for
 * OpenAI we honour `OPENAI_CHEAP_MODEL` with a sensible default.
 */
export function resolveCheapModelName(provider: ModelProvider): string {
  if (provider === 'openai') {
    return (
      process.env.OPENAI_CHEAP_MODEL ||
      aiConfig.openai?.defaultModel ||
      'gpt-5-mini'
    );
  }
  return (
    process.env.ANTHROPIC_CHEAP_MODEL ||
    aiConfig.anthropic?.defaultModel ||
    'claude-sonnet-4-5'
  );
}
