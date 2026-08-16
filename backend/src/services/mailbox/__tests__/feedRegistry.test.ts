import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();

vi.mock('../../../config/database', () => ({
  default: { execute: (...args: unknown[]) => execute(...args) },
}));

import {
  listFeeds, getFeedById, createFeed, updateFeed, deleteFeed, isKnownDataType,
} from '../feedRegistry';

beforeEach(() => vi.clearAllMocks());

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  data_type: 'punch_data',
  display_name: 'Paychex Punch Data',
  cadence_label: 'Daily',
  is_active: 1,
  sort_order: 0,
  ...over,
});

describe('isKnownDataType', () => {
  it('accepts known import types and rejects the rest', () => {
    expect(isKnownDataType('punch_data')).toBe(true);
    expect(isKnownDataType('call_activity')).toBe(true);
    expect(isKnownDataType('not_a_type')).toBe(false);
  });
});

describe('listFeeds', () => {
  it('maps table rows to feed records', async () => {
    execute.mockResolvedValueOnce([[row()], []]);

    const feeds = await listFeeds();

    expect(feeds).toEqual([
      { id: 1, dataType: 'punch_data', name: 'Paychex Punch Data', cadenceLabel: 'Daily', isActive: true, sortOrder: 0 },
    ]);
  });

  it('skips rows whose data_type is no longer a known import type', async () => {
    execute.mockResolvedValueOnce([[
      row({ id: 2, data_type: 'gone_stale', display_name: 'Old' }),
      row({ id: 3, data_type: 'call_activity', display_name: 'Calls' }),
    ], []]);

    const feeds = await listFeeds();

    expect(feeds.map(f => f.dataType)).toEqual(['call_activity']);
  });

  it('falls back to the data_type as the name when display_name is blank', async () => {
    execute.mockResolvedValueOnce([[row({ display_name: '   ' })], []]);

    const feeds = await listFeeds();

    expect(feeds[0].name).toBe('punch_data');
  });

  it('filters to active feeds when includeInactive is false', async () => {
    execute.mockResolvedValueOnce([[], []]);

    await listFeeds(false);

    expect(String(execute.mock.calls[0][0])).toContain('WHERE is_active = 1');
  });
});

describe('getFeedById', () => {
  it('returns null when no row is found', async () => {
    execute.mockResolvedValueOnce([[], []]);
    expect(await getFeedById(99)).toBeNull();
  });
});

describe('createFeed', () => {
  it('inserts with the supplied values then returns the created record', async () => {
    execute
      .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }, []]) // INSERT
      .mockResolvedValueOnce([[row({ id: 7 })], []]);                // getFeedById

    const created = await createFeed({ dataType: 'punch_data', name: 'Paychex Punch Data', cadenceLabel: 'Daily' });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO mailbox_import_feed');
    expect(params).toEqual(['punch_data', 'Paychex Punch Data', 'Daily', 1, 0]);
    expect(created.id).toBe(7);
  });

  it('defaults is_active to true and cadence to null', async () => {
    execute
      .mockResolvedValueOnce([{ insertId: 8, affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row({ id: 8 })], []]);

    await createFeed({ dataType: 'call_activity', name: 'Calls' });

    expect(execute.mock.calls[0][1]).toEqual(['call_activity', 'Calls', null, 1, 0]);
  });
});

describe('updateFeed', () => {
  it('builds a partial SET clause from the supplied fields only', async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // UPDATE
      .mockResolvedValueOnce([[row()], []]);            // getFeedById

    await updateFeed(1, { name: 'New Name', isActive: false });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain('display_name = ?');
    expect(String(sql)).toContain('is_active = ?');
    expect(String(sql)).not.toContain('cadence_label = ?');
    expect(params).toEqual(['New Name', 0, 1]);
  });

  it('returns null when the row does not exist', async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect(await updateFeed(42, { name: 'x' })).toBeNull();
  });
});

describe('deleteFeed', () => {
  it('reports whether a row was removed', async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    expect(await deleteFeed(1)).toBe(true);

    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect(await deleteFeed(2)).toBe(false);
  });
});
