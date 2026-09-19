/**
 * Calibration cases from the September 17 production review.
 *
 * The unit tests beside this file pin each mechanism — quote resolution, author
 * extraction, the verification pass's removal gate. This file pins the OUTCOMES
 * the owner adjudicated, because every one of these was a real published finding
 * that the pipeline got wrong in a way no single unit assertion catches: the
 * mechanisms were individually defensible and the answer was still that one
 * person got credit for another person's work.
 *
 * The governing rule, from the owner's clarification: unless the topic is
 * documented sufficiently in the SALESPERSON'S OWN lead or CM task, the
 * salesperson still has to address it on the call. Customer Service explaining a
 * product, a support ticket recording the same subject, and a colleague's note
 * on the account are all context. None of them is this salesperson's attempt.
 *
 * Fixtures are sanitized and frozen at the audit date. The IDs identify the
 * audited examples; they are not runtime allowlists, and live CRM state has
 * moved on since.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callChatModelMock } = vi.hoisted(() => ({ callChatModelMock: vi.fn() }));

vi.mock('../../../ai/ChatModelClient', () => ({
  callChatModel: (...a: unknown[]) => callChatModelMock(...a),
  resolveCheapModelName: () => 'claude-sonnet-4-6',
}));
vi.mock('../../../aiCallLogger', () => ({
  withCallLog: async (_m: unknown, _p: unknown, fn: () => Promise<{ result: unknown }>) =>
    (await fn()).result,
}));
vi.mock('../../../../config/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { parseFindings, type EvidenceMaterial } from '../parse';
import { verifyFindings } from '../verify';
import type { AnalyzedFinding } from '../types';

const WARRANTY_RULE = 'warranty_not_offered';
const OMISSION_KEYS = new Set([WARRANTY_RULE, 'buying_signal_not_closed', 'no_dated_next_step']);
const RULE_KEYS = new Set([...OMISSION_KEYS, 'professionalism_or_compliance']);
const SEVERITIES = new Map([[WARRANTY_RULE, 'high']]);

/**
 * Patrick's, September 17. Two segments of one conversation: Customer Service
 * first, then Jason. The label is "Agent" on both, which is the whole problem —
 * the transcript cannot tell the auditor which employee spoke.
 */
const PATRICKS_TRANSCRIPT = [
  '[00:00:12 — CUSTOMER] The player we bought is dead, does it come with a warranty?',
  '[00:00:20 — AGENT] It carries the standard one year, and there is a five year option available.',
  '[00:04:05 — AGENT] I have you down for the replacement player, going out on the usual ground service.',
  '[00:04:40 — CUSTOMER] That works, thanks.',
].join('\n');

/** Lead 1120497 and CM 135455 as retrieved: workflow stamps, no warranty decision. */
const PATRICKS_SALES_NOTES = [
  '--- BEFORE THIS CALL (what the salesperson already had — a prior-completion exception must cite one of these) ---',
  '[TASK 1120497 · action 8561902 · 2026-09-16 09:14 · by Jason Spangler · Sales Lead] (auto-status only: Task Status Changed from Open to Working)',
  '[TASK 135455 · action 8560011 · 2026-08-02 11:00 · by Dana Liu · Contact Manager] Courtesy check in, nothing open at the moment.',
].join('\n');

/** Ticket 289807 — where the warranty subject actually appears in writing. */
const PATRICKS_TICKET_NOTES = [
  '[TICKET 289807 · note 7710455 · 2026-09-17 08:31 · by Support Team · return] Advised the customer the unit carries one year and that a five year extended option exists.',
].join('\n');

const evidence = (over: Partial<EvidenceMaterial> = {}): EvidenceMaterial => ({
  transcript: PATRICKS_TRANSCRIPT,
  salesNotes: PATRICKS_SALES_NOTES,
  ticketNotes: PATRICKS_TICKET_NOTES,
  leadsCreated: '',
  salespersonName: 'Jason Spangler',
  // Customer Service was transferred in, so an AGENT turn is not provably Jason's.
  soleInternalParty: false,
  ...over,
});

/** Run one model payload through the parser with the case's evidence. */
const parse = (findings: unknown[], ev: EvidenceMaterial) => parseFindings({
  raw: JSON.stringify({ findings }),
  validRuleKeys: RULE_KEYS,
  defaultSeverityByRule: SEVERITIES,
  validCrmRefs: new Set(['TASK 1120497', 'TASK 135455', 'TICKET 289807']),
  evidence: ev,
});

