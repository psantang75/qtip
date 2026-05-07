import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({ quietHours: '23-06', timezone: 'UTC' }));

vi.mock('../../../config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/environment')>();
  return {
    ...actual,
    mailConfig: new Proxy({} as any, {
      get: (_t, prop) => {
        if (prop === 'quietHours') return state.quietHours;
        if (prop === 'timezone') return state.timezone;
        return (actual.mailConfig as any)[prop];
      },
    }),
  };
});

import { isQuietHour } from '../quietHours';

describe('quiet hours', () => {
  it('handles wraparound windows (23-06)', () => {
    state.quietHours = '23-06';
    expect(isQuietHour(new Date('2026-05-06T00:30:00Z'))).toBe(true);
    expect(isQuietHour(new Date('2026-05-06T05:59:00Z'))).toBe(true);
    expect(isQuietHour(new Date('2026-05-06T06:00:00Z'))).toBe(false);
    expect(isQuietHour(new Date('2026-05-06T22:59:00Z'))).toBe(false);
    expect(isQuietHour(new Date('2026-05-06T23:00:00Z'))).toBe(true);
  });

  it('handles same-day windows (12-13)', () => {
    state.quietHours = '12-13';
    expect(isQuietHour(new Date('2026-05-06T12:30:00Z'))).toBe(true);
    expect(isQuietHour(new Date('2026-05-06T11:59:00Z'))).toBe(false);
    expect(isQuietHour(new Date('2026-05-06T13:00:00Z'))).toBe(false);
  });

  it('returns false when no quiet hours configured', () => {
    state.quietHours = '';
    expect(isQuietHour(new Date())).toBe(false);
  });
});
