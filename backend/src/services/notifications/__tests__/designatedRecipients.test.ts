/**
 * Named alert recipients, chosen by address in List Management.
 *
 * The failure worth guarding is the quiet one: an address that belongs to nobody
 * looks identical to a working configuration from the outside, so it has to be
 * reported rather than dropped. Everything else is about being forgiving of how
 * people type addresses into a text field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../../config/prisma', () => ({
  default: { $queryRaw: mocks.queryRaw, user: { findMany: mocks.findMany } },
}));

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../generated/prisma/client', () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }) },
}));

import logger from '../../../config/logger';
import { loadDesignatedAddresses, loadDesignatedRecipients } from '../designatedRecipients';

const user = (id: number, username: string, email: string) => ({
  id, username, email, role_id: 1, is_active: true, manager_id: null, department_id: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe('loadDesignatedAddresses', () => {
  it('lowercases and strips whitespace, so pasted addresses still match', async () => {
    mocks.queryRaw.mockResolvedValue([{ label: '  PSantangelo@dm-us.com ' }, { label: 'lroose@DM-US.com' }]);
    expect(await loadDesignatedAddresses()).toEqual(['psantangelo@dm-us.com', 'lroose@dm-us.com']);
  });

  it('drops blank rows and collapses duplicates', async () => {
    mocks.queryRaw.mockResolvedValue([{ label: 'a@x.com' }, { label: 'A@X.com' }, { label: '   ' }]);
    expect(await loadDesignatedAddresses()).toEqual(['a@x.com']);
  });

  it('returns nothing for an empty list rather than failing', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    expect(await loadDesignatedAddresses()).toEqual([]);
  });
});

describe('loadDesignatedRecipients', () => {
  it('resolves listed addresses to their QTIP users', async () => {
    mocks.queryRaw.mockResolvedValue([{ label: 'lroose@dm-us.com' }]);
    mocks.findMany.mockResolvedValue([user(7, 'Levi Roose', 'lroose@dm-us.com')]);

    const rows = await loadDesignatedRecipients();

    expect(rows.map(r => r.id)).toEqual([7]);
  });

  it('skips the user lookup entirely when the list is empty', async () => {
    mocks.queryRaw.mockResolvedValue([]);

    expect(await loadDesignatedRecipients()).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('warns about an address that matches no active user instead of failing quietly', async () => {
    // A notification needs a real user_id to be queued, so this address can never
    // be mailed. Silence here reads as "configured" and nobody finds the typo.
    mocks.queryRaw.mockResolvedValue([{ label: 'lroose@dm-us.com' }, { label: 'typo@dm-us.com' }]);
    mocks.findMany.mockResolvedValue([user(7, 'Levi Roose', 'lroose@dm-us.com')]);

    const rows = await loadDesignatedRecipients();

    expect(rows).toHaveLength(1);
    const warned = vi.mocked(logger.warn).mock.calls as unknown as unknown[][];
    expect(warned).toHaveLength(1);
    expect(warned[0][1]).toMatchObject({ addresses: ['typo@dm-us.com'] });
  });

  it('stays quiet when every address resolves', async () => {
    mocks.queryRaw.mockResolvedValue([{ label: 'lroose@dm-us.com' }]);
    mocks.findMany.mockResolvedValue([user(7, 'Levi Roose', 'lroose@dm-us.com')]);

    await loadDesignatedRecipients();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('matches a stored address whose casing differs from the list entry', async () => {
    // MySQL compares case-insensitively, so the user row can come back in any
    // casing; the unmatched check has to normalise before comparing.
    mocks.queryRaw.mockResolvedValue([{ label: 'psantangelo@dm-us.com' }]);
    mocks.findMany.mockResolvedValue([user(6, 'Pete Santangelo', 'PSantangelo@dm-us.com')]);

    const rows = await loadDesignatedRecipients();

    expect(rows).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