const warrantyFinding = (over: Record<string, unknown> = {}) => ({
  rule_key: WARRANTY_RULE,
  severity: 'high',
  title: 'Extended warranty not offered on the replacement order',
  what_happened: 'Jason took the replacement player order without offering the five year coverage.',
  recommended_approach: 'Offer the five year extended warranty and ask which term they want.',
  recovery_action: 'Call Patrick\'s back today and offer the extended term on this order.',
  customer_name: "Patrick's",
  crm_ref: 'TASK 1120497',
  ...over,
});

const finding = (over: Partial<AnalyzedFinding> = {}): AnalyzedFinding => ({
  ruleKey: WARRANTY_RULE,
  severity: 'high',
  title: 'Extended warranty not offered on the replacement order',
  whatHappened: 'Jason took the replacement order without offering the five year coverage.',
  evidenceQuote: 'I have you down for the replacement player',
  evidenceSpeaker: null,
  recommendedApproach: 'Offer the five year extended warranty.',
  recoveryAction: 'Call back today.',
  estValueNote: null,
  customerName: "Patrick's",
  crmRefKind: 'TASK',
  crmRefId: 1120497,
  ...over,
});

const verify = (over: Record<string, unknown> = {}) => verifyFindings({
  findings: [finding()],
  transcript: PATRICKS_TRANSCRIPT,
  provider: 'anthropic' as const,
  conversationId: '24a2a340-c796-492a-9e59-204a164870b3',
  omissionRuleKeys: OMISSION_KEYS,
  salespersonName: 'Jason Spangler',
  salesNotes: '',
  attribution: { internalPartyCount: 2, soleInternalParty: false },
  ...over,
});

const reply = (text: string) => ({ text, model: 'claude-sonnet-4-6', tokensIn: 800, tokensOut: 30 });

beforeEach(() => vi.clearAllMocks());

describe("Patrick's / Jason #112 — CS explaining warranty is not Jason's sales attempt", () => {
  // The published failure: the auditor quoted the Customer Service line, called
  // the warranty offered, and deleted a valid salesperson omission.
  it('keeps the omission when the auditor cites the transferred segment', async () => {
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{
        index: 1,
        rep_attempted: true,
        agent_quote: 'It carries the standard one year, and there is a five year option available',
      }],
    })));

    const res = await verify();

    expect(res.findings).toHaveLength(1);
    expect(res.dropped).toBe(0);
  });

  it('does not pay for a verdict it could not act on', async () => {
    await verify();
    expect(callChatModelMock).not.toHaveBeenCalled();
  });

  it('withdraws AGENT from the warranty line without discarding the finding', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'there is a five year option available',
      evidence_speaker: 'AGENT',
    })], evidence());

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].evidenceSpeaker).toBeNull();
    expect(res.unattributedSpeakers).toBe(1);
  });

  // The subject IS in writing — on the support ticket. Reading that as the
  // salesperson's documented exception is what the separate blocks prevent.
  it('withdraws AGENT from the support ticket note that records the same subject', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'a five year extended option exists',
      evidence_speaker: 'AGENT',
    })], evidence());

    expect(res.findings[0].evidenceSpeaker).toBeNull();
    expect(res.findings[0].crmRefId).toBe(1120497);
  });

  it('does not credit Jason with a colleague\'s note on the account CM', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'Courtesy check in, nothing open at the moment',
      evidence_speaker: 'AGENT',
    })], evidence());

    expect(res.findings[0].evidenceSpeaker).toBeNull();
    expect(res.unattributedSpeakers).toBe(1);
  });

  it('leaves the customer\'s own warranty question attributed to the customer', () => {
    // The question belongs to the earlier support conversation; labelling it
    // AGENT would read as Jason raising warranty himself.
    const res = parse([warrantyFinding({
      evidence_quote: 'does it come with a warranty',
      evidence_speaker: 'CUSTOMER',
    })], evidence());

    expect(res.findings[0].evidenceSpeaker).toBe('CUSTOMER');
    expect(res.unattributedSpeakers).toBe(0);
  });
});

