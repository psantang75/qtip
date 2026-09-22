/**
 * Analyzer parsing + prompt-assembly tests.
 *
 * `parseFindings` is the trust boundary between a language model and a table
 * the report reads as fact. It must be tolerant of shape (fences, wrappers,
 * bare arrays) and strict about content: an unknown `rule_key` or a finding
 * missing `recommended_approach` is worse than no finding at all, because the
 * report would show a miss it cannot explain or attribute.
 *
 * `analyzeCall` must never throw — one bad transcript costing every other
 * agent their findings is the failure mode the whole PARTIAL status exists for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callChatModelMock } = vi.hoisted(() => ({ callChatModelMock: vi.fn() }));

vi.mock('../../../ai/ChatModelClient', () => ({
  callChatModel: (...args: unknown[]) => callChatModelMock(...args),
  // The verification pass runs on the cheap model regardless of the run's tier.
  resolveCheapModelName: () => 'gpt-5-mini',
}));

// The real logger writes files; the real cost logger writes to prisma.
vi.mock('../../../aiCallLogger', () => ({
  withCallLog: async (
    _meta: unknown,
    _prompt: unknown,
    fn: () => Promise<{ result: unknown }>,
  ) => (await fn()).result,
}));

import {
  analyzeCall,
  buildSystemPrompt,
  buildUserPrompt,
  parseFindings,
  resolveTierModel,
} from '../analyzer';
import type { CallMaterial, MissedOpportunityRule } from '../types';

const VALID = new Set(['buying_signal_not_closed', 'no_dated_next_step']);
const DEFAULTS = new Map([
  ['buying_signal_not_closed', 'high'],
  ['no_dated_next_step', 'low'],
]);

const finding = (over: Record<string, unknown> = {}) => ({
  rule_key: 'buying_signal_not_closed',
  severity: 'high',
  title: 'Did not ask for the order',
  what_happened: 'The owner said he wanted it installed before the holidays and the rep moved on.',
  // Must appear verbatim in `material().transcript` below: analyzeCall now
  // resolves every quote against the material the call was actually shown.
  evidence_quote: 'I want this before Thanksgiving',
  evidence_speaker: 'CUSTOMER',
  recommended_approach: 'Ask for the order: "I can have the installer out Tuesday — want me to book it?"',
  recovery_action: 'Call Mabels this morning and book Tuesday install. Do not send another quote and wait.',
  est_value_note: '~$2,400 ARR',
  customer_name: 'Mabels Diner',
  ...over,
});

const REFS = new Set(['TASK 12345', 'TICKET 987']);

const parse = (raw: string) => parseFindings({
  raw,
  validRuleKeys: VALID,
  defaultSeverityByRule: DEFAULTS,
  validCrmRefs: REFS,
});

beforeEach(() => vi.clearAllMocks());

describe('parseFindings — accepted shapes', () => {
  it('parses the documented {findings:[...]} object', () => {
    const { findings } = parse(JSON.stringify({ findings: [finding()] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleKey).toBe('buying_signal_not_closed');
    expect(findings[0].recommendedApproach).toContain('book it');
    expect(findings[0].recoveryAction).toContain('this morning');
  });

  it('parses a bare array', () => {
    expect(parse(JSON.stringify([finding()])).findings).toHaveLength(1);
  });

  it('unwraps a ```json fence, which both providers emit despite JSON mode', () => {
    const raw = '```json\n' + JSON.stringify({ findings: [finding()] }) + '\n```';
    expect(parse(raw).findings).toHaveLength(1);
  });

  it('accepts the missed_opportunities and items aliases', () => {
    expect(parse(JSON.stringify({ missed_opportunities: [finding()] })).findings).toHaveLength(1);
    expect(parse(JSON.stringify({ items: [finding()] })).findings).toHaveLength(1);
  });

  it('reads a top-level customer_name and applies it to findings that lack one', () => {
    const raw = JSON.stringify({
      customer_name: 'Riverbend Dental',
      findings: [finding({ customer_name: null })],
    });
    const out = parse(raw);
    expect(out.customerName).toBe('Riverbend Dental');
    expect(out.findings[0].customerName).toBe('Riverbend Dental');
  });
});

describe('parseFindings — malformed output', () => {
  it('returns no findings for output that is not JSON at all', () => {
    expect(parse('I reviewed the call and found nothing.').findings).toEqual([]);
  });

  it('returns no findings for truncated JSON rather than throwing', () => {
    expect(() => parse('{"findings":[{"rule_key":"buying')).not.toThrow();
    expect(parse('{"findings":[{"rule_key":"buying').findings).toEqual([]);
  });

  it('treats an empty findings array as a valid clean call', () => {
    const out = parse(JSON.stringify({ findings: [] }));
    expect(out.findings).toEqual([]);
    expect(out.customerName).toBeNull();
  });

  it('drops an unknown rule_key so the report cannot show a phantom category', () => {
    const raw = JSON.stringify({ findings: [finding({ rule_key: 'invented_rule' })] });
    expect(parse(raw).findings).toEqual([]);
  });

  it('skips one malformed finding but keeps the rest of the batch', () => {
    const raw = JSON.stringify({
      findings: [
        finding({ rule_key: 'invented_rule' }),
        'not an object',
        finding({ rule_key: 'no_dated_next_step' }),
      ],
    });
    const { findings } = parse(raw);
    expect(findings.map((f) => f.ruleKey)).toEqual(['no_dated_next_step']);
  });

  it.each(['title', 'what_happened', 'recommended_approach'])(
    'drops a finding missing %s — the column is NOT NULL and the field is the point',
    (field) => {
      const raw = JSON.stringify({ findings: [finding({ [field]: null })] });
      expect(parse(raw).findings).toEqual([]);
    },
  );

  it('falls back to the rule default when severity is unknown', () => {
    const raw = JSON.stringify({ findings: [finding({ severity: 'catastrophic' })] });
    expect(parse(raw).findings[0].severity).toBe('high');
  });

  it('falls back to medium when the rule has no default either', () => {
    const raw = JSON.stringify({ findings: [finding({ severity: null })] });
    const { findings } = parseFindings({
      raw,
      validRuleKeys: VALID,
      defaultSeverityByRule: new Map(),
    });
    expect(findings[0].severity).toBe('medium');
  });

  it('keeps a citation the model was actually shown', () => {
    const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: 'TASK 12345' })] })).findings;
    expect(only.crmRefKind).toBe('TASK');
    expect(only.crmRefId).toBe(12345);
  });

  it('accepts the ticket side too, since a rep logs on both', () => {
    const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: 'TICKET 987' })] })).findings;
    expect(only.crmRefKind).toBe('TICKET');
    expect(only.crmRefId).toBe(987);
  });

  it('tolerates the punctuation the model drifts into', () => {
    for (const cited of ['task 12345', 'TASK#12345', 'Task: 12345', '  TASK 12345 ']) {
      const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: cited })] })).findings;
      expect(only.crmRefId).toBe(12345);
    }
  });

  // The whole point of validating: a wrong id deep-links a manager into someone
  // else's CRM record, which is worse than showing no link at all.
  it('drops an id the model was never shown, however plausible it looks', () => {
    const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: 'TASK 99999' })] })).findings;
    expect(only.crmRefKind).toBeNull();
    expect(only.crmRefId).toBeNull();
  });

  it('does not let a real id cross record kinds', () => {
    const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: 'TICKET 12345' })] })).findings;
    expect(only.crmRefId).toBeNull();
  });

  it('leaves the citation null when the model omits or nulls it', () => {
    for (const cited of [undefined, null, '', 'null', 'the Mabels Diner task', 42]) {
      const [only] = parse(JSON.stringify({ findings: [finding({ crm_ref: cited })] })).findings;
      expect(only.crmRefId).toBeNull();
    }
  });

  it('cites nothing when the agent had no CRM activity to cite', () => {
    const raw = JSON.stringify({ findings: [finding({ crm_ref: 'TASK 12345' })] });
    const { findings } = parseFindings({
      raw,
      validRuleKeys: VALID,
      defaultSeverityByRule: DEFAULTS,
    });
    expect(findings[0].crmRefId).toBeNull();
  });

  it('attributes the evidence quote to the speaker the model named', () => {
    const [f] = parse(JSON.stringify({ findings: [finding({ evidence_speaker: 'CUSTOMER' })] })).findings;
    expect(f.evidenceSpeaker).toBe('CUSTOMER');
  });

  it('maps rep/agent synonyms to AGENT', () => {
    for (const said of ['AGENT', 'agent', 'rep', 'salesperson']) {
      const [f] = parse(JSON.stringify({ findings: [finding({ evidence_speaker: said })] })).findings;
      expect(f.evidenceSpeaker).toBe('AGENT');
    }
  });

  it('rejects a finding with no quote, regardless of claimed speaker', () => {
    expect(parse(JSON.stringify({ findings: [finding({ evidence_quote: null, evidence_speaker: 'CUSTOMER' })] })).findings).toEqual([]);
  });

  it('nulls an unrecognised speaker rather than storing garbage', () => {
    const [f] = parse(JSON.stringify({ findings: [finding({ evidence_speaker: 'the manager' })] })).findings;
    expect(f.evidenceSpeaker).toBeNull();
  });

  it('normalises the literal string "null" to a null optional field', () => {
    const raw = JSON.stringify({ findings: [finding({ est_value_note: 'NULL' })] });
    const [only] = parse(raw).findings;
    expect(only.estValueNote).toBeNull();
  });

  it('keeps the finding when recovery_action is omitted — it is optional', () => {
    const raw = JSON.stringify({ findings: [finding({ recovery_action: null })] });
    const [only] = parse(raw).findings;
    expect(only.title).toBe('Did not ask for the order');
    expect(only.recoveryAction).toBeNull();
  });

  it('keeps only the first finding per rule, per the one-per-rule-per-call rule', () => {
    const raw = JSON.stringify({
      findings: [finding({ title: 'First' }), finding({ title: 'Duplicate' })],
    });
    const { findings } = parse(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('First');
  });

  it('truncates an over-long field to its column width instead of failing the insert', () => {
    const raw = JSON.stringify({ findings: [finding({ title: 'x'.repeat(500) })] });
    expect(parse(raw).findings[0].title).toHaveLength(240);
  });

  it('truncates an over-long recovery_action to its cap', () => {
    const raw = JSON.stringify({ findings: [finding({ recovery_action: 'x'.repeat(2000) })] });
    expect(parse(raw).findings[0].recoveryAction).toHaveLength(1200);
  });
});

describe('parseFindings — evidence must resolve to the material', () => {
  const TRANSCRIPT = 'AGENT: Thanks for calling.\nCUSTOMER: Can you get someone out this week?';
  const NOTES = 'Called back, left voicemail about the Tuesday install window.';

  const evidence = (over: Record<string, unknown> = {}) => ({
    transcript: TRANSCRIPT,
    salesNotes: NOTES,
    ticketNotes: '',
    leadsCreated: '',
    salespersonName: 'Jane Rep',
    soleInternalParty: true,
    ...over,
  });

  /** `null` means "no material supplied", which is the fail-open path. */
  const parseAgainst = (raw: string, ev: ReturnType<typeof evidence> | null = evidence()) =>
    parseFindings({
      raw,
      validRuleKeys: VALID,
      defaultSeverityByRule: DEFAULTS,
      validCrmRefs: REFS,
      evidence: ev ?? undefined,
    });

  it('keeps a finding whose quote is really in the transcript', () => {
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'Can you get someone out this week?' })],
    });
    const { findings, rejectedQuotes } = parseAgainst(raw);
    expect(findings).toHaveLength(1);
    expect(rejectedQuotes).toEqual([]);
  });

  it('keeps a finding quoting the CRM notes, not just the transcript', () => {
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'left voicemail about the Tuesday install window' })],
    });
    expect(parseAgainst(raw).findings).toHaveLength(1);
  });

  it('drops a finding whose quote appears nowhere in the material', () => {
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'I will take two of them right now' })],
    });
    expect(parseAgainst(raw).findings).toEqual([]);
  });

  it('reports the rejected quote and its rule, so a drop is diagnosable', () => {
    // Nothing else retains it: the finding is never stored and ai_call_logs
    // keeps only a prompt hash. Counting alone cannot tell a caught
    // fabrication from a matcher that is too strict.
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'I will take two of them right now' })],
    });
    expect(parseAgainst(raw).rejectedQuotes).toEqual([
      { ruleKey: 'buying_signal_not_closed', quote: 'I will take two of them right now' },
    ]);
  });

  it('does not let a drop consume the one-per-rule slot', () => {
    // The rejected finding must not mark its rule as seen, or a fabricated
    // quote would suppress the same rule's well-evidenced second attempt.
    const raw = JSON.stringify({
      findings: [
        finding({ evidence_quote: 'I will take two of them right now' }),
        finding({ evidence_quote: 'Can you get someone out this week?' }),
      ],
    });
    const { findings, rejectedQuotes } = parseAgainst(raw);
    expect(rejectedQuotes).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceQuote).toBe('Can you get someone out this week?');
  });

  it('counts and drops a quote-less finding', () => {
    const raw = JSON.stringify({ findings: [finding({ evidence_quote: null })] });
    const { findings, missingQuotes, rejectedQuotes } = parseAgainst(raw);
    expect(findings).toHaveLength(0);
    expect(missingQuotes).toBe(1);
    expect(rejectedQuotes).toEqual([]);
  });

  it('fails open when no material was supplied to check against', () => {
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'I will take two of them right now' })],
    });
    expect(parseAgainst(raw, null).findings).toHaveLength(1);
  });

  it('keeps a quote from the ticket block — it is real text the model was shown', () => {
    const raw = JSON.stringify({
      findings: [finding({ evidence_quote: 'RMA issued for the failed player' })],
    });
    const ev = evidence({ ticketNotes: '[TICKET 289807] RMA issued for the failed player.' });
    expect(parseAgainst(raw, ev).findings).toHaveLength(1);
  });
});

