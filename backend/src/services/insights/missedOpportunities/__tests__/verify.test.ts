/**
 * Verification-pass tests.
 *
 * This pass is a control on the two errors the grading pass cannot self-check:
 * alleging the rep did not do something the transcript shows them doing, and
 * reporting a situation the rule's own body excludes. These properties make it
 * safe to run on every day's review, and all of them are asserted here rather
 * than left to the prompt:
 *
 *   1. IT ONLY REMOVES. It cannot add a finding, reorder, or rewrite one. If it
 *      could, the report's content would no longer be owned by the rule set and
 *      the persona, and an auditor hallucination would become a coaching note.
 *   2. IT FAILS OPEN. A provider error, a truncated response, or an
 *      out-of-range index keeps every finding. The alternative — silently
 *      emptying a day because an auxiliary call broke — is far worse than the
 *      false positives this exists to catch.
 *   3. IT ONLY SPEAKS FOR THE REVIEWED PERSON. An attempt removal asserts that
 *      THIS salesperson did the thing, so the quote behind it has to be theirs: an
 *      internal turn, on a conversation with no second employee who could have
 *      said it. Without that, Customer Service explaining warranty periods on a
 *      transferred segment reads as the salesperson's offer and deletes a real
 *      omission — the Jason Spangler / Patrick's case.
 *   4. AN EXCLUSION COMES FROM THE RULE, AND FROM A REAL LINE. The exclusion
 *      question is bounded by the rule body the caller supplies, and its quote
 *      must be the customer's, the reviewed salesperson's own (solo calls only),
 *      or a note on the validated record. Otherwise "the rule excludes this"
 *      becomes a way to delete anything.
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

/**
 * Rule text as an admin wrote it, which is what makes the exclusion question
 * answerable. `buying_signal_not_closed` carries the clause the Sunny Street Cafe
 * false positive violated; the other two deliberately state none, so "this rule
 * excludes nothing" stays distinguishable from "the auditor found an exclusion".
 */
const RULE_BODIES = new Map([
  ['buying_signal_not_closed', 'The customer gave a clear buying signal and the salesperson never '
    + 'asked for the order. Do NOT flag when the customer asked to be emailed a link, requested a '
    + 'revised quote, or said they needed to discuss it with a partner before deciding — a customer '
    + 'choosing a slower path is not a rep failure.'],
  ['group_expansion_not_captured', 'An opportunity for additional sites was raised on the call and '
    + 'never recorded anywhere in the CRM.'],
  ['no_dated_next_step', 'The call ended with no dated next step on the record.'],
]);

const args = (over: Record<string, unknown> = {}) => ({
  findings: [finding()],
  transcript: TRANSCRIPT,
  provider: 'anthropic' as const,
  conversationId: 'conv-1',
  omissionRuleKeys: OMISSION_KEYS,
  ruleBodies: RULE_BODIES,
  salespersonName: 'Mitchell Reyes',
  // Empty by default; the account-history tests below supply their own.
  salesNotes: '',
  // The default is the attributable case — one employee on the line — because
  // that is the only shape in which this pass is allowed to remove anything.
  attribution: { internalPartyCount: 1, soleInternalParty: true },
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
      reply(JSON.stringify({ verdicts: [{ index: 2, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }] })),
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
    expect(system).toContain('A true verdict is discarded and the finding kept');
  });

  // The auditor's stock unsound removal: the customer asks "does it come with a
  // warranty?" and that question is quoted as proof the rep raised it.
  it('keeps the finding when the auditor quotes the CUSTOMER instead of the rep', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({
        verdicts: [{ index: 1, rep_attempted: true, agent_quote: 'Go ahead and activate it' }],
      })),
    );
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('keeps the finding when the transcript has no speaker labels to attribute by', async () => {
    // A provider whose payload fell through to a verbatim dump. The words may be
    // there, but nothing says who said them, and a removal is a claim about who.
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }] })),
    );
    const res = await verifyFindings(args({
      transcript: 'I can take the card right now if you have it handy.',
    }));
    expect(res.findings).toHaveLength(1);
  });

  it('treats a non-boolean verdict as unproven rather than as attempted', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: 'yes' }] })),
    );
    expect((await verifyFindings(args())).findings).toHaveLength(1);
  });
});

