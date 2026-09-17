/**
 * Verification-pass tests.
 *
 * This pass is a control on the one error the grading pass cannot self-check:
 * alleging the rep did not do something the transcript shows them doing. Two
 * properties make it safe to run on every day's review, and both are asserted
 * here rather than left to the prompt:
 *
 *   1. IT ONLY REMOVES. It cannot add a finding, reorder, or rewrite one. If it
 *      could, the report's content would no longer be owned by the rule set and
 *      the persona, and an auditor hallucination would become a coaching note.
 *   2. IT FAILS OPEN. A provider error, a truncated response, or an
 *      out-of-range index keeps every finding. The alternative — silently
 *      emptying a day because an auxiliary call broke — is far worse than the
 *      false positives this exists to catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callChatModelMock } = vi.hoisted(() => ({ callChatModelMock: vi.fn() }));

vi.mock('../../../ai/ChatModelClient', () => ({
  callChatModel: (...args: unknown[]) => callChatModelMock(...args),
  resolveCheapModelName: () => 'claude-sonnet-4-6',
}));

vi.mock('../../../aiCallLogger', () => ({
  withCallLog: async (
    _meta: unknown,
    _prompt: unknown,
    fn: () => Promise<{ result: unknown }>,
  ) => (await fn()).result,
}));

vi.mock('../../../../config/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { verifyFindings } from '../verify';
import type { AnalyzedFinding } from '../types';

const TRANSCRIPT = [
  'Customer: Go ahead and activate it.',
  'Agent: I can take the card right now if you have it handy.',
  'Customer: I am with a client, just email me the link.',
].join('\n');

/**
 * A verdict only removes a finding when its quote resolves in the transcript,
 * so every drop-asserting test has to supply a real line from TRANSCRIPT.
 */
const ATTEMPT_QUOTE = 'I can take the card right now';

const finding = (over: Partial<AnalyzedFinding> = {}): AnalyzedFinding => ({
  ruleKey: 'buying_signal_not_closed',
  severity: 'high',
  title: 'Ready-to-buy owner sent to self-serve link',
  whatHappened: 'The owner said go ahead and the rep emailed an order link instead of closing.',
  evidenceQuote: 'Go ahead and activate it',
  evidenceSpeaker: 'CUSTOMER',
  recommendedApproach: 'Take the card on the line.',
  recoveryAction: 'Call back today.',
  estValueNote: '$26.95/mo',
  customerName: 'Citadel',
  crmRefKind: 'TASK',
  crmRefId: 1116361,
  ...over,
});

/**
 * The auditable set as the worker builds it — the active rules with
 * `is_omission`. The two conduct rules are deliberately absent, mirroring the
 * seeded rows.
 */
const OMISSION_KEYS = new Set([
  'buying_signal_not_closed',
  'group_expansion_not_captured',
  'no_dated_next_step',
]);

const args = (over: Record<string, unknown> = {}) => ({
  findings: [finding()],
  transcript: TRANSCRIPT,
  provider: 'anthropic' as const,
  conversationId: 'conv-1',
  omissionRuleKeys: OMISSION_KEYS,
  ...over,
});

/** Shape of one provider reply, with the fields withCallLog reads. */
const reply = (text: string) => ({
  text,
  model: 'claude-sonnet-4-6',
  tokensIn: 900,
  tokensOut: 40,
});

beforeEach(() => vi.clearAllMocks());

describe('verifyFindings — the drop decision', () => {
  it('drops a finding the transcript shows the rep attempting', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({
        verdicts: [{ index: 1, rep_attempted: true, agent_quote: 'I can take the card right now' }],
      })),
    );
    const res = await verifyFindings(args());
    expect(res.findings).toEqual([]);
    expect(res.dropped).toBe(1);
    expect(res.tokensIn).toBe(900);
  });

  it('keeps a finding the auditor confirms was never attempted', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: false, agent_quote: null }] })),
    );
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('drops only the audited finding and preserves the order of the rest', async () => {
    const three = [
      finding({ ruleKey: 'buying_signal_not_closed' }),
      finding({ ruleKey: 'group_expansion_not_captured' }),
      finding({ ruleKey: 'no_dated_next_step' }),
    ];
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 2, rep_attempted: true, agent_quote: 'q' }] })),
    );
    const res = await verifyFindings(args({ findings: three }));
    expect(res.findings.map((f) => f.ruleKey)).toEqual([
      'buying_signal_not_closed',
      'no_dated_next_step',
    ]);
  });

  it('unwraps a ```json fence, which both providers emit despite JSON mode', async () => {
    const body = JSON.stringify({
      verdicts: [{ index: 1, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }],
    });
    callChatModelMock.mockResolvedValue(reply('```json\n' + body + '\n```'));
    expect((await verifyFindings(args())).findings).toEqual([]);
  });

  it('accepts a bare verdict array as well as the wrapper object', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify([{ index: 1, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }])),
    );
    expect((await verifyFindings(args())).findings).toEqual([]);
  });

  it('runs on the cheap model, not the run tier, and asks for JSON', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    expect(callChatModelMock.mock.calls[0][1]).toMatchObject({
      model: 'claude-sonnet-4-6',
      responseFormat: 'json_object',
    });
  });

  it('tells the auditor to leave the quality-of-execution rules alone', async () => {
    // A literal reading of "did the rep attempt it?" deletes a voicemail-content
    // finding on the grounds that the rep did leave a voicemail.
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const system = String((callChatModelMock.mock.calls[0][1] as { system: string }).system);
    expect(system).toContain('not about an omission at all');
    expect(system).toContain('answer rep_attempted: false for them');
  });

  it('shows the auditor the alleged miss but not the coaching it must not weigh', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('Ready-to-buy owner sent to self-serve link');
    expect(user).toContain('I can take the card right now');
    expect(user).not.toContain('Take the card on the line.');
    expect(user).not.toContain('Call back today.');
  });
});