describe('parseFindings — AGENT attribution must be earned', () => {
  // `[time — Agent]` is what formatTranscriptContent renders, and it means "our
  // side of the line", not "this employee".
  const TRANSCRIPT = [
    '[00:01 — Agent] I can get that replacement player out today.',
    '[00:14 — Customer] does the warranty carry over?',
  ].join('\n');
  const SALES_NOTES = [
    '[TASK 1120497 · action 8561828 · 2026-09-17 14:05 · by Jason Spangler] Ordered the replacement unit.',
    '[TASK 1120497 · action 8561900 · 2026-09-17 15:20 · by Dana Fields] Confirmed shipping address.',
  ].join('\n');
  const TICKET_NOTES = '[TICKET 289807 · by Support Team] There is also a five year extended option.';

  const parseAs = (quote: string, over: Record<string, unknown> = {}) => parseFindings({
    raw: JSON.stringify({
      findings: [finding({ evidence_quote: quote, evidence_speaker: 'AGENT' })],
    }),
    validRuleKeys: VALID,
    defaultSeverityByRule: DEFAULTS,
    evidence: {
      transcript: TRANSCRIPT,
      salesNotes: SALES_NOTES,
      ticketNotes: TICKET_NOTES,
      leadsCreated: '',
      salespersonName: 'Jason Spangler',
      soleInternalParty: true,
      ...over,
    },
  });

  it('keeps AGENT for the salesperson\'s own turn on a solo call', () => {
    const out = parseAs('I can get that replacement player out today');
    expect(out.findings[0].evidenceSpeaker).toBe('AGENT');
    expect(out.unattributedSpeakers).toBe(0);
  });

  it('keeps AGENT for a note on the sales record they authored', () => {
    expect(parseAs('Ordered the replacement unit').findings[0].evidenceSpeaker).toBe('AGENT');
  });

  // The Jason warranty case in miniature: the sentence exists, Customer Service
  // said it, and labelling it AGENT would show a manager the reviewed
  // salesperson offering a warranty they never mentioned.
  it('withdraws AGENT from a ticket note another team wrote', () => {
    const out = parseAs('There is also a five year extended option');
    expect(out.findings[0].evidenceSpeaker).toBeNull();
    expect(out.unattributedSpeakers).toBe(1);
    // The finding itself survives — the miss can still be real.
    expect(out.findings).toHaveLength(1);
  });

  it('withdraws AGENT from a colleague\'s note on the same record', () => {
    expect(parseAs('Confirmed shipping address').findings[0].evidenceSpeaker).toBeNull();
  });

  it('withdraws AGENT from an internal turn when a second employee was on the call', () => {
    const out = parseAs('I can get that replacement player out today', { soleInternalParty: false });
    expect(out.findings[0].evidenceSpeaker).toBeNull();
    expect(out.unattributedSpeakers).toBe(1);
  });

  it('withdraws AGENT from a line the customer spoke', () => {
    expect(parseAs('does the warranty carry over').findings[0].evidenceSpeaker).toBeNull();
  });

  it('leaves a CUSTOMER-attributed quote alone', () => {
    const out = parseFindings({
      raw: JSON.stringify({
        findings: [finding({
          evidence_quote: 'does the warranty carry over',
          evidence_speaker: 'CUSTOMER',
        })],
      }),
      validRuleKeys: VALID,
      defaultSeverityByRule: DEFAULTS,
      evidence: {
        transcript: TRANSCRIPT,
        salesNotes: SALES_NOTES,
        ticketNotes: '',
        leadsCreated: '',
        salespersonName: 'Jason Spangler',
        soleInternalParty: true,
      },
    });
    expect(out.findings[0].evidenceSpeaker).toBe('CUSTOMER');
    expect(out.unattributedSpeakers).toBe(0);
  });
});