/**
 * The K.C. Salon case. `professionalism_or_compliance` is content-graded, so it
 * used to skip this pass entirely — which left the findings graded purely on
 * judgment as the only ones with no check of any kind. That is how a rule whose
 * body lists margin disclosure, profanity, disparagement and small talk produced
 * a finding about a rep's tone while he correctly explained copyright law.
 *
 * The attempt question still cannot be put to them. The exclusion question can.
 */
describe('verifyFindings — content-graded rules get the exclusion question', () => {
  const CONDUCT = 'professionalism_or_compliance';
  const conduct = finding({
    ruleKey: CONDUCT,
    title: 'Dismissive tone on the licensing objection',
    whatHappened: 'The rep pushed back on the licensing objection in a way that read as dismissive.',
  });

  /** The same rule, with the exclusion it was missing. */
  const withBody = new Map([
    ...RULE_BODIES,
    [CONDUCT, 'The rep said something on a recorded line that creates a professionalism or '
      + 'compliance problem. Do NOT flag ordinary objection handling, a firm but professional '
      + 'explanation of policy or copyright law, or a call where the CUSTOMER was the dismissive '
      + 'party.'],
  ]);

  const contentArgs = (over: Record<string, unknown> = {}) => args({
    findings: [conduct],
    ruleBodies: withBody,
    ...over,
  });

  it('audits a content-graded finding once its rule states an exclusion', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(contentArgs());
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('Dismissive tone on the licensing objection');
    expect(user).toContain('Do NOT flag ordinary objection handling');
  });

  it('tells the auditor to judge it on the exclusion question only', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(contentArgs());
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('GRADED ON CONTENT, NOT ON AN OMISSION');
  });

  it('drops it when the rule\'s exclusion covers the call', async () => {
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{
        index: 1,
        rep_attempted: false,
        agent_quote: null,
        carve_out_applies: true,
        carve_out_quote: 'just email me the link',
      }],
    })));
    const res = await verifyFindings(contentArgs());
    expect(res.findings).toEqual([]);
    expect(res.dropped).toBe(1);
  });

  it('still refuses an attempt verdict on it, however the auditor answers', async () => {
    // A literal "yes they did that" would delete the finding on the grounds that
    // the rep did the very thing it criticises.
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{ index: 1, rep_attempted: true, agent_quote: ATTEMPT_QUOTE }],
    })));
    const res = await verifyFindings(contentArgs());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('does not spend a call on a content-graded rule with no exclusion to check', async () => {
    // Nothing is askable: the attempt question does not apply and the rule states
    // no exclusion. Auditing it anyway would be paying to be told nothing.
    const res = await verifyFindings(args({ findings: [conduct] }));
    expect(res.findings).toHaveLength(1);
    expect(callChatModelMock).not.toHaveBeenCalled();
  });
});