describe('The paired case — a lead that really does document the exception', () => {
  /** Same account, but Jason logged the offer and the decline on his own lead. */
  const documented = evidence({
    salesNotes: [
      '--- BEFORE THIS CALL (what the salesperson already had — a prior-completion exception must cite one of these) ---',
      '[TASK 1120497 · action 8561902 · 2026-09-16 09:14 · by Jason Spangler · Sales Lead] Offered the five year extended warranty on this replacement order; owner declined, wants to stay on the standard year.',
    ].join('\n'),
  });

  it('credits the salesperson with the note they authored on their own lead', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'Offered the five year extended warranty on this replacement order; owner declined',
      evidence_speaker: 'AGENT',
    })], documented);

    expect(res.findings[0].evidenceSpeaker).toBe('AGENT');
    expect(res.unattributedSpeakers).toBe(0);
  });

  it('still refuses the same sentence when a colleague wrote it', () => {
    const colleague = evidence({
      salesNotes: documented.salesNotes.replace('by Jason Spangler', 'by Adrian Cole'),
    });
    const res = parse([warrantyFinding({
      evidence_quote: 'Offered the five year extended warranty on this replacement order; owner declined',
      evidence_speaker: 'AGENT',
    })], colleague);

    expect(res.findings[0].evidenceSpeaker).toBeNull();
  });

  it('lets the auditor remove the finding once Jason was the only employee on the call', async () => {
    // Solo call, and the quoted line is an internal turn: this is the shape in
    // which a removal really is a statement about the reviewed person.
    callChatModelMock.mockResolvedValue(reply(JSON.stringify({
      verdicts: [{
        index: 1,
        rep_attempted: true,
        agent_quote: 'there is a five year option available',
      }],
    })));

    const res = await verify({ attribution: { internalPartyCount: 1, soleInternalParty: true } });

    expect(res.findings).toEqual([]);
    expect(res.dropped).toBe(1);
  });
});

describe('Franklin #110-111 and Citizens #118-119 — another team\'s work on a ticket', () => {
  const franklin = evidence({
    salespersonName: 'Jamie Ortiz',
    transcript: [
      '[00:01:02 — AGENT] I will follow up with you Monday once I have the quote together.',
      '[00:01:20 — CUSTOMER] Monday works.',
    ].join('\n'),
    salesNotes: '[TASK 1120533 · action 8562229 · 2026-09-17 16:40 · by Jamie Ortiz · Sales Lead] Follow up Monday with the quote.',
    ticketNotes: '[TICKET 289875 · note 7710988 · 2026-09-17 15:02 · by Network Support · install] Coordinated the Comcast circuit order and scheduled the technician.',
    soleInternalParty: true,
  });

  it('does not turn a support engineer\'s ticket note into the salesperson\'s next step', () => {
    const res = parse([warrantyFinding({
      rule_key: 'no_dated_next_step',
      evidence_quote: 'Coordinated the Comcast circuit order and scheduled the technician',
      evidence_speaker: 'AGENT',
      crm_ref: 'TICKET 289807',
    })], franklin);

    expect(res.findings[0].evidenceSpeaker).toBeNull();
    expect(res.unattributedSpeakers).toBe(1);
  });

  it('keeps the salesperson\'s own dated commitment attributed to them', () => {
    const res = parse([warrantyFinding({
      rule_key: 'no_dated_next_step',
      evidence_quote: 'Follow up Monday with the quote',
      evidence_speaker: 'AGENT',
    })], franklin);

    expect(res.findings[0].evidenceSpeaker).toBe('AGENT');
  });
});

describe('Evergreen #129, #137 — a second rep on the account', () => {
  // Two reps worked this account the same day. Another rep's replacement sale is
  // not the reviewed person's offer, and the transcript label cannot separate
  // them, so the attribution gate has to.
  it('refuses an internal turn when a second employee was on the conversation', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'I have you down for the replacement player',
      evidence_speaker: 'AGENT',
    })], evidence({ salespersonName: 'Vince Marek' }));

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].evidenceSpeaker).toBeNull();
  });

  it('accepts the same turn once the reviewed person was alone on the line', () => {
    const res = parse([warrantyFinding({
      evidence_quote: 'I have you down for the replacement player',
      evidence_speaker: 'AGENT',
    })], evidence({ soleInternalParty: true }));

    expect(res.findings[0].evidenceSpeaker).toBe('AGENT');
  });
});
