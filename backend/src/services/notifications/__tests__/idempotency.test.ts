import { describe, it, expect } from 'vitest';
import { dedupeKey, digestDedupeKey, resendKey } from '../idempotency';

describe('idempotency keys', () => {
  it('dedupe key includes event, entity id, and recipient user id', () => {
    expect(dedupeKey('dispute.opened', 42, 87)).toBe('dispute.opened:42:user_id=87');
  });

  it('different recipients on the same event get distinct keys', () => {
    expect(dedupeKey('writeup.signed', 5, 10)).not.toBe(dedupeKey('writeup.signed', 5, 11));
  });

  it('digest dedupe key folds in the window so distinct hours land separate rows', () => {
    const a = digestDedupeKey('digest.csr_daily', 7, new Date('2026-05-06T17:00:00Z'));
    const b = digestDedupeKey('digest.csr_daily', 7, new Date('2026-05-06T17:30:00Z'));
    const c = digestDedupeKey('digest.csr_daily', 7, new Date('2026-05-06T18:00:00Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('resendKey is suffixed and never collides with the original', () => {
    const original = dedupeKey('coaching.scheduled', 1, 2);
    const resend = resendKey(original);
    expect(resend).not.toBe(original);
    expect(resend.startsWith(original)).toBe(true);
  });
});