describe('verifyFindings — failing open', () => {
  it('keeps every finding when the provider errors', async () => {
    callChatModelMock.mockRejectedValue(new Error('529 overloaded'));
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('keeps every finding when the response is not JSON', async () => {
    callChatModelMock.mockResolvedValue(reply('I could not review that.'));
    expect((await verifyFindings(args())).findings).toHaveLength(1);
  });

  it('ignores an index outside the audited set', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 7, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }] })),
    );
    expect((await verifyFindings(args())).findings).toHaveLength(1);
  });

  // The auditor's verdict is a claim about the transcript, and it was taken on
  // trust: the bare boolean decided the removal while `agent_quote` was parsed
  // and thrown away. An unsupported "yes, they did that" deleted a real miss.
  it('keeps the finding when the auditor votes to drop it with no quote', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true, agent_quote: null }] })),
    );
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('keeps the finding when the auditor quotes a line the transcript does not contain', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({
        verdicts: [{
          index: 1,
          rep_attempted: true,
          agent_quote: 'I offered the extended warranty and the multi-site discount',
        }],
      })),
    );
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('still drops when the quote matches apart from case and punctuation', async () => {
    // ASR rendering differs from however the auditor retypes the line, so a
    // literal comparison would make the check unusable in practice.
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({
        verdicts: [{ index: 1, rep_attempted: true, agent_quote: 'i can TAKE the card, right now' }],
      })),
    );
    expect((await verifyFindings(args())).dropped).toBe(1);
  });

  it('tells the auditor a true verdict needs a verbatim quote to count', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const system = String((callChatModelMock.mock.calls[0][1] as { system: string }).system);
    expect(system).toContain('A true verdict without a verbatim quote');
  });

  it('treats a non-boolean verdict as unproven rather than as attempted', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: 'yes' }] })),
    );
    expect((await verifyFindings(args())).findings).toHaveLength(1);
  });
});

describe('verifyFindings — commission-type rules are out of scope', () => {
  // The auditor was TOLD to leave these alone and ignored it, dropping a
  // high-severity margin-disclosure finding because the rep had indeed spoken
  // on the recorded line. So the exemption is enforced in code, from the
  // `is_omission` flag on the rule an admin authored.
  const voicemail = finding({
    ruleKey: 'weak_or_missing_voicemail',
    title: 'Voicemail lacks a callback number',
  });
  const conduct = finding({
    ruleKey: 'professionalism_or_compliance',
    title: 'Rep discussed internal margin on a recorded line',
  });

  it('never sends a commission-type finding to the auditor', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args({ findings: [conduct, finding()] }));
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).not.toContain('internal margin');
    expect(user).toContain('Ready-to-buy owner sent to self-serve link');
  });

  it('keeps a commission-type finding even when the auditor votes to drop it', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true }] })),
    );
    const res = await verifyFindings(args({ findings: [voicemail, conduct] }));
    expect(res.findings).toHaveLength(2);
    expect(res.dropped).toBe(0);
    // Nothing was auditable, so no call should have been spent at all.
    expect(callChatModelMock).not.toHaveBeenCalled();
  });

  it('maps a verdict index back through the exempt findings it skipped', async () => {
    // The auditor saw only [closing]; index 1 must resolve to the closing
    // finding, not to the voicemail sitting at position 0 of the full list.
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }] })),
    );
    const res = await verifyFindings(args({ findings: [voicemail, finding()] }));
    expect(res.findings.map((f) => f.ruleKey)).toEqual(['weak_or_missing_voicemail']);
    expect(res.dropped).toBe(1);
  });

  it('exempts whatever the caller says is exempt, not a fixed set of keys', async () => {
    // The distinction is a column on the rule, so an admin turning off
    // `is_omission` for a new conduct rule must exempt it with no deploy.
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true }] })),
    );
    const res = await verifyFindings(args({
      findings: [finding({ ruleKey: 'tone_on_the_call' })],
      omissionRuleKeys: new Set([...OMISSION_KEYS]),
    }));
    expect(res.findings).toHaveLength(1);
    expect(callChatModelMock).not.toHaveBeenCalled();
  });
});

describe('verifyFindings — when not to spend a call', () => {
  it('does not call the provider when there is nothing alleged', async () => {
    const res = await verifyFindings(args({ findings: [] }));
    expect(callChatModelMock).not.toHaveBeenCalled();
    expect(res.usdCost).toBe(0);
  });

  it('does not call the provider when there is no transcript to audit against', async () => {
    await verifyFindings(args({ transcript: '   ' }));
    expect(callChatModelMock).not.toHaveBeenCalled();
  });
});
