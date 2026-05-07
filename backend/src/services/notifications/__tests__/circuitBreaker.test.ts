import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/environment')>();
  return {
    ...actual,
    mailConfig: {
      ...actual.mailConfig,
      globalRateLimit: 5,
    },
  };
});

import { recordSend, isTripped, getState, _resetForTest, shouldNotifyAdminsOnTrip } from '../circuitBreaker';

describe('circuit breaker', () => {
  beforeEach(() => _resetForTest());

  it('does not trip below the threshold', () => {
    for (let i = 0; i < 4; i++) recordSend();
    expect(isTripped()).toBe(false);
  });

  it('trips when the threshold is reached in a single window', () => {
    for (let i = 0; i < 5; i++) recordSend();
    expect(isTripped()).toBe(true);
    expect(getState().count).toBe(5);
  });

  it('admin alert fires once per trip, not on every record', () => {
    for (let i = 0; i < 5; i++) recordSend();
    expect(shouldNotifyAdminsOnTrip()).toBe(true);
    expect(shouldNotifyAdminsOnTrip()).toBe(false);
  });
});
