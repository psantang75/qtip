/**
 * RulePackService — DB-backed library for AI Reviewer rule packs.
 *
 * The service exposes a SYNC public read API (so the existing prompt
 * builders don't need to become async) backed by an in-process cache
 * that's hydrated from Prisma at server bootstrap and refreshed on
 * every write. These tests cover:
 *
 *   - warmCache loading both packs + assignments
 *   - sync reads returning cached values
 *   - setPackKeysForForm transactional + cache refresh + key validation
 *   - upsertPack create + update + cache visibility
 *   - archivePack soft-delete hides the pack from active reads
 *   - listAllPacks include_archived flag
 *   - renderPacksForPrompt formatting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  ruleFindMany,
  ruleFindUnique,
  ruleUpsert,
  ruleUpdate,
  assignmentFindMany,
  assignmentDeleteMany,
  assignmentCreateMany,
  transactionMock,
} = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  ruleFindUnique: vi.fn(),
  ruleUpsert: vi.fn(),
  ruleUpdate: vi.fn(),
  assignmentFindMany: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  assignmentCreateMany: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    aiRulePack: {
      findMany: ruleFindMany,
      findUnique: ruleFindUnique,
      upsert: ruleUpsert,
      update: ruleUpdate,
    },
    aiFormRulePackAssignment: {
      findMany: assignmentFindMany,
      deleteMany: assignmentDeleteMany,
      createMany: assignmentCreateMany,
    },
    $transaction: transactionMock,
  },
}));

import {
  rulePackService,
  warmCache,
  clearRulePackCache,
  RulePackError,
} from '../RulePackService';

const fakePack = (over: Partial<any> = {}) => ({
  id: 1,
  key: 'tech-ticket-process',
  name: 'Tech Ticket Process',
  owner_dept: 'Tech Support',
  body_md: 'Body for tech ticket process.',
  always_include_urls_json: ['http://example.test/page-a'],
  is_archived: false,
  updated_by: null,
  updated_at: new Date('2026-05-01T00:00:00Z'),
  created_at: new Date('2026-05-01T00:00:00Z'),
  ...over,
});

const fakeAssignment = (over: Partial<any> = {}) => ({
  id: 10,
  form_id: 99017,
  rule_pack_id: 1,
  sort_order: 0,
  updated_by: null,
  created_at: new Date('2026-05-01T00:00:00Z'),
  rule_pack: { key: 'tech-ticket-process', is_archived: false },
  ...over,
});

beforeEach(() => {
  ruleFindMany.mockReset();
  ruleFindUnique.mockReset();
  ruleUpsert.mockReset();
  ruleUpdate.mockReset();
  assignmentFindMany.mockReset();
  assignmentDeleteMany.mockReset();
  assignmentCreateMany.mockReset();
  transactionMock.mockReset();
  clearRulePackCache();
});

describe('warmCache + sync reads', () => {
  it('loads packs and assignments and exposes them via sync getters', async () => {
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([fakeAssignment()]);

    await warmCache();

    expect(rulePackService.listPackSummaries()).toEqual([
      { key: 'tech-ticket-process', name: 'Tech Ticket Process', owner_dept: 'Tech Support' },
    ]);
    expect(rulePackService.getPackKeysForForm(99017)).toEqual(['tech-ticket-process']);
    const packs = rulePackService.getPacksForForm(99017);
    expect(packs).toHaveLength(1);
    expect(packs[0].body).toBe('Body for tech ticket process.');
    expect(rulePackService.getAlwaysIncludeUrlsForForm(99017)).toEqual([
      'http://example.test/page-a',
    ]);
  });

  it('returns empty arrays when no assignments are loaded', async () => {
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([]);
    await warmCache();

    expect(rulePackService.getPackKeysForForm(12345)).toEqual([]);
    expect(rulePackService.getPacksForForm(12345)).toEqual([]);
    expect(rulePackService.renderPacksForPrompt(12345)).toBe('');
  });

  it('skips assignments whose pack is archived (defensive)', async () => {
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([
      fakeAssignment({ rule_pack: { key: 'tech-ticket-process', is_archived: true } }),
    ]);
    await warmCache();

    expect(rulePackService.getPackKeysForForm(99017)).toEqual([]);
  });

  it('returns empty (not throws) when reads happen before warmCache', () => {
    expect(rulePackService.listPacks()).toEqual([]);
    expect(rulePackService.getPackKeysForForm(99017)).toEqual([]);
    expect(rulePackService.renderPacksForPrompt(99017)).toBe('');
  });
});

describe('setPackKeysForForm', () => {
  beforeEach(async () => {
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([]);
    await warmCache();
  });

  it('rejects unknown pack keys before touching the DB', async () => {
    ruleFindMany.mockResolvedValueOnce([]); // resolution lookup returns nothing
    await expect(
      rulePackService.setPackKeysForForm(99017, ['no-such-pack']),
    ).rejects.toBeInstanceOf(RulePackError);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('writes a transaction (deleteMany + createMany) and refreshes the cache', async () => {
    ruleFindMany.mockResolvedValueOnce([{ id: 1, key: 'tech-ticket-process' }]); // resolution
    transactionMock.mockResolvedValueOnce([{}, { count: 1 }]);
    // refresh after write:
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([fakeAssignment()]);

    const saved = await rulePackService.setPackKeysForForm(99017, ['tech-ticket-process'], 7);

    expect(saved).toEqual(['tech-ticket-process']);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(rulePackService.getPackKeysForForm(99017)).toEqual(['tech-ticket-process']);
  });

  it('clearing a form (empty keys) issues only a deleteMany, no createMany', async () => {
    transactionMock.mockResolvedValueOnce([{}]);
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([]);

    const saved = await rulePackService.setPackKeysForForm(99017, [], 7);

    expect(saved).toEqual([]);
    // The transaction was called with a single op (deleteMany only).
    const ops = transactionMock.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(1);
  });

  it('dedupes incoming keys', async () => {
    ruleFindMany.mockResolvedValueOnce([{ id: 1, key: 'tech-ticket-process' }]);
    transactionMock.mockResolvedValueOnce([{}, { count: 1 }]);
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([fakeAssignment()]);

    const saved = await rulePackService.setPackKeysForForm(
      99017,
      ['tech-ticket-process', 'tech-ticket-process', '  '],
      null,
    );

    expect(saved).toEqual(['tech-ticket-process']);
  });

  it('rejects invalid form id', async () => {
    await expect(rulePackService.setPackKeysForForm(0, [])).rejects.toBeInstanceOf(RulePackError);
    await expect(rulePackService.setPackKeysForForm(-1, [])).rejects.toBeInstanceOf(RulePackError);
  });
});

describe('upsertPack', () => {
  beforeEach(async () => {
    ruleFindMany.mockResolvedValueOnce([]);
    assignmentFindMany.mockResolvedValueOnce([]);
    await warmCache();
  });

  it('validates required fields', async () => {
    await expect(
      rulePackService.upsertPack({
        key: '',
        name: 'X',
        owner_dept: 'Y',
        body_md: 'b',
        always_include_urls: [],
      }),
    ).rejects.toBeInstanceOf(RulePackError);
    await expect(
      rulePackService.upsertPack({
        key: 'BadKey',
        name: 'X',
        owner_dept: 'Y',
        body_md: 'b',
        always_include_urls: [],
      }),
    ).rejects.toBeInstanceOf(RulePackError);
    await expect(
      rulePackService.upsertPack({
        key: 'good-key',
        name: '',
        owner_dept: 'Y',
        body_md: 'b',
        always_include_urls: [],
      }),
    ).rejects.toBeInstanceOf(RulePackError);
  });

  it('upserts the row and refreshes cache so the new pack is visible', async () => {
    ruleUpsert.mockResolvedValueOnce(fakePack({ id: 2, key: 'new-pack', name: 'New' }));
    // refresh-after-write
    ruleFindMany.mockResolvedValueOnce([
      fakePack({ id: 2, key: 'new-pack', name: 'New' }),
    ]);
    assignmentFindMany.mockResolvedValueOnce([]);

    const pack = await rulePackService.upsertPack({
      key: 'new-pack',
      name: 'New',
      owner_dept: 'QA',
      body_md: 'Body',
      always_include_urls: ['http://example.test/x'],
      updated_by: 42,
    });

    expect(pack.key).toBe('new-pack');
    expect(rulePackService.listPacks().map((p) => p.key)).toContain('new-pack');
  });
});

describe('archivePack', () => {
  it('soft-deletes via update + cache refresh removes it from active reads', async () => {
    // Initial warm: pack visible.
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    assignmentFindMany.mockResolvedValueOnce([fakeAssignment()]);
    await warmCache();
    expect(rulePackService.listPackSummaries()).toHaveLength(1);

    // Archive: update returns archived row, refresh sees no active pack.
    ruleUpdate.mockResolvedValueOnce(fakePack({ is_archived: true }));
    ruleFindMany.mockResolvedValueOnce([]);
    assignmentFindMany.mockResolvedValueOnce([
      fakeAssignment({ rule_pack: { key: 'tech-ticket-process', is_archived: true } }),
    ]);

    await rulePackService.archivePack(1, 7);
    expect(rulePackService.listPackSummaries()).toHaveLength(0);
  });
});

describe('listAllPacks (admin library view)', () => {
  it('passes include_archived through to Prisma', async () => {
    ruleFindMany.mockResolvedValueOnce([
      fakePack(),
      fakePack({ id: 2, key: 'old', is_archived: true }),
    ]);
    const all = await rulePackService.listAllPacks(true);
    expect(all).toHaveLength(2);
    expect(ruleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('filters archived by default', async () => {
    ruleFindMany.mockResolvedValueOnce([fakePack()]);
    const active = await rulePackService.listAllPacks(false);
    expect(active).toHaveLength(1);
    expect(ruleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_archived: false } }),
    );
  });
});

describe('renderPacksForPrompt', () => {
  it('produces a labeled section per assigned pack', async () => {
    ruleFindMany.mockResolvedValueOnce([
      fakePack(),
      fakePack({ id: 2, key: 'call-quality-12-category', name: 'Call Quality', body_md: 'CQ body.' }),
    ]);
    assignmentFindMany.mockResolvedValueOnce([
      fakeAssignment(),
      fakeAssignment({ id: 11, rule_pack_id: 2, sort_order: 1, rule_pack: { key: 'call-quality-12-category', is_archived: false } }),
    ]);
    await warmCache();

    const out = rulePackService.renderPacksForPrompt(99017);
    expect(out).toContain('RULE PACK: Tech Ticket Process (owner: Tech Support)');
    expect(out).toContain('RULE PACK: Call Quality (owner: Tech Support)');
    expect(out).toMatch(/^\n\n/);
  });
});
