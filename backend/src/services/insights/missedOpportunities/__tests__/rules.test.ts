/**
 * Rule-set contract tests.
 *
 * Two things matter here and nothing else does:
 *   1. `renderRulesForPrompt` must emit the exact `rule_key` for every rule, and
 *      only active rules must reach it. The finding row stores that key and the
 *      report groups by it, so a key that never appears in the prompt produces
 *      a category the model can't attribute to.
 *   2. `rule_key` is immutable and validated on create — stored findings
 *      reference it, so a bad or renamed key orphans history.
 *
 * Prisma is mocked; the rendering half is pure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ruleFindMany, ruleFindUnique, ruleCreate, ruleUpdate } = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  ruleFindUnique: vi.fn(),
  ruleCreate: vi.fn(),
  ruleUpdate: vi.fn(),
}));

vi.mock('../../../../config/prisma', () => ({
  default: {
    ieMissedOpportunityRule: {
      findMany: ruleFindMany,
      findUnique: ruleFindUnique,
      create: ruleCreate,
      update: ruleUpdate,
    },
  },
}));

import {
  createRule,
  listActiveRules,
  renderRulesForPrompt,
  updateRule,
} from '../rules.service';
import type { MissedOpportunityRule } from '../types';

const rule = (over: Partial<MissedOpportunityRule> = {}): MissedOpportunityRule => ({
  rule_key: 'buying_signal_not_closed',
  rule_name: 'Buying signal not closed',
  category: 'Closing',
  severity: 'high',
  body_md: 'Customer states intent to buy and the rep does not ask for the order.',
  guidance_md: null,
  is_omission: true,
  ...over,
});

/** Shape prisma returns; `toRow` needs updated_at to be a Date. */
const dbRow = (over: Record<string, unknown> = {}) => ({
  rule_id: 1,
  rule_key: 'buying_signal_not_closed',
  rule_name: 'Buying signal not closed',
  category: 'Closing',
  severity: 'high',
  body_md: 'body',
  guidance_md: null,
  is_active: true,
  is_omission: true,
  sort_order: 10,
  updated_by: null,
  updated_at: new Date('2026-09-08T00:00:00Z'),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('renderRulesForPrompt', () => {
  it('emits the exact rule_key for every rule so findings can be attributed', () => {
    const out = renderRulesForPrompt([
      rule(),
      rule({ rule_key: 'no_dated_next_step', rule_name: 'No dated next step' }),
    ]);
    expect(out).toContain('RULE buying_signal_not_closed —');
    expect(out).toContain('RULE no_dated_next_step —');
  });

  it('carries category and default severity so the model can seed severity', () => {
    const out = renderRulesForPrompt([rule({ category: 'Closing', severity: 'high' })]);
    expect(out).toContain('category: Closing');
    expect(out).toContain('default severity: high');
  });

  it('includes coaching guidance only when the rule has some', () => {
    expect(renderRulesForPrompt([rule()])).not.toContain('HOW TO COACH THE FIX');
    const withGuidance = renderRulesForPrompt([rule({ guidance_md: 'Name the product and ask.' })]);
    expect(withGuidance).toContain('HOW TO COACH THE FIX: Name the product and ask.');
  });

  it('returns empty string for no rules, so the caller can omit the RULES block', () => {
    expect(renderRulesForPrompt([])).toBe('');
  });

  it('separates rules with a blank line so one body cannot bleed into the next', () => {
    const out = renderRulesForPrompt([rule(), rule({ rule_key: 'warranty_not_offered' })]);
    expect(out).toContain('\n\nRULE warranty_not_offered');
  });
});

describe('listActiveRules', () => {
  it('asks only for active rules, ordered by sort_order', async () => {
    ruleFindMany.mockResolvedValue([dbRow()]);
    await listActiveRules();
    expect(ruleFindMany).toHaveBeenCalledWith({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { rule_id: 'asc' }],
    });
  });

  it('falls back to medium when a hand-edited row has an unknown severity', async () => {
    ruleFindMany.mockResolvedValue([dbRow({ severity: 'catastrophic' })]);
    const [only] = await listActiveRules();
    expect(only.severity).toBe('medium');
  });
});

describe('createRule', () => {
  it('rejects a rule_key that is not lowercase snake_case', async () => {
    await expect(createRule({ rule_key: 'Bad Key!', rule_name: 'x', body_md: 'y' }, 1))
      .rejects.toThrow(/Rule key must be/);
    expect(ruleCreate).not.toHaveBeenCalled();
  });

  it('rejects an empty body — the body IS what the model looks for', async () => {
    await expect(createRule({ rule_key: 'good_key', rule_name: 'x', body_md: '   ' }, 1))
      .rejects.toThrow(/body is required/);
  });

  it('rejects a duplicate key rather than shadowing existing findings', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    await expect(createRule({ rule_key: 'buying_signal_not_closed', rule_name: 'x', body_md: 'y' }, 1))
      .rejects.toThrow(/already exists/);
    expect(ruleCreate).not.toHaveBeenCalled();
  });

  it('creates an active rule and stamps the author', async () => {
    ruleFindUnique.mockResolvedValue(null);
    ruleCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      dbRow({ ...data, updated_at: new Date('2026-09-08T00:00:00Z') }));

    const created = await createRule(
      { rule_key: 'financing_not_offered', rule_name: ' Financing not offered ', body_md: ' look for budget objections ' },
      42,
    );

    expect(ruleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rule_key: 'financing_not_offered',
        rule_name: 'Financing not offered',
        body_md: 'look for budget objections',
        severity: 'medium',
        is_active: true,
        updated_by: 42,
      }),
    });
    expect(created.rule_key).toBe('financing_not_offered');
  });

  it('defaults a new rule to omission, so the verification pass audits it', async () => {
    // Safe direction: an audited rule can lose a false positive, an unaudited
    // one cannot. Authors of a content-graded rule turn the flag off.
    ruleFindUnique.mockResolvedValue(null);
    ruleCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      dbRow({ ...data, updated_at: new Date('2026-09-08T00:00:00Z') }));

    await createRule({ rule_key: 'financing_not_offered', rule_name: 'x', body_md: 'y' }, 1);
    expect(ruleCreate.mock.calls[0][0].data.is_omission).toBe(true);

    await createRule(
      { rule_key: 'tone_on_the_call', rule_name: 'x', body_md: 'y', is_omission: false },
      1,
    );
    expect(ruleCreate.mock.calls[1][0].data.is_omission).toBe(false);
  });
});

