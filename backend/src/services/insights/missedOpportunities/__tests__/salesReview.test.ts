import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, findUnique, create, executeQuery } = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), executeQuery: vi.fn(),
}));
vi.mock('../../../../config/prisma', () => ({
  default: { ieMissedOpportunityRule: { findMany, findUnique, create } },
}));
vi.mock('../../../../utils/databaseUtils', () => ({ executeQuery }));
vi.mock('../../../../config/logger', () => ({ default: { warn: vi.fn(), info: vi.fn() } }));

import { listActiveRules, listRules, createRule, updateRule } from '../rules.service';
import { buildSystemPrompt, buildUserPrompt } from '../prompt';
import { renderSalesThread } from '../crmThread';
import type { SalesRecord } from '../crmSelect';
import { parseFindings } from '../parse';
import type { CallMaterial } from '../types';

beforeEach(() => { vi.clearAllMocks(); findMany.mockResolvedValue([]); });

const dbRule = {
  rule_id: 90, rule_key: 'sales_qa_v8_discovery', rule_name: 'Approved discovery',
  category: 'Sales QA', severity: 'medium', body_md: 'Ask the approved discovery question when applicable.',
  guidance_md: 'Use dated prior history and provide a practical recovery.', is_omission: true,
  is_active: true, sort_order: 8000, updated_by: 1, updated_at: new Date('2026-09-14T00:00:00Z'),
};

describe('database-owned Sales QA rules', () => {
  it('returns only stored rules with real editable ids, without appending a file reference', async () => {
    expect(await listActiveRules()).toEqual([]);
    findMany.mockResolvedValue([dbRule]);
    const rules = await listActiveRules();
    expect(rules).toHaveLength(1);
    expect((await listRules())[0]).toMatchObject({ rule_id: 90, body_md: dbRule.body_md });
    expect((await listRules())[0]).not.toHaveProperty('reference_only');
  });

  it('uses database edits on the next read and preserves the output/evidence contract', async () => {
    findMany.mockResolvedValue([dbRule]);
    const first = buildSystemPrompt(await listActiveRules(), 'Custom editable persona');
    findMany.mockResolvedValue([{ ...dbRule, body_md: 'Newly approved requirement.' }]);
    const second = buildSystemPrompt(await listActiveRules(), 'Custom editable persona');
    expect(first).toContain(dbRule.body_md);
    expect(second).toContain('Newly approved requirement.');
    expect(second).not.toContain(dbRule.body_md);
    expect(second).toContain('Custom editable persona');
    expect(second).toContain('evidence_quote');
    expect(second).toContain('No company KB content supplied');
  });

  it('allows QA rule keys through the existing database editor and rejects synthetic ids', async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(dbRule);
    await expect(createRule({ rule_key: dbRule.rule_key, rule_name: dbRule.rule_name, body_md: dbRule.body_md }, 1))
      .resolves.toMatchObject({ rule_id: 90 });
    expect(create).toHaveBeenCalledOnce();
    await expect(updateRule(-1, { is_active: false }, 1)).rejects.toThrow('Invalid rule id');
  });

  it.each(['{}', 'null', '42', '{"findings":"none"}'])('does not count malformed output %s as a clean review', (raw) => {
    expect(parseFindings({ raw, validRuleKeys: new Set(), defaultSeverityByRule: new Map() }).parseFailed).toBe(true);
  });
});

describe('CRM history evidence', () => {
  const cutoff = '2026-09-04 23:59:59';
  const callAt = new Date(2026, 8, 4, 14, 30);

  const record = (over: Partial<SalesRecord> = {}): SalesRecord => ({
    taskId: 123,
    taskType: 'Lead Manager',
    role: 'primary_sales',
    customerId: 200,
    customerLeadId: 100,
    accountName: 'Acme',
    open: 'open',
    statusTitle: 'Working',
    ownerName: 'AE',
    dueOn: null,
    lastActionAt: null,
    actionCount: 0,
    matchedBy: ['contact'],
    ...over,
  });

  const actionRow = (over: Record<string, unknown> = {}) => ({
    ActionID: 900,
    TaskID: 123,
    Note: 'Quote sent today.',
    createdOn: '2026-09-04 15:30:00',
    completedOn: '2026-09-04 15:30:00',
    dueOn: null,
    actionResult: 'Quote sent',
    createdByName: 'AE',
    completedByName: 'AE',
    ...over,
  });

  it('marks a failed history read as unavailable, not as empty proof', async () => {
    executeQuery.mockRejectedValue(new Error('offline'));
    const thread = await renderSalesThread({ records: [record()], callAt, notAfter: cutoff });
    expect(thread.coverage.errors).toContain('TASK 123: history read failed');

    const prompt = buildUserPrompt({
      agentName: 'AE',
      startedAt: callAt,
      talkSecs: 180,
      transcript: 'Customer: Send pricing.',
      crm: { notes: thread.notes, refs: thread.refs, scope: 'record', unavailable: true },
      leadsCreated: null,
      attribution: { internalPartyCount: 1, soleInternalParty: true },
    } as CallMaterial);
    expect(prompt).toContain('prior completion are UNKNOWN');
    expect(prompt).toContain('THIS LOOKUP FAILED');
  });

  it('carries the record, action id, author and exact time on every rendered line', async () => {
    executeQuery.mockImplementation(async (sql: string) => (
      /COUNT/.test(String(sql)) ? [{ n: 1 }] : [actionRow()]
    ));
    const thread = await renderSalesThread({ records: [record()], callAt, notAfter: cutoff });
    expect(thread.notes).toContain('TASK 123 · action 900 · 2026-09-04 15:30');
    expect(thread.notes).toContain('by AE');
    expect(thread.notes).toContain('Quote sent today.');
  });

  // "Newest 25" used to be reported as the account's whole history, so a topic
  // decision older than 25 rows — the prior warranty decline an exception turns
  // on — could not be found and its absence was read as proof.
  it('reports rows it did not read rather than presenting a partial history as whole', async () => {
    executeQuery.mockImplementation(async (sql: string) => (
      /COUNT/.test(String(sql)) ? [{ n: 400 }] : [actionRow()]
    ));
    const thread = await renderSalesThread({ records: [record()], callAt, notAfter: cutoff });
    expect(thread.coverage.rowsRetrieved).toBe(400);
    expect(thread.coverage.truncated).toBe(true);
    expect(thread.coverage.rowsOmitted).toBeGreaterThan(0);
  });

  it('reads the account CM alongside the lead without borrowing another lead', async () => {
    executeQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/COUNT/.test(String(sql))) return [{ n: 1 }];
      return [actionRow({ TaskID: params[0], Note: `history for ${params[0]}` })];
    });
    const thread = await renderSalesThread({
      records: [record(), record({ taskId: 880, role: 'account_cm', taskType: 'Contact Manager' })],
      callAt,
      notAfter: cutoff,
    });
    expect(thread.refs).toEqual(['TASK 123', 'TASK 880']);
    expect(thread.notes).toContain('history for 123');
    expect(thread.notes).toContain('history for 880');
  });

  it('bounds every read at the reviewed day cutoff', async () => {
    executeQuery.mockImplementation(async (sql: string) => (
      /COUNT/.test(String(sql)) ? [{ n: 1 }] : [actionRow()]
    ));
    await renderSalesThread({ records: [record()], callAt, notAfter: cutoff });
    for (const call of executeQuery.mock.calls) expect(call[1]).toEqual([123, cutoff]);
  });
});
