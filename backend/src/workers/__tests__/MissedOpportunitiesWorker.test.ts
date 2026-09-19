/**
 * Worker orchestration tests. The model, the phone pool, the CRM, and both DB
 * clients are mocked, so these pin behaviour rather than integration:
 *
 *   - Idempotency by run_date. A re-run must DELETE the day before inserting,
 *     because a rule edit legitimately changes the finding count. This is the
 *     contract the manual re-run endpoint depends on.
 *   - PARTIAL, not FAILED, when one call blows up. Losing every other agent's
 *     findings to one bad transcript is the exact failure this guards.
 *   - The daily USD cap must stop spend mid-run and still persist what it has.
 *   - No provider / no active rules must record a FAILED run row rather than
 *     looking like a quiet day with no misses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  poolQuery, poolExecute, getConnection,
  findingDeleteMany, findingCreateMany, runUpsert, transaction,
  selectCandidateCallsMock, loadCrmActivityByAgentMock, loadCallMaterialMock,
  analyzeCallMock, resolveProviderMock, listActiveRulesMock, getSettingsMock,
  resolveCallCrmRecordMock, getPlaysSettingsMock, renderPlaysMock,
  loadCreatedLeadsByAgentMock,
} = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolExecute: vi.fn(),
  getConnection: vi.fn(),
  findingDeleteMany: vi.fn(),
  findingCreateMany: vi.fn(),
  runUpsert: vi.fn(),
  transaction: vi.fn(),
  selectCandidateCallsMock: vi.fn(),
  loadCrmActivityByAgentMock: vi.fn(),
  loadCallMaterialMock: vi.fn(),
  analyzeCallMock: vi.fn(),
  resolveProviderMock: vi.fn(),
  listActiveRulesMock: vi.fn(),
  getSettingsMock: vi.fn(),
  resolveCallCrmRecordMock: vi.fn(),
  getPlaysSettingsMock: vi.fn(),
  renderPlaysMock: vi.fn(),
  loadCreatedLeadsByAgentMock: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  default: {
    query: (...a: unknown[]) => poolQuery(...a),
    execute: (...a: unknown[]) => poolExecute(...a),
    getConnection: () => getConnection(),
  },
}));

vi.mock('../../config/prisma', () => ({
  default: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => transaction(fn),
    ieMissedOpportunityRun: { upsert: runUpsert },
    ieMissedOpportunityFinding: { deleteMany: findingDeleteMany, createMany: findingCreateMany },
  },
}));

vi.mock('../../services/insights/missedOpportunities/candidates', () => ({
  selectCandidateCalls: (...a: unknown[]) => selectCandidateCallsMock(...a),
  loadCallMaterial: (...a: unknown[]) => loadCallMaterialMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/crmActivity', () => ({
  loadCrmActivityByAgent: (...a: unknown[]) => loadCrmActivityByAgentMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/crmCreated', () => ({
  loadCreatedLeadsByAgent: (...a: unknown[]) => loadCreatedLeadsByAgentMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/crmLink', () => ({
  resolveCallCrmRecord: (...a: unknown[]) => resolveCallCrmRecordMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/analyzer', () => ({
  analyzeCall: (...a: unknown[]) => analyzeCallMock(...a),
  buildSystemPrompt: () => 'system prompt',
  resolveProvider: () => resolveProviderMock(),
  resolveTierModel: () => 'gpt-5-mini',
}));

vi.mock('../../services/insights/missedOpportunities/rules.service', () => ({
  listActiveRules: () => listActiveRulesMock(),
}));

vi.mock('../../services/insights/missedOpportunities/settings', () => ({
  getMissedOpportunitySettings: () => getSettingsMock(),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/settings', () => ({
  getSalesPlaysSettings: () => getPlaysSettingsMock(),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/plays.service', () => ({
  renderPlaysForPrompt: () => renderPlaysMock(),
}));

vi.mock('../../services/notifications/ingestionAlerts', () => ({
  notifyIngestionFailure: vi.fn(async () => {}),
}));

import { MissedOpportunitiesWorker } from '../MissedOpportunitiesWorker';
import type { AnalyzeCallResult, CallCandidate } from '../../services/insights/missedOpportunities/types';

const RUN_DATE = '2026-09-04';

const candidate = (over: Partial<CallCandidate> = {}): CallCandidate => ({
  conversationId: 'conv-1',
  agentName: 'Jane Rep',
  agentEmail: 'jane@example.com',
  phoneUserId: 'pu-1',
  startedAt: new Date('2026-09-04T13:15:00Z'),
  dateKey: 20260904,
  direction: 'outbound',
  talkSecs: 420,
  remoteParty: 'Sappington MO',
  wrapUpCode: 'Quote Sent',
  ...over,
});

const result = (over: Partial<AnalyzeCallResult> = {}): AnalyzeCallResult => ({
  conversationId: 'conv-1',
  findings: [],
  tokensIn: 100,
  tokensOut: 50,
  usdCost: 0.01,
  modelUsed: 'gpt-5-mini',
  skipped: false,
  ...over,
});

const aFinding = () => ({
  ruleKey: 'buying_signal_not_closed',
  severity: 'high' as const,
  title: 'Did not ask for the order',
  whatHappened: 'Owner asked for install before the holidays; rep moved on.',
  evidenceQuote: 'I want this in before Thanksgiving',
  evidenceSpeaker: 'CUSTOMER' as const,
  recommendedApproach: 'Ask for the order and offer Tuesday install.',
  recoveryAction: 'Call Mabels this morning and book Tuesday install.',
  estValueNote: '~$2,400 ARR',
  customerName: 'Mabels Diner',
  crmRefKind: 'TASK' as const,
  crmRefId: 12345,
});

/** The run row as it was last written — what the report and the banner read. */
const lastRunRow = () => runUpsert.mock.calls.at(-1)?.[0].update as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();

  // BaseInsightsWorker lock + ingestion log.
  getConnection.mockResolvedValue({
    execute: vi.fn(async () => [[]]),
    release: vi.fn(),
  });
  poolExecute.mockResolvedValue([{ insertId: 1 }]);
  // resolveEmployeeKeys + resolvePriorBusinessDay both go through pool.query.
  poolQuery.mockResolvedValue([[]]);

  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      ieMissedOpportunityFinding: {
        deleteMany: findingDeleteMany,
        createMany: findingCreateMany,
      },
    }));

  resolveProviderMock.mockReturnValue('openai');
  listActiveRulesMock.mockResolvedValue([{
    rule_key: 'buying_signal_not_closed',
    rule_name: 'Buying signal not closed',
    category: 'Closing',
    severity: 'high',
    body_md: 'body',
    guidance_md: null,
    is_omission: true,
  }]);
  getSettingsMock.mockResolvedValue({
    minTalkSecs: 100,
    excludedAgents: [],
    dailyUsdCap: 25,
    modelTier: 'cheap',
    maxCallsPerRun: 400,
    systemPersona: 'persona',
    kbAnchorUrls: [],
  });
  // Phase 2 learning loop off by default, so the review runs on KB-only grounding
  // exactly as before and these tests stay focused on the nightly review.
  getPlaysSettingsMock.mockResolvedValue({
    enabled: false, roster: [], lastMined: null, seedDays: 90, monthlyUsdCap: 25,
  });
  renderPlaysMock.mockResolvedValue('');
  loadCrmActivityByAgentMock.mockResolvedValue(
    new Map([['Jane Rep', { notes: 'notes', refs: ['TASK 12345'], scope: 'day' }]]),
  );
  loadCreatedLeadsByAgentMock.mockResolvedValue(
    new Map([['Jane Rep', '[LEAD 4455 · TASK 999] Second Location']]),
  );
  loadCallMaterialMock.mockImplementation(
    async (c: CallCandidate, crm: unknown, leadsCreated: unknown, attribution: unknown) =>
      ({ ...c, transcript: 'Agent: hello', crm, leadsCreated, attribution }),
  );
  // Default: the resolver itself threw, so the worker falls back to day-wide
  // notes and the model's own citation (matches the assertions below).
  resolveCallCrmRecordMock.mockResolvedValue(null);
});