describe('verifyFindings — the attempt question stays off commission-type rules', () => {
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

describe('verifyFindings — attribution gates the attempt verdict', () => {
  const attempted = (quote = ATTEMPT_QUOTE) => reply(JSON.stringify({
    verdicts: [{ index: 1, rep_attempted: true, agent_quote: quote }],
  }));

  const transferred = { internalPartyCount: 2, soleInternalParty: false };

  // The Jason Spangler / Patrick's case. Customer Service explained a five-year
  // extended option on an earlier segment of the conversation; the auditor read
  // that as "the warranty was offered" and deleted the salesperson's real
  // warranty omission. On a call with two employees a transcript line cannot be
  // attributed, so no ATTEMPT removal is possible.
  it('discards an attempt verdict when a second employee was on the conversation', async () => {
    callChatModelMock.mockResolvedValue(attempted());
    const res = await verifyFindings(args({ attribution: transferred }));
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('discards an attempt verdict when the internal party count could not be established', async () => {
    // A phone-system read failure. Unknown is not "probably one".
    callChatModelMock.mockResolvedValue(attempted());
    const res = await verifyFindings(args({
      attribution: { internalPartyCount: null, soleInternalParty: false },
    }));
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  // An exclusion is a statement about the SITUATION — "the customer asked to be
  // emailed a link" is true regardless of which employee was on the line — so
  // unlike the attempt question it survives an unattributable transcript. Before
  // this the whole pass was skipped on a transferred call, which meant a rule's
  // own carve-out went unenforced precisely on the messiest conversations.
  it('still enforces a rule exclusion on a transferred call', async () => {
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{
        index: 1,
        rep_attempted: false,
        agent_quote: null,
        carve_out_applies: true,
        carve_out_quote: 'just email me the link',
      }],
    })));
    const res = await verifyFindings(args({ attribution: transferred }));
    expect(res.findings).toEqual([]);
    expect(res.dropped).toBe(1);
  });

  it('warns the auditor off attributing AGENT turns on a transferred call', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args({ attribution: transferred }));
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('may be a transferred colleague');
    expect(user).toContain('does NOT limit question 2');
  });

  it('still removes on a solo call, so the false-positive control keeps working', async () => {
    callChatModelMock.mockResolvedValue(attempted());
    expect((await verifyFindings(args())).dropped).toBe(1);
  });

  it('names the reviewed salesperson to the auditor so "the rep" is unambiguous', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('REVIEWED SALESPERSON: Mitchell Reyes');
  });

  it('tells the auditor another person doing it is not an attempt', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const system = String((callChatModelMock.mock.calls[0][1] as { system: string }).system);
    expect(system).toContain('ANOTHER PERSON DOING IT IS NOT AN ATTEMPT');
    expect(system).toContain('NEVER the salesperson attempting a sale');
  });
});

describe('verifyFindings — the account-history documentation gate', () => {
  // A note the reviewed salesperson authored is the documentation gate: it can
  // show a documented attempt the transcript alone does not. Rendered note lines
  // carry `by <author>` (crmThread.renderAction), so authorship is checkable.
  const OWN_NOTE = '[2026-09-16 10:00 · by Mitchell Reyes] Offered the five-year extended warranty; customer declined for now.';
  const COLLEAGUE_NOTE = '[2026-09-16 10:00 · by Adrian Cole] Offered the five-year extended warranty; customer declined for now.';
  const NOTE_QUOTE = 'Offered the five-year extended warranty';

  it('drops a finding a note the reviewed salesperson authored documents as attempted', async () => {
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true, agent_quote: NOTE_QUOTE }] })),
    );
    const res = await verifyFindings(args({ salesNotes: OWN_NOTE }));
    expect(res.dropped).toBe(1);
    expect(res.findings).toEqual([]);
  });

  it('keeps the finding when the documenting note was authored by a colleague', async () => {
    // A colleague's note is not this salesperson's attempt — the documentation
    // gate is per author, so Customer Service's note cannot clear the miss.
    callChatModelMock.mockResolvedValue(
      reply(JSON.stringify({ verdicts: [{ index: 1, rep_attempted: true, agent_quote: NOTE_QUOTE }] })),
    );
    const res = await verifyFindings(args({ salesNotes: COLLEAGUE_NOTE }));
    expect(res.dropped).toBe(0);
    expect(res.findings).toHaveLength(1);
  });

  it('shows the auditor the account history and how to weigh authorship', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args({ salesNotes: OWN_NOTE }));
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('ACCOUNT HISTORY');
    expect(user).toContain('Offered the five-year extended warranty');
    const system = String((callChatModelMock.mock.calls[0][1] as { system: string }).system);
    expect(system).toContain('ACCOUNT HISTORY CAN DOCUMENT AN ATTEMPT');
  });
});

/**
 * The Sunny Street Cafe case. `buying_signal_not_closed` says in its own body
 * "Do NOT flag when the customer asked to be emailed a link, requested a revised
 * quote, or said they needed to discuss it with a partner", and nothing enforced
 * that clause anywhere: the grading pass was merely asked to honour it, and the
 * verification pass only ever asked whether the rep ATTEMPTED the close. On a
 * call where the rep genuinely never asked for the order but the customer had
 * plainly chosen a slower path, both questions answered "keep it" and a good call
 * was reported as a miss.
 */
