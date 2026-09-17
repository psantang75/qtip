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
import { loadThread, loadSalesThreads } from '../crmLinkThread';
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
  it('marks a failed thread read as unavailable, not empty proof', async () => {
    executeQuery.mockRejectedValue(new Error('offline'));
    const crm = await loadThread('TASK', 123, 'Lead', cutoff);
    expect(crm.unavailable).toBe(true);
    const prompt = buildUserPrompt({
      agentName: 'AE', startedAt: new Date(2026, 8, 4, 10), talkSecs: 180,
      transcript: 'Customer: Send pricing.', crm, leadsCreated: null,
    } as CallMaterial);
    expect(prompt).toContain('prior completion are UNKNOWN');
    expect(prompt).not.toContain('(no prior notes');
    expect(prompt).toContain('THIS LOOKUP FAILED');
  });

  it('keeps the newest follow-through, labels omitted history, and includes exact task/date/time', async () => {
    executeQuery.mockResolvedValue([
      { Note: 'Quote sent today.', at: new Date(2026, 8, 4, 15, 30), meta: 'Quote sent' },
      { Note: 'older research '.repeat(600), at: new Date(2026, 8, 3, 10), meta: 'Research' },
    ]);
    const crm = await loadThread('TASK', 123, 'Lead', cutoff);
    expect(crm.notes).toContain('Quote sent today.');
    expect(crm.notes).toContain('TASK 123 · 2026-09-04 15:30');
    expect(crm.truncated).toBe(true);
    expect(crm.notes.length).toBeLessThanOrEqual(6000);
    expect(executeQuery.mock.calls[0][1]).toEqual([123, cutoff]);
  });

  it('marks row-limit truncation even when the remaining notes are short', async () => {
    executeQuery.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({
      Note: `note ${i}`, at: new Date(2026, 8, 4, 15), meta: null,
    })));
    expect((await loadThread('TASK', 1, 'Lead', cutoff)).truncated).toBe(true);
  });

  it('combines same-lead task evidence and propagates partial availability without borrowing another lead', async () => {
    const lead = { TaskID: 1, CustomerLeadID: 10, CompletedOn: null, taskType: 'Lead Manager', accountName: 'Acme', lastActionOn: null };
    const contact = { ...lead, TaskID: 2, taskType: 'Contact Manager' };
    const other = { ...lead, TaskID: 3, CustomerLeadID: 20 };
    executeQuery.mockImplementation(async (_sql, [id]) => {
      if (id === 2) throw new Error('offline');
      return [{ Note: 'Acme prior research.', at: new Date(2026, 8, 1), meta: null }];
    });
    const { crm } = await loadSalesThreads(lead, [lead, contact, other], cutoff);
    expect(crm.notes).toContain('Acme prior research.');
    expect(crm.unavailable).toBe(true);
    expect(executeQuery.mock.calls.map((c) => c[1][0])).toEqual([1, 2]);
  });
});