/** A resolver answer, in the shape crmLink now returns. */
const resolved = (over: Record<string, unknown> = {}) => ({
  kind: 'TICKET',
  id: 987,
  outcome: 'verified',
  attribution: { internalPartyCount: 1, soleInternalParty: true },
  crm: {
    notes: 'prior thread',
    refs: ['TICKET 987'],
    scope: 'record',
    recordLabel: 'TICKET 987 — Acme',
    resolution: {
      outcome: 'verified',
      reason: 'one open lead on the verified account',
      primaryRef: 'TICKET 987',
      salesRefs: ['TICKET 987'],
      ticketRefs: [],
      duplicatePath: [],
      rejected: [],
      numbers: [],
      crossAccount: false,
    },
  },
  ...over,
});

describe('MissedOpportunitiesWorker — idempotency', () => {
  it('deletes the run date before inserting, so a re-run replaces the day', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({ findings: [aFinding()] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(findingDeleteMany).toHaveBeenCalledWith({ where: { run_date: new Date(RUN_DATE) } });
    expect(findingCreateMany).toHaveBeenCalledTimes(1);
    // Delete and insert share one transaction — a crash between them must not
    // leave the day empty.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('still clears the day when a re-run produces zero findings', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result());

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(findingDeleteMany).toHaveBeenCalledWith({ where: { run_date: new Date(RUN_DATE) } });
    expect(findingCreateMany).not.toHaveBeenCalled();
  });

  it('upserts one run row per date rather than appending run history', async () => {
    selectCandidateCallsMock.mockResolvedValue([]);
    await new MissedOpportunitiesWorker(RUN_DATE).run();
    for (const [arg] of runUpsert.mock.calls) {
      expect(arg.where).toEqual({ run_date: new Date(RUN_DATE) });
    }
  });

  it('persists the finding with the call context the report renders', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({ findings: [aFinding()] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const [row] = findingCreateMany.mock.calls[0][0].data;
    expect(row).toMatchObject({
      date_key: 20260904,
      agent_name: 'Jane Rep',
      conversation_id: 'conv-1',
      talk_secs: 420,
      customer_name: 'Mabels Diner',
      rule_key: 'buying_signal_not_closed',
      severity: 'high',
      recommended_approach: 'Ask for the order and offer Tuesday install.',
      recovery_action: 'Call Mabels this morning and book Tuesday install.',
      crm_task_kind: 'TASK',
      crm_task_id: 12345,
    });
  });

  it('stores a null CRM citation rather than dropping the finding', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({
      findings: [{ ...aFinding(), crmRefKind: null, crmRefId: null }],
    }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const [row] = findingCreateMany.mock.calls[0][0].data;
    expect(row.crm_task_kind).toBeNull();
    expect(row.crm_task_id).toBeNull();
    expect(row.title).toBe('Did not ask for the order');
  });

  it('stores a null recovery_action when the miss is coaching-only', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({
      findings: [{ ...aFinding(), recoveryAction: null }],
    }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const [row] = findingCreateMany.mock.calls[0][0].data;
    expect(row.recovery_action).toBeNull();
    expect(row.recommended_approach).toBe('Ask for the order and offer Tuesday install.');
  });

  it('links the phone-resolved record and feeds the model that record history', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    // The call resolved to a specific ticket whose thread differs from the
    // agent's day-wide notes and from the model's own guess (TASK 12345).
    resolveCallCrmRecordMock.mockResolvedValue(resolved());
    analyzeCallMock.mockResolvedValue(result({ findings: [aFinding()] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    // A verified record wins over the model's citation for the deep link.
    const [row] = findingCreateMany.mock.calls[0][0].data;
    expect(row.crm_task_kind).toBe('TICKET');
    expect(row.crm_task_id).toBe(987);
    // And the record's own thread was the material handed to the analyzer.
    const crmArg = loadCallMaterialMock.mock.calls[0][1] as { scope?: string; notes?: string };
    expect(crmArg.scope).toBe('record');
    expect(crmArg.notes).toBe('prior thread');
  });

  // Overriding on anything short of `verified` is what deep-linked Lakeland and
  // Keys into an unrelated La Mesa account: one candidate came back on a shared
  // number and the worker stored it over a citation the analyzer had already
  // checked against the refs the model was actually shown. Candidate count is
  // not identity, so only `verified` may overwrite.
  it.each(['provisional', 'ambiguous', 'unmatched', 'unavailable'])(
    'keeps the model\'s validated citation when the resolution is only %s', async (outcome) => {
      selectCandidateCallsMock.mockResolvedValue([candidate()]);
      resolveCallCrmRecordMock.mockResolvedValue(resolved({ outcome }));
      analyzeCallMock.mockResolvedValue(result({ findings: [aFinding()] }));

      await new MissedOpportunitiesWorker(RUN_DATE).run();

      const [row] = findingCreateMany.mock.calls[0][0].data;
      expect(row.crm_task_kind).toBe('TASK');
      expect(row.crm_task_id).toBe(12345);
    },
  );

  it('still feeds an unverified match\'s record history to the model', async () => {
    // The link is untrusted for the stored citation, not for the context: that
    // thread is still the best-supported account, the prompt labels how well it
    // is established, and the model cites only what it was shown.
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(resolved({ outcome: 'provisional' }));
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const crmArg = loadCallMaterialMock.mock.calls[0][1] as { notes?: string };
    expect(crmArg.notes).toBe('prior thread');
  });

  // A CRM outage must not promote another customer's day-wide notes into the
  // packet as though they were this account's history.
  it('does not substitute day-wide agent notes when the account is unmatched', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(resolved({
      kind: null,
      id: null,
      outcome: 'unmatched',
      crm: { notes: '', refs: [], scope: 'record' },
    }));
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const crmArg = loadCallMaterialMock.mock.calls[0][1] as { notes?: string; scope?: string };
    expect(crmArg.scope).toBe('record');
    expect(crmArg.notes).toBe('');
  });

  it('falls back to day-wide notes only when the resolver returned nothing at all', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(null);
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const crmArg = loadCallMaterialMock.mock.calls[0][1] as { scope?: string };
    expect(crmArg.scope).toBe('day');
  });

  // Whether the reviewed salesperson was the only employee on the line decides
  // whether an "Agent:" turn can be credited to them at all, so it has to reach
  // the analyzer with the material rather than being inferred downstream.
  it('hands the analyzer the call\'s attribution alongside the material', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(resolved({
      attribution: { internalPartyCount: 2, soleInternalParty: false },
    }));
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(loadCallMaterialMock.mock.calls[0][3]).toEqual({
      internalPartyCount: 2, soleInternalParty: false,
    });
  });

  it('leaves the citation null when an unverified match is all the model had', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(resolved({ outcome: 'provisional' }));
    analyzeCallMock.mockResolvedValue(result({
      findings: [{ ...aFinding(), crmRefKind: null, crmRefId: null }],
    }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const [row] = findingCreateMany.mock.calls[0][0].data;
    expect(row.crm_task_kind).toBeNull();
    expect(row.crm_task_id).toBeNull();
  });

  it('adds the leads the rep created, which the record thread cannot show', async () => {
    // Record scope narrows the CRM to ONE task/ticket thread, so a lead the rep
    // opened for a sibling location is invisible there. It has to ride alongside
    // the notes or the expansion rule has nothing to check its claim against.
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    resolveCallCrmRecordMock.mockResolvedValue(resolved({ kind: 'TASK', id: 500 }));
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(loadCreatedLeadsByAgentMock).toHaveBeenCalledWith([candidate()], RUN_DATE);
    expect(loadCallMaterialMock.mock.calls[0][2]).toBe('[LEAD 4455 · TASK 999] Second Location');
  });

  it('passes an empty created-leads block for an agent with no leads that day', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    loadCreatedLeadsByAgentMock.mockResolvedValue(new Map([[candidate().agentName, '']]));
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(loadCallMaterialMock.mock.calls[0][2]).toBe('');
  });

  it.each([new Map(), new Map([[candidate().agentName, null]])])(
    'preserves an unknown created-leads lookup instead of asserting none were created', async (lookup) => {
      selectCandidateCallsMock.mockResolvedValue([candidate()]);
      loadCreatedLeadsByAgentMock.mockResolvedValue(lookup);
      analyzeCallMock.mockResolvedValue(result({ findings: [] }));
      await new MissedOpportunitiesWorker(RUN_DATE).run();
      expect(loadCallMaterialMock.mock.calls[0][2]).toBeNull();
    },
  );

  it('gives the analyzer only the rules whose miss is a skipped step', async () => {
    // The verification pass may audit an omission rule and must leave a
    // content-graded one alone. The split is `is_omission` on the rule row, so
    // an admin can flip it from the Settings tab with no deploy.
    listActiveRulesMock.mockResolvedValue([
      { rule_key: 'buying_signal_not_closed', rule_name: 'A', category: 'Closing',
        severity: 'high', body_md: 'body', guidance_md: null, is_omission: true },
      { rule_key: 'professionalism_or_compliance', rule_name: 'B', category: 'Conduct',
        severity: 'high', body_md: 'body', guidance_md: null, is_omission: false },
    ]);
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({ findings: [] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const { omissionRuleKeys, validRuleKeys } = analyzeCallMock.mock.calls[0][0];
    expect([...omissionRuleKeys]).toEqual(['buying_signal_not_closed']);
    // Both rules still grade the call — only the audit is narrowed.
    expect([...validRuleKeys]).toHaveLength(2);
  });

  it('falls back to the phone label when the model could not name the customer', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({
      findings: [{ ...aFinding(), customerName: null }],
    }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(findingCreateMany.mock.calls[0][0].data[0].customer_name).toBe('Sappington MO');
  });
});

describe('MissedOpportunitiesWorker — resilience', () => {
  it('marks PARTIAL and keeps the other agents findings when one call fails', async () => {
    selectCandidateCallsMock.mockResolvedValue([
      candidate({ conversationId: 'bad' }),
      candidate({ conversationId: 'good', agentName: 'Jane Rep' }),
    ]);
    analyzeCallMock.mockImplementation(async ({ material }: { material: CallCandidate }) =>
      material.conversationId === 'bad'
        ? result({ error: 'provider 500' })
        : result({ findings: [aFinding()] }));

    const out = await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(lastRunRow()).toMatchObject({ status: 'PARTIAL', calls_failed: 1, calls_analyzed: 1 });
    expect(out?.rowsLoaded).toBe(1);
    expect(out?.rowsErrored).toBe(1);
  });

  it('counts a no-transcript call as skipped, not failed — SUCCESS is still correct', async () => {
    selectCandidateCallsMock.mockResolvedValue([candidate()]);
    analyzeCallMock.mockResolvedValue(result({ skipped: true, skipReason: 'no-transcript' }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(lastRunRow()).toMatchObject({ status: 'SUCCESS', calls_skipped: 1, calls_failed: 0 });
  });

  it('stops at the daily USD cap, reports PARTIAL, and keeps what it produced', async () => {
    selectCandidateCallsMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => candidate({ conversationId: `conv-${i}` })),
    );
    getSettingsMock.mockResolvedValue({
      minTalkSecs: 100, excludedAgents: [], dailyUsdCap: 1,
      modelTier: 'cheap', maxCallsPerRun: 400, systemPersona: 'persona', kbAnchorUrls: [],
    });
    // $0.40 a call trips a $1 cap after a handful, well before all 20.
    analyzeCallMock.mockResolvedValue(result({ usdCost: 0.4, findings: [aFinding()] }));

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    const row = lastRunRow();
    expect(row.status).toBe('PARTIAL');
    expect(String(row.error_text)).toContain('cost cap');
    expect(analyzeCallMock.mock.calls.length).toBeLessThan(20);
    expect(findingCreateMany).toHaveBeenCalledTimes(1);
  });

  it('records a FAILED run when no AI provider is configured', async () => {
    resolveProviderMock.mockReturnValue(null);

    const out = await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(lastRunRow()).toMatchObject({ status: 'FAILED' });
    expect(String(lastRunRow().error_text)).toContain('No AI provider');
    expect(selectCandidateCallsMock).not.toHaveBeenCalled();
    expect(out?.rowsLoaded).toBe(0);
  });

  it('records a FAILED run when every rule is switched off', async () => {
    listActiveRulesMock.mockResolvedValue([]);

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(String(lastRunRow().error_text)).toContain('No active rules');
    expect(analyzeCallMock).not.toHaveBeenCalled();
  });

  it('reports SUCCESS on a day with no candidate calls', async () => {
    selectCandidateCallsMock.mockResolvedValue([]);

    const out = await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(lastRunRow()).toMatchObject({ status: 'SUCCESS', calls_considered: 0 });
    expect(out?.rowsExtracted).toBe(0);
  });

  it('passes the configured floor, exclusions, and cap through to selection', async () => {
    getSettingsMock.mockResolvedValue({
      minTalkSecs: 240, excludedAgents: ['Drew Feely'], dailyUsdCap: 25,
      modelTier: 'cheap', maxCallsPerRun: 50, systemPersona: 'persona', kbAnchorUrls: [],
    });
    selectCandidateCallsMock.mockResolvedValue([]);

    await new MissedOpportunitiesWorker(RUN_DATE).run();

    expect(selectCandidateCallsMock).toHaveBeenCalledWith({
      runDate: RUN_DATE,
      minTalkSecs: 240,
      excludedAgents: ['Drew Feely'],
      maxCalls: 50,
    });
  });
});