describe('buildSystemPrompt', () => {
  const rules: MissedOpportunityRule[] = [{
    rule_key: 'buying_signal_not_closed',
    rule_name: 'Buying signal not closed',
    category: 'Closing',
    severity: 'high',
    body_md: 'Customer states intent and the rep does not ask for the order.',
    guidance_md: null,
    is_omission: true,
  }];

  it('appends the rendered rules under an exclusive-scope header', () => {
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('RULES (these are the only misses you may report):');
    expect(prompt).toContain('RULE buying_signal_not_closed —');
  });

  it('omits the RULES block entirely when there are none, rather than an empty header', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain('RULES (');
  });

  it('always states that an empty result is valid, so the model does not invent misses', () => {
    expect(buildSystemPrompt(rules)).toContain('empty findings array');
  });

  // The instruction this replaces was an unqualified "credit prior documented
  // completion", which is how a warranty mentioned anywhere on the account — a
  // support ticket, a different site's order — cleared a salesperson's omission.
  it('gates a prior-completion exception on the validated sales record', () => {
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('ONLY THE VALIDATED SALES RECORD CAN EXCUSE A MISSING STEP');
    expect(prompt).toContain('SAME requirement and the SAME transaction');
    expect(prompt).not.toContain('Credit prior documented completion');
  });

  it('states that the salesperson owns the sales attempt', () => {
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('THE SALESPERSON OWNS THE SALES ATTEMPT');
    expect(prompt).toContain('NEVER transfers credit to the salesperson under review');
  });

  it('keeps the record roles apart so a ticket cannot become sales documentation', () => {
    expect(buildSystemPrompt(rules)).toContain('a support ticket');
  });

  it('requires disconfirming evidence before alleging the rep never made the move', () => {
    // evidence_quote only ever proves the OPENING existed. Without this, a rep
    // who asked for the card and was told "email me the link" grades as an
    // unclosed buying signal.
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('re-read the transcript for THIS salesperson attempting it');
    expect(prompt).toContain('that is NOT a miss');
  });

  it('makes insufficient evidence its own answer, not a clean call or a failure', () => {
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('INSUFFICIENT EVIDENCE IS ITS OWN ANSWER');
    expect(prompt).toContain('never treat unavailable or omitted material as proof the call was clean');
  });

  it('exempts the quality-of-execution rules from the did-not-do test', () => {
    // The rep demonstrably DID leave the voicemail and DID say the thing on the
    // recorded line, so an unscoped test silences those rules entirely — it cost
    // a day's run 9 of 11 voicemail findings and the one compliance finding.
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('This test applies ONLY to those did-not-do misses');
    expect(prompt).toContain('HOW WELL the rep did something they plainly did');
  });

  it('scopes "absence is evidence" to what the CRM sections actually show', () => {
    // Unqualified, this instruction turned a known blind spot into an
    // accusation: neither CRM view covers a record created on another account,
    // so "never captured the other two locations" was asserted, not observed.
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('ONLY for steps the blocks you were shown would actually contain');
    expect(prompt).toContain('never state as fact that it was not done');
  });

  it('asks for the speaker behind the evidence quote', () => {
    expect(buildSystemPrompt(rules)).toContain('evidence_speaker');
  });

  it('asks for a recovery action distinct from the rewind-the-tape line', () => {
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('recovery_action');
    expect(prompt).toContain('after the call has ended');
    expect(prompt).toContain('rewind-the-tape line');
  });

  it('keeps the coaching valid when someone else already recovered the account', () => {
    // A CS rep fixing the customer's problem can leave nothing to recover while
    // the salesperson's on-call omission stands. Conflating the two is what
    // withdrew valid findings.
    expect(buildSystemPrompt(rules)).toContain('SEPARATE COACHING FROM RECOVERY');
  });

  it('opens with the default expert-SMB persona when none is supplied', () => {
    expect(buildSystemPrompt(rules)).toContain('expert sales manager');
  });

  it('prepends a custom persona ahead of the fixed contract', () => {
    const prompt = buildSystemPrompt(rules, 'ACT AS A SKEPTICAL AUDITOR');
    expect(prompt.startsWith('ACT AS A SKEPTICAL AUDITOR')).toBe(true);
    // The fixed contract still follows so the JSON shape can't be edited away.
    expect(prompt).toContain('empty findings array');
    expect(prompt).toContain('RULES (these are the only misses you may report):');
  });

  it('falls back to the default persona when given only whitespace', () => {
    expect(buildSystemPrompt(rules, '   ')).toContain('expert sales manager');
  });

  it('carries the no-free-product guardrail by default', () => {
    expect(buildSystemPrompt(rules)).toMatch(/free product/i);
  });

  it('appends a scoped grounding block only when grounding text is supplied', () => {
    const withGround = buildSystemPrompt(rules, undefined, '# How to ARP\nAcknowledge, Reframe, Present.');
    expect(withGround).toContain('COMPANY KB AND APPROVED SALES PLAYS');
    expect(withGround).toContain('Acknowledge, Reframe, Present.');
    // It must be scoped to wording, never a new miss.
    expect(withGround).toContain('does NOT create new rule keys');
  });

  it('omits the grounding block when none is supplied', () => {
    expect(buildSystemPrompt(rules)).not.toContain('GROUNDING FOR RECOMMENDATIONS');
  });
});

