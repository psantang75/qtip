/**
 * Phase E — pivot detector unit tests.
 *
 * Pins the contract `reviewCase` relies on:
 *   - Happy path returns sanitised CasePivot[] from the model's JSON.
 *   - Bad JSON triggers exactly ONE retry, then succeeds if the second
 *     try parses, fails-open ([]) otherwise.
 *   - Hard failure (Anthropic throws) returns [] (NEVER bubbles to caller).
 *   - Per-caseId in-process cache short-circuits the second call.
 *   - The detector calls `withCallLog` exactly once with `pass: 'pivot_detection'`
 *     so the cost / observability dashboards bucket it correctly.
 *
 * All upstream deps are stubbed at the module boundary so the test
 * stays hermetic — same pattern as `AIReviewerService.reviewCase.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesCreate, withCallLogSpy } = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  withCallLogSpy: vi.fn(),
}));

vi.mock('../../config/ai', () => ({
  aiConfig: {
    anthropic: { defaultModel: 'claude-opus-4-7' },
  },
}));

vi.mock('../ai/AnthropicClient', () => ({
  isAnthropicConfigured: () => true,
  getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
}));

// We wrap the real `withCallLog` so we can assert the meta it was
// invoked with (purpose / pass / caseId / formId), but still let the
// real function run the wrapped fn so retry / parse logic is exercised.
vi.mock('../aiCallLogger', async () => {
  const actual = (await vi.importActual<typeof import('../aiCallLogger')>(
    '../aiCallLogger'
  )) as typeof import('../aiCallLogger');
  return {
    ...actual,
    withCallLog: (meta: unknown, prompt: unknown, fn: () => Promise<unknown>) => {
      withCallLogSpy(meta, prompt);
      return actual.withCallLog(meta as never, prompt as never, fn as never);
    },
  };
});

vi.mock('../../config/prisma', () => ({
  default: {
    aiCallLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import {
  detectCasePivots,
  _clearPivotCache,
  type PivotInputSource,
} from '../aiReviewerPivotDetector';

const SOURCES: PivotInputSource[] = [
  {
    kind: 'CALL',
    id: 'abc-123',
    header: { Conversation: 'abc-123', Duration: '00:08:30' },
    notesOrTranscript: [
      { note: 'Agent: Thanks for calling, how can I help?\nCustomer: I want a refund for the install we paid for last week — the technician never finished hooking up the new STBs.' },
    ],
  },
  {
    kind: 'TICKET',
    id: '42',
    header: { Class: 'Tech', Subclass: 'Install', Status: 'Closed' },
    notesOrTranscript: [
      { note: 'Customer requested refund for incomplete install. Refund tied to install services rendered.' },
    ],
  },
];

function aiTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 80, output_tokens: 40 },
  };
}

describe('detectCasePivots', () => {
  beforeEach(() => {
    messagesCreate.mockReset();
    withCallLogSpy.mockReset();
    _clearPivotCache();
  });

  it('returns sanitised pivots from a well-formed JSON response and logs ONE pivot_detection call', async () => {
    messagesCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify({
          pivots: [
            { label: 'Install Refund', query: 'install refund process', rationale: 'Customer requested refund tied to incomplete install.' },
            { label: 'Tech Install', query: 'install completion playbook', rationale: 'Original work order was an install.' },
          ],
        })
      )
    );

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:abc-123', formId: 7 });

    expect(pivots).toHaveLength(2);
    expect(pivots[0]).toEqual({
      label: 'Install Refund',
      query: 'install refund process',
      rationale: 'Customer requested refund tied to incomplete install.',
    });
    expect(pivots[1].label).toBe('Tech Install');

    expect(messagesCreate).toHaveBeenCalledTimes(1);
    expect(withCallLogSpy).toHaveBeenCalledTimes(1);
    const meta = withCallLogSpy.mock.calls[0][0] as { pass: string; purpose: string; caseId: string; formId: number };
    expect(meta.pass).toBe('pivot_detection');
    expect(meta.purpose).toBe('ai_reviewer.case.pivot_detection');
    expect(meta.caseId).toBe('CALL:abc-123');
    expect(meta.formId).toBe(7);
  });

  it('retries exactly once on unparseable JSON and accepts the retry', async () => {
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse('here is some prose, not JSON at all'))
      .mockResolvedValueOnce(
        aiTextResponse(
          JSON.stringify({
            pivots: [{ label: 'Refund', query: 'refund process', rationale: 'r' }],
          })
        )
      );

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:retry-1', formId: 7 });

    expect(messagesCreate).toHaveBeenCalledTimes(2);
    expect(pivots).toEqual([{ label: 'Refund', query: 'refund process', rationale: 'r' }]);
  });

  it('returns [] (fail-open) when both attempts produce unparseable output', async () => {
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse('still not JSON'))
      .mockResolvedValueOnce(aiTextResponse('still not JSON either'));

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:retry-2', formId: 7 });
    expect(pivots).toEqual([]);
    expect(messagesCreate).toHaveBeenCalledTimes(2);
  });

  it('returns [] (fail-open) when the Anthropic call throws', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:throw', formId: 7 });
    expect(pivots).toEqual([]);
  });

  it('caches per caseId so a second invocation returns without calling the client', async () => {
    messagesCreate.mockResolvedValueOnce(
      aiTextResponse(JSON.stringify({ pivots: [{ label: 'Refund', query: 'refund', rationale: 'r' }] }))
    );

    const first = await detectCasePivots(SOURCES, { caseId: 'CALL:cache', formId: 7 });
    const second = await detectCasePivots(SOURCES, { caseId: 'CALL:cache', formId: 7 });

    expect(first).toEqual(second);
    expect(messagesCreate).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it('caps the returned list at 5 even when the model emits more', async () => {
    messagesCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify({
          pivots: Array.from({ length: 9 }, (_, i) => ({
            label: `Pivot ${i + 1}`,
            query: `q${i + 1}`,
            rationale: `r${i + 1}`,
          })),
        })
      )
    );

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:cap', formId: 7 });
    expect(pivots).toHaveLength(5);
  });

  it('drops malformed entries (missing label or query) and dedupes by lowercased label', async () => {
    messagesCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify({
          pivots: [
            { label: 'Refund', query: 'refund', rationale: 'r1' },
            { label: 'refund', query: 'refund again', rationale: 'r2' }, // dup by case-insensitive label
            { label: '', query: 'q', rationale: 'r3' },                  // missing label → drop
            { label: 'Install', query: '', rationale: 'r4' },            // missing query → drop
            { label: 'Install Refund', query: 'install refund', rationale: 'r5' },
          ],
        })
      )
    );

    const pivots = await detectCasePivots(SOURCES, { caseId: 'CALL:sanitise', formId: 7 });
    expect(pivots.map((p) => p.label)).toEqual(['Refund', 'Install Refund']);
  });

  it('returns [] without calling the client when sources is empty', async () => {
    const pivots = await detectCasePivots([], { caseId: 'EMPTY:0', formId: 7 });
    expect(pivots).toEqual([]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});
