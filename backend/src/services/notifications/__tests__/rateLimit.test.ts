import { describe, it, expect, beforeEach } from 'vitest';
import { shouldRateLimit, _resetForTest } from '../rateLimit';

describe('per-recipient rate limit', () => {
  beforeEach(() => _resetForTest());

  it('allows the first 30 sends in a 5-min window', () => {
    for (let i = 0; i < 30; i++) {
      expect(shouldRateLimit('agent@dm-us.com')).toBe(false);
    }
    expect(shouldRateLimit('agent@dm-us.com')).toBe(true);
  });

  it('rate-limits per address — runaway loop on one address never affects another', () => {
    for (let i = 0; i < 30; i++) shouldRateLimit('a@dm-us.com');
    expect(shouldRateLimit('a@dm-us.com')).toBe(true);
    expect(shouldRateLimit('b@dm-us.com')).toBe(false);
  });
});