const material = (over: Partial<CallMaterial> = {}): CallMaterial => ({
  conversationId: 'conv-1',
  agentName: 'Jane Rep',
  agentEmail: 'jane@example.com',
  phoneUserId: 'pu-1',
  startedAt: new Date('2026-09-04T14:30:00Z'),
  dateKey: 20260904,
  direction: 'outbound',
  talkSecs: 420,
  remoteParty: 'Sappington MO',
  wrapUpCode: 'Quote Sent',
  transcript: 'Agent: thanks for calling.\nCustomer: I want this before Thanksgiving.',
  crm: {
    notes: '[TASK 12345 · 9:42 AM — Call / Quote Sent / Mabels Diner] Sent pricing.',
    refs: ['TASK 12345'],
  },
  // '' is "the lookup ran and found none", which is the answer the expansion
  // rule needs. null would mean the lookup failed — a different prompt.
  leadsCreated: '',
  // Solo call by default, so the tests that are not about attribution read the
  // simple case. The unattributable shapes are asserted explicitly below.
  attribution: { internalPartyCount: 1, soleInternalParty: true },
  ...over,
});

describe('buildUserPrompt', () => {
  it('includes the transcript and the same-day CRM notes', () => {
    const prompt = buildUserPrompt(material());
    expect(prompt).toContain('before Thanksgiving');
    expect(prompt).toContain('Sent pricing.');
  });

  it('carries the record refs through, so a citation has something to name', () => {
    expect(buildUserPrompt(material())).toContain('TASK 12345');
  });

  it('says so explicitly when the agent logged no notes — absence is itself evidence', () => {
    expect(buildUserPrompt(material({ crm: { notes: '', refs: [] } }))).toContain('logged no CRM notes');
  });

  it('labels the remote party as a geo hint so it is not read as a business name', () => {
    expect(buildUserPrompt(material())).toContain('often a city/state, not the business name');
  });

  it('frames the CRM block as the validated sales record set when one resolved', () => {
    const prompt = buildUserPrompt(material({
      crm: { notes: 'prior thread', refs: ['TASK 5'], scope: 'record', recordLabel: 'TASK 5 — Acme' },
    }));
    expect(prompt).toContain('SALES RECORD HISTORY — TASK 5 — Acme');
    expect(prompt).toContain('prior thread');
  });

  it('names the exception gate on the block that is allowed to satisfy it', () => {
    const prompt = buildUserPrompt(material({
      crm: { notes: 'prior thread', refs: ['TASK 5'], scope: 'record' },
    }));
    expect(prompt).toContain('A prior-completion exception MUST cite an action id from this block');
    expect(prompt).toContain('a topic merely being mentioned is not a documented disposition');
  });

  it('says so when a resolved record has no prior notes, distinct from a no-notes day', () => {
    const prompt = buildUserPrompt(material({ crm: { notes: '', refs: [], scope: 'record' } }));
    expect(prompt).toContain('no substantive notes on these records');
  });

  it('marks the day-wide fallback as not an account history', () => {
    // A failed record resolution used to hand the model another customer's
    // day-wide notes under a header claiming they were this call's record.
    const prompt = buildUserPrompt(material({ crm: { notes: 'other stuff', refs: [] } }));
    expect(prompt).toContain('day-wide fallback');
    expect(prompt).toContain('cannot establish what this account');
  });
});