describe('verifyFindings — the rule\'s own exclusions', () => {
  const excluded = (quote: string | null) => reply(JSON.stringify({
    verdicts: [{
      index: 1,
      rep_attempted: false,
      agent_quote: null,
      carve_out_applies: true,
      carve_out_quote: quote,
    }],
  }));

  it('drops a finding the rule excludes, on the CUSTOMER\'S line', async () => {
    // The exclusion is proved by what the customer said, which is why this
    // question resolves quotes against either speaker while the attempt question
    // does not.
    callChatModelMock.mockResolvedValue(excluded('just email me the link'));
    const res = await verifyFindings(args());
    expect(res.findings).toEqual([]);
    expect(res.dropped).toBe(1);
  });

  it('keeps the finding when the exclusion cites no quote', async () => {
    callChatModelMock.mockResolvedValue(excluded(null));
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('keeps the finding when the exclusion quotes a line nobody said', async () => {
    // The removal has to be as checkable as the attempt removal, or "the rule
    // excludes this" becomes a way to delete anything.
    callChatModelMock.mockResolvedValue(excluded('the customer told me to hold off entirely'));
    const res = await verifyFindings(args());
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('accepts an exclusion documented in the account history', async () => {
    callChatModelMock.mockResolvedValue(excluded('partner is out until the 24th'));
    const res = await verifyFindings(args({
      salesNotes: '[2026-09-16 10:00 · by Mitchell Reyes] Sending revised quote; partner is out until the 24th.',
    }));
    expect(res.dropped).toBe(1);
  });

  it('treats a non-boolean exclusion verdict as no exclusion', async () => {
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{ index: 1, carve_out_applies: 'yes', carve_out_quote: 'just email me the link' }],
    })));
    expect((await verifyFindings(args())).findings).toHaveLength(1);
  });

  it('counts a finding once when both questions vote to drop it', async () => {
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{
        index: 1,
        rep_attempted: true,
        agent_quote: ATTEMPT_QUOTE,
        carve_out_applies: true,
        carve_out_quote: 'just email me the link',
      }],
    })));
    const res = await verifyFindings(args());
    expect(res.dropped).toBe(1);
    expect(res.findings).toEqual([]);
  });

  it('shows the auditor the rule text verbatim, so a new clause needs no deploy', async () => {
    // The exclusions are admin-editable content. Passing the body whole rather
    // than pattern-matching clauses here is what makes a differently worded
    // carve-out enforceable without a code change.
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('RULE (buying_signal_not_closed) AS WRITTEN:');
    expect(user).toContain('Do NOT flag when the customer asked to be emailed a link');
  });

  it('tells the auditor an exclusion must come from the rule\'s own words', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args());
    const system = String((callChatModelMock.mock.calls[0][1] as { system: string }).system);
    expect(system).toContain('DOES THE RULE\'S OWN EXCLUSION APPLY?');
    expect(system).toContain('Do NOT invent an exclusion the rule does not state');
  });

  it('accepts the rep\'s own spoken line on a solo call', async () => {
    // With one employee on the line an AGENT turn is provably theirs, so it can
    // satisfy an exclusion phrased about what the rep said.
    callChatModelMock.mockResolvedValue(excluded('I can take the card right now'));
    expect((await verifyFindings(args())).dropped).toBe(1);
  });

  it('refuses the same line once a second employee was on the call', async () => {
    callChatModelMock.mockResolvedValue(excluded('I can take the card right now'));
    const res = await verifyFindings(args({
      attribution: { internalPartyCount: 2, soleInternalParty: false },
    }));
    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('says so when a rule body was not supplied, instead of inviting a guess', async () => {
    callChatModelMock.mockResolvedValue(reply('{"verdicts":[]}'));
    await verifyFindings(args({ ruleBodies: new Map() }));
    const user = String((callChatModelMock.mock.calls[0][1] as { user: string }).user);
    expect(user).toContain('rule text unavailable');
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
