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
});