describe('buildUserPrompt — whose evidence is whose', () => {
  it('says the AGENT label is this salesperson on a solo call', () => {
    expect(buildUserPrompt(material())).toContain(
      'ATTRIBUTION: Jane Rep was the only internal party',
    );
  });

  // The Jason Spangler case: a Customer Service segment on the same conversation
  // renders as "Agent" too, and the reviewer credited CS's warranty explanation
  // to the salesperson.
  it('warns that an AGENT turn may be another employee when the call was transferred', () => {
    const prompt = buildUserPrompt(material({
      attribution: { internalPartyCount: 2, soleInternalParty: false },
    }));
    expect(prompt).toContain('2 internal parties were on this conversation');
    expect(prompt).toContain('may therefore be ANOTHER EMPLOYEE');
    expect(prompt).toContain('treat the attempt as unestablished');
  });

  it('treats an unknown party count as unattributable, not as a solo call', () => {
    const prompt = buildUserPrompt(material({
      attribution: { internalPartyCount: null, soleInternalParty: false },
    }));
    expect(prompt).toContain('could not establish how many internal parties');
  });

  it('renders tickets in their own block, demoted to operational context', () => {
    const prompt = buildUserPrompt(material({
      crm: {
        notes: 'lead history',
        refs: ['TASK 5'],
        scope: 'record',
        ticketNotes: '[TICKET 289807] Five year extended option explained.',
      },
    }));
    expect(prompt).toContain('SUPPORT / BILLING / RETURN TICKET CONTEXT');
    expect(prompt).toContain('can NOT satisfy a sales requirement');
    expect(prompt).toContain('not even when an Account Executive wrote the note');
    expect(prompt).toContain('Five year extended option explained.');
  });

  it('omits the ticket block entirely when there are no tickets', () => {
    expect(buildUserPrompt(material())).not.toContain('TICKET CONTEXT');
  });

  it('reports the resolution outcome and reason so trust is calibrated', () => {
    const prompt = buildUserPrompt(material({
      crm: {
        notes: 'x',
        refs: ['TASK 5'],
        scope: 'record',
        resolution: {
          outcome: 'provisional',
          reason: 'phone match only; no corroborating detail on the call',
          numbers: [],
          salesRefs: ['TASK 5'],
          primaryRef: 'TASK 5',
          ticketRefs: [],
          duplicatePath: [],
          rejected: [{ ref: 'TASK 1058436', reason: 'different account' }],
          crossAccount: false,
        },
      },
    }));
    expect(prompt).toContain('PROVISIONAL');
    expect(prompt).toContain('phone match only');
    expect(prompt).toContain('REJECTED CANDIDATES: TASK 1058436 (different account)');
    expect(prompt).toContain('PRIMARY SALES RECORD: TASK 5');
  });

  it('tells the model to cite nothing when no primary record was established', () => {
    const prompt = buildUserPrompt(material({
      crm: {
        notes: '',
        refs: [],
        scope: 'record',
        resolution: {
          outcome: 'unmatched',
          reason: 'the customer number matches no CRM contact',
          numbers: [],
          salesRefs: [],
          primaryRef: null,
          ticketRefs: [],
          duplicatePath: [],
          rejected: [],
          crossAccount: false,
        },
      },
    }));
    expect(prompt).toContain('UNMATCHED');
    expect(prompt).toContain('Absence of documentation here is NOT evidence a step was missed');
    expect(prompt).toContain('PRIMARY SALES RECORD: none established');
  });

  it('states a coverage gap instead of letting it read as complete history', () => {
    const prompt = buildUserPrompt(material({
      crm: {
        notes: 'x',
        refs: [],
        scope: 'record',
        coverage: {
          recordsRead: ['TASK 5'],
          rowsRetrieved: 60,
          rowsRendered: 25,
          rowsOmitted: 35,
          cutoff: '2026-09-04',
          truncated: true,
          errors: [],
        },
      },
    }));
    expect(prompt).toContain('NOT SHOWN: 35');
    expect(prompt).toContain('TRUNCATED');
    expect(prompt).toContain('you may NOT conclude that a topic was never documented');
  });

  it('shows the duplicate trail that led to the record it chose', () => {
    const prompt = buildUserPrompt(material({
      crm: {
        notes: 'x',
        refs: [],
        scope: 'record',
        resolution: {
          outcome: 'provisional',
          reason: 'followed a duplicate closure to its successor',
          numbers: [],
          salesRefs: ['TASK 856321'],
          primaryRef: 'TASK 856321',
          ticketRefs: [],
          duplicatePath: ['TASK 856216 duplicate-closed → TASK 856321'],
          rejected: [],
          crossAccount: true,
        },
      },
    }));
    expect(prompt).toContain('DUPLICATE TRAIL: TASK 856216 duplicate-closed → TASK 856321');
    expect(prompt).toContain('CROSS-ACCOUNT');
  });

  it('renders the leads the rep created, which is how an expansion claim gets checked', () => {
    const prompt = buildUserPrompt(material({
      leadsCreated: '[LEAD 4455 · TASK 1116999 · 4:58 PM] Mercado California Oakland / Inbound Call',
    }));
    expect(prompt).toContain('NEW LEADS JANE REP CREATED IN THE CRM THIS SAME DAY');
    expect(prompt).toContain('Mercado California Oakland');
  });

  it('states the rep created no leads rather than omitting the section', () => {
    // The expansion rule needs "created none" as an answer; an absent section
    // would read as "we did not look", which the contract forbids acting on.
    expect(buildUserPrompt(material())).toContain('created no new leads on this date');
  });

  it('marks the created leads as uncitable so they cannot become a deep link', () => {
    expect(buildUserPrompt(material())).toContain('NOT citable in crm_ref');
  });

  // A failed CRM lookup returned the same empty block as a rep who really
  // created nothing, so an outage rendered as the sentence "created no new
  // leads on this date" — a stated fact the contract forbids inferring from a
  // section that could not be read.
  it('says the lookup failed instead of asserting the rep created nothing', () => {
    const prompt = buildUserPrompt(material({ leadsCreated: null }));
    expect(prompt).toContain('THIS LOOKUP FAILED');
    expect(prompt).not.toContain('created no new leads on this date');
  });
});