describe('updateRule', () => {
  it('never patches rule_key, even when one is supplied', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    ruleUpdate.mockResolvedValue(dbRow());

    await updateRule(1, { rule_key: 'renamed_key', rule_name: 'New name' } as never, 7);

    const { data } = ruleUpdate.mock.calls[0][0];
    expect(data).not.toHaveProperty('rule_key');
    expect(data.rule_name).toBe('New name');
  });

  it('rejects blanking the body of a live rule', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    await expect(updateRule(1, { body_md: '  ' }, 7)).rejects.toThrow(/body cannot be empty/);
    expect(ruleUpdate).not.toHaveBeenCalled();
  });

  it('normalises an empty guidance string to null', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    ruleUpdate.mockResolvedValue(dbRow());
    await updateRule(1, { guidance_md: '   ' }, 7);
    expect(ruleUpdate.mock.calls[0][0].data.guidance_md).toBeNull();
  });

  it('patches is_omission, so the exemption is editable without a deploy', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    ruleUpdate.mockResolvedValue(dbRow({ is_omission: false }));
    await updateRule(1, { is_omission: false }, 7);
    expect(ruleUpdate.mock.calls[0][0].data.is_omission).toBe(false);
  });

  it('leaves is_omission untouched when the patch does not mention it', async () => {
    ruleFindUnique.mockResolvedValue(dbRow());
    ruleUpdate.mockResolvedValue(dbRow());
    await updateRule(1, { rule_name: 'New name' }, 7);
    expect(ruleUpdate.mock.calls[0][0].data).not.toHaveProperty('is_omission');
  });

  it('rejects an unknown rule id', async () => {
    ruleFindUnique.mockResolvedValue(null);
    await expect(updateRule(999, { rule_name: 'x' }, 7)).rejects.toThrow(/Rule not found/);
  });
});
