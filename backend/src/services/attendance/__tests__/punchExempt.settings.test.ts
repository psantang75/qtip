import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('../../../config/prisma', () => ({
  default: {
    ieConfig: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  punchExemptKey,
  getPunchExemptUserIds,
  isPunchExempt,
  setPunchExempt,
  attachPunchExempt,
} from '../punchExempt.settings';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('punchExemptKey', () => {
  it('is one ie_config key per user, under the 50-char column limit', () => {
    expect(punchExemptKey(24)).toBe('user.24.does_not_punch');
    expect(punchExemptKey(24).length).toBeLessThanOrEqual(50);
  });
});

describe('getPunchExemptUserIds', () => {
  it('returns only keys whose value is 1', async () => {
    mocks.findMany.mockResolvedValue([
      { config_key: 'user.24.does_not_punch', config_value: '1' },
      { config_key: 'user.9.does_not_punch', config_value: '0' },
      { config_key: 'user.bad.does_not_punch', config_value: '1' },
    ]);

    const ids = await getPunchExemptUserIds();
    expect([...ids]).toEqual([24]);
  });
});

describe('isPunchExempt / setPunchExempt', () => {
  it('is true only when the row is exactly 1', async () => {
    mocks.findUnique.mockResolvedValue({ config_value: '1' });
    expect(await isPunchExempt(24)).toBe(true);

    mocks.findUnique.mockResolvedValue({ config_value: '0' });
    expect(await isPunchExempt(24)).toBe(false);

    mocks.findUnique.mockResolvedValue(null);
    expect(await isPunchExempt(24)).toBe(false);
  });

  it('writes 1 when turning on and deletes the row when turning off', async () => {
    await setPunchExempt(24, true);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { config_key: 'user.24.does_not_punch' },
      create: expect.objectContaining({ config_value: '1' }),
    }));

    await setPunchExempt(24, false);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { config_key: 'user.24.does_not_punch' },
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('attachPunchExempt', () => {
  it('stamps the flag from one list read', async () => {
    mocks.findMany.mockResolvedValue([
      { config_key: 'user.24.does_not_punch', config_value: '1' },
    ]);

    const out = await attachPunchExempt([{ id: 24, username: 'a' }, { id: 3, username: 'b' }]);
    expect(out).toEqual([
      { id: 24, username: 'a', does_not_punch: true },
      { id: 3, username: 'b', does_not_punch: false },
    ]);
  });
});