describe('resolveTierModel', () => {
  it('pins a cheap model per provider for the high-volume default tier', () => {
    expect(resolveTierModel('openai', 'cheap')).toBe('gpt-5-mini');
    expect(resolveTierModel('anthropic', 'cheap')).toBe('claude-sonnet-4-6');
  });

  it('defers to the provider default on the reasoning tier', () => {
    expect(resolveTierModel('openai', 'reasoning')).toBeUndefined();
  });
});

describe('analyzeCall', () => {
  const args = {
    provider: 'openai' as const,
    model: 'gpt-5-mini',
    systemPrompt: 'system',
    validRuleKeys: VALID,
    defaultSeverityByRule: DEFAULTS,
    omissionRuleKeys: VALID,
    // The verification pass is shown each rule's text so it can enforce that
    // rule's own exclusions. These fixtures state none, which keeps these tests
    // about the attempt question they were written for.
    ruleBodies: new Map<string, string>(),
  };

  it('skips a call with no transcript without spending a model call', async () => {
    const result = await analyzeCall({ ...args, material: material({ transcript: '   ' }) });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no-transcript');
    expect(callChatModelMock).not.toHaveBeenCalled();
  });

  it('returns findings and token counts on success', async () => {
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding()] }),
        model: 'gpt-5-mini',
        tokensIn: 1200,
        tokensOut: 300,
      })
      // The auditor found nothing to drop, so it adds no tokens here.
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdicts: [] }),
        model: 'gpt-5-mini',
        tokensIn: 0,
        tokensOut: 0,
      });
    const result = await analyzeCall({ ...args, material: material() });
    expect(result.findings).toHaveLength(1);
    expect(result.tokensIn).toBe(1200);
    expect(result.tokensOut).toBe(300);
    expect(result.modelUsed).toBe('gpt-5-mini');
    expect(result.error).toBeUndefined();
  });

  it('drops a finding the verification pass shows the rep attempting', async () => {
    // Grading pass first, then the auditor. This is the Citadel case: the
    // customer said "go ahead", the rep offered to take the card on the line,
    // and the grading pass still called it an unclosed buying signal.
    const attempted = material({
      transcript: 'Agent: I can take the card right now.\nCustomer: I want this before Thanksgiving.',
    });
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding()] }),
        model: 'gpt-5',
        tokensIn: 1200,
        tokensOut: 300,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdicts: [{ index: 1, rep_attempted: true, agent_quote: 'I can take the card right now' }],
        }),
        model: 'gpt-5-mini',
        tokensIn: 800,
        tokensOut: 40,
      });

    const result = await analyzeCall({ ...args, material: attempted });
    expect(result.findings).toEqual([]);
    // Both passes' tokens are billed to the call, or the run under-reports cost.
    expect(result.tokensIn).toBe(2000);
    expect(result.tokensOut).toBe(340);
    // The grading model stays the reported one — the auditor is not the grader.
    expect(result.modelUsed).toBe('gpt-5');
  });

  it('keeps a finding the verification pass confirms the rep never attempted', async () => {
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding()] }),
        model: 'gpt-5',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdicts: [{ index: 1, rep_attempted: false, agent_quote: null }] }),
        model: 'gpt-5-mini',
        tokensIn: 10,
        tokensOut: 5,
      });

    expect((await analyzeCall({ ...args, material: material() })).findings).toHaveLength(1);
  });

  it('sends nothing to the auditor when the rule is not an omission rule', async () => {
    // `omissionRuleKeys` comes from the rules table, so a rule an admin marked
    // as content-graded must bypass the pass entirely — one model call, not two.
    callChatModelMock.mockResolvedValueOnce({
      text: JSON.stringify({ findings: [finding()] }),
      model: 'gpt-5',
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await analyzeCall({
      ...args,
      material: material(),
      omissionRuleKeys: new Set<string>(),
    });
    expect(result.findings).toHaveLength(1);
    expect(callChatModelMock).toHaveBeenCalledTimes(1);
  });

  it('keeps every finding when the verification pass itself fails', async () => {
    // Fail open. Silently emptying a day's review because an auxiliary call
    // broke is a worse outcome than the false positives it exists to catch.
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding()] }),
        model: 'gpt-5',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockRejectedValueOnce(new Error('529 overloaded'));

    const result = await analyzeCall({ ...args, material: material() });
    expect(result.findings).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it('does not spend a verification call when the call produced no findings', async () => {
    callChatModelMock.mockResolvedValue({
      text: JSON.stringify({ findings: [] }),
      model: 'gpt-5',
      tokensIn: 100,
      tokensOut: 5,
    });
    await analyzeCall({ ...args, material: material() });
    expect(callChatModelMock).toHaveBeenCalledTimes(1);
  });

  it('reports a provider failure as an error instead of throwing', async () => {
    callChatModelMock.mockRejectedValue(new Error('429 rate limited'));
    const result = await analyzeCall({ ...args, material: material() });
    expect(result.error).toContain('429');
    expect(result.findings).toEqual([]);
    expect(result.skipped).toBe(false);
  });

  it('reports unparseable output as a failed review, not a clean call', async () => {
    // This used to come back indistinguishable from a well-handled call, so a
    // refusal or a truncated JSON body counted toward the clean-call rate the
    // report shows managers. The call was never graded; it must not be
    // presented as one that was.
    callChatModelMock.mockResolvedValue({
      text: 'Sorry, I cannot help with that.',
      model: 'gpt-5-mini',
      tokensIn: 10,
      tokensOut: 5,
    });
    const result = await analyzeCall({ ...args, material: material() });
    expect(result.error).toContain('not parseable');
    expect(result.findings).toEqual([]);
    expect(result.skipped).toBe(false);
    // Still billed: the tokens were spent whether or not we could read them.
    expect(result.tokensIn).toBe(10);
  });

  it('reports a failed transcript retrieval as an error, not a skip', async () => {
    // A phone-DB outage and a call with no recording consent both arrived as an
    // empty transcript. One is a review that could not happen; counting it as a
    // skip left the day looking thin, and counting it as analyzed made it look
    // clean.
    const result = await analyzeCall({
      ...args,
      material: material({ transcript: '', transcriptUnavailable: true }),
    });
    expect(result.error).toContain('transcript retrieval failed');
    expect(result.skipped).toBe(false);
    expect(callChatModelMock).not.toHaveBeenCalled();
  });

  it('drops a finding whose quote appears nowhere in the material', async () => {
    // The contract demands a verbatim span. Nothing checked it, so a finding
    // could read as well-supported while citing words nobody said.
    callChatModelMock.mockResolvedValueOnce({
      text: JSON.stringify({
        findings: [finding({ evidence_quote: 'just put it on the company card, we are ready today' })],
      }),
      model: 'gpt-5',
      tokensIn: 100,
      tokensOut: 50,
    });
    const result = await analyzeCall({ ...args, material: material() });
    expect(result.findings).toEqual([]);
    // No auditor call: there was nothing left to audit.
    expect(callChatModelMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a quote that differs from the transcript only in punctuation and case', async () => {
    // ASR rendering disagrees about case, smart quotes, and line breaks. A
    // literal comparison would reject real evidence.
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding({ evidence_quote: 'I WANT THIS — before Thanksgiving!' })] }),
        model: 'gpt-5',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdicts: [] }), model: 'gpt-5-mini', tokensIn: 1, tokensOut: 1,
      });
    expect((await analyzeCall({ ...args, material: material() })).findings).toHaveLength(1);
  });

  it('resolves a quote against the CRM notes, not only the transcript', async () => {
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [finding({ evidence_quote: 'Sent pricing.' })] }),
        model: 'gpt-5',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdicts: [] }), model: 'gpt-5-mini', tokensIn: 1, tokensOut: 1,
      });
    expect((await analyzeCall({ ...args, material: material() })).findings).toHaveLength(1);
  });

  it('cuts to the report ceiling only after verification has had its say', async () => {
    // The ceiling used to be applied while parsing, so a call whose top
    // findings were contradicted came back empty while its sound ones were
    // never parsed at all. Here the first two are disconfirmed and the report
    // should still receive the remaining three.
    const transcript = [
      'Agent: I can take the card right now.',
      'Agent: and I already booked you for Tuesday.',
      'Customer: I want this before Thanksgiving.',
    ].join('\n');
    const keys = [
      'buying_signal_not_closed', 'no_dated_next_step', 'warranty_not_offered',
      'group_expansion_not_captured', 'audio_opportunity_missed',
    ];
    callChatModelMock
      .mockResolvedValueOnce({
        text: JSON.stringify({
          findings: keys.map((k) => finding({ rule_key: k, evidence_quote: 'I want this before Thanksgiving.' })),
        }),
        model: 'gpt-5',
        tokensIn: 100,
        tokensOut: 50,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdicts: [
            { index: 1, rep_attempted: true, agent_quote: 'I can take the card right now' },
            { index: 2, rep_attempted: true, agent_quote: 'and I already booked you for Tuesday' },
          ],
        }),
        model: 'gpt-5-mini',
        tokensIn: 10,
        tokensOut: 5,
      });

    const result = await analyzeCall({
      ...args,
      material: material({ transcript }),
      validRuleKeys: new Set(keys),
      omissionRuleKeys: new Set(keys),
    });
    expect(result.findings.map((f) => f.ruleKey)).toEqual([
      'warranty_not_offered', 'group_expansion_not_captured', 'audio_opportunity_missed',
    ]);
  });

  it('requests JSON mode so the response is parseable in the first place', async () => {
    callChatModelMock.mockResolvedValue({
      text: JSON.stringify({ findings: [] }), model: 'gpt-5-mini', tokensIn: 1, tokensOut: 1,
    });
    await analyzeCall({ ...args, material: material() });
    expect(callChatModelMock).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ responseFormat: 'json_object', model: 'gpt-5-mini' }),
    );
  });
});
