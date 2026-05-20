/**
 * Fire-and-forget guarantees for the AI call logger (Phase 3).
 *
 * Logging an LLM call to ai_call_logs MUST NOT bubble errors into the
 * caller. If the logger itself blows up (DB down, schema mismatch,
 * whatever), the LLM result still flows through normally and only a
 * warning is logged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; use vi.hoisted so the spy reference is available
// inside both the factory and the assertions below.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('../../config/prisma', () => ({
  default: { aiCallLog: { create: createMock } },
}));

import { withCallLog } from '../aiCallLogger';

describe('aiCallLogger fire-and-forget semantics', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('returns the wrapped result on success even if the trace insert fails', async () => {
    createMock.mockRejectedValue(new Error('simulated DB failure'));
    const result = await withCallLog(
      { provider: 'anthropic', purpose: 'ai_reviewer.test' },
      { system: 'sys', user: 'usr' },
      async () => ({
        result: { ok: 1 },
        model: 'unit-test-model',
        rawResponse: 'hello',
        retried: false,
      })
    );
    expect(result).toEqual({ ok: 1 });
    // Best-effort persist was attempted; failure was swallowed.
    // (await on a microtask so any internal void persist() can settle.)
    await new Promise((r) => setImmediate(r));
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('persists provider/model/elapsed metadata on success', async () => {
    createMock.mockResolvedValue(undefined);
    await withCallLog(
      { provider: 'openai', purpose: 'ai_reviewer.test', ticketId: 12345, formId: 99016 },
      { system: 'sys-text', user: 'usr-text' },
      async () => ({
        result: 42,
        model: 'gpt-5-mini',
        rawResponse: 'AAAAA',
        retried: true,
        tokensIn: 100,
        tokensOut: 50,
      })
    );
    await new Promise((r) => setImmediate(r));
    const call = createMock.mock.calls[0]![0];
    expect(call.data.provider).toBe('openai');
    expect(call.data.model).toBe('gpt-5-mini');
    expect(call.data.purpose).toBe('ai_reviewer.test');
    expect(call.data.ticket_id).toBe(12345);
    expect(call.data.form_id).toBe(99016);
    expect(call.data.response_chars).toBe(5);
    expect(call.data.tokens_in).toBe(100);
    expect(call.data.tokens_out).toBe(50);
    expect(call.data.retried).toBe(true);
    expect(call.data.success).toBe(true);
    expect(call.data.prompt_chars).toBe('sys-text\n\nusr-text'.length);
    expect(typeof call.data.prompt_hash).toBe('string');
    expect(call.data.prompt_hash).toHaveLength(64); // sha256 hex
  });

  it('persists error details and rethrows when the wrapped call fails', async () => {
    createMock.mockResolvedValue(undefined);
    const boom = Object.assign(new Error('LLM exploded'), { code: 'LLM_FAILED' });
    await expect(
      withCallLog(
        { provider: 'anthropic', purpose: 'ai_reviewer.test' },
        { system: 's', user: 'u' },
        async () => {
          throw boom;
        }
      )
    ).rejects.toBe(boom);
    await new Promise((r) => setImmediate(r));
    const call = createMock.mock.calls[0]![0];
    expect(call.data.success).toBe(false);
    expect(call.data.error_code).toBe('LLM_FAILED');
    expect(call.data.error_message).toContain('LLM exploded');
  });

  // Regression: before this, the `reviewCase` two-pass orchestrator
  // could only surface the SYNTHESIS call's cost in the run toast —
  // the trace/classifier/verification calls were silently missing,
  // so multi-source runs looked 30-50% cheaper than they actually were.
  // The `onCost` sink lets `reviewCase` aggregate every call's cost.
  it('invokes meta.onCost with a CostEstimate computed from model + tokens on success', async () => {
    createMock.mockResolvedValue(undefined);
    const costs: Array<unknown> = [];
    await withCallLog(
      {
        provider: 'anthropic',
        purpose: 'ai_reviewer.test',
        onCost: (c) => costs.push(c),
      },
      { system: 's', user: 'u' },
      async () => ({
        result: 'ok',
        // claude-sonnet-4-5 is in the PRICING table at $3/$15 per 1M tok.
        // 1000 in + 500 out = 0.001 * 3 + 0.0005 * 15 = $0.0105.
        model: 'claude-sonnet-4-5',
        rawResponse: 'r',
        retried: false,
        tokensIn: 1000,
        tokensOut: 500,
      })
    );
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({
      usd: expect.closeTo(0.0105, 5),
      inputTokens: 1000,
      outputTokens: 500,
      approximated: false,
    });
  });

  it('passes null to meta.onCost when token counts are missing', async () => {
    createMock.mockResolvedValue(undefined);
    const costs: Array<unknown> = [];
    await withCallLog(
      { provider: 'anthropic', purpose: 'ai_reviewer.test', onCost: (c) => costs.push(c) },
      { system: 's', user: 'u' },
      async () => ({
        result: 'ok',
        model: 'claude-opus-4-7',
        rawResponse: 'r',
        retried: false,
        // tokensIn/tokensOut intentionally omitted — provider didn't return usage.
      })
    );
    expect(costs).toEqual([null]);
  });

  it('does not invoke meta.onCost when the wrapped call throws', async () => {
    createMock.mockResolvedValue(undefined);
    const costs: Array<unknown> = [];
    await expect(
      withCallLog(
        { provider: 'anthropic', purpose: 'ai_reviewer.test', onCost: (c) => costs.push(c) },
        { system: 's', user: 'u' },
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');
    expect(costs).toEqual([]);
  });

  it('swallows a throwing onCost sink so the LLM result still flows through', async () => {
    createMock.mockResolvedValue(undefined);
    const result = await withCallLog(
      {
        provider: 'anthropic',
        purpose: 'ai_reviewer.test',
        onCost: () => {
          throw new Error('sink blew up');
        },
      },
      { system: 's', user: 'u' },
      async () => ({
        result: 'still-here',
        model: 'claude-opus-4-7',
        rawResponse: 'r',
        retried: false,
        tokensIn: 1,
        tokensOut: 1,
      })
    );
    expect(result).toBe('still-here');
  });
});
