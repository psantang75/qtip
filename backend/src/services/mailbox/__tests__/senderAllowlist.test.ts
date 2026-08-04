/**
 * The allowlist is the security boundary for inbound imports, so its matching
 * rules are pinned here. `loadAllowedSenders` is not covered — it is a single
 * SELECT, and the interesting behaviour is entirely in the comparison.
 */
import { describe, it, expect } from 'vitest';
import { isSenderAllowed } from '../senderAllowlist';

const allowed = new Set(['no-reply@centralservers.com', 'ops@dm-us.com']);

describe('isSenderAllowed', () => {
  it('admits an address on the list', () => {
    expect(isSenderAllowed('no-reply@centralservers.com', allowed)).toBe(true);
  });

  it('ignores case, because mail systems do', () => {
    expect(isSenderAllowed('No-Reply@CentralServers.com', allowed)).toBe(true);
  });

  it('ignores stray whitespace, which is what a pasted address arrives with', () => {
    expect(isSenderAllowed('  ops@dm-us.com ', allowed)).toBe(true);
  });

  it('refuses an address that is not on the list', () => {
    expect(isSenderAllowed('attacker@example.com', allowed)).toBe(false);
  });

  it('refuses an empty sender rather than treating it as a wildcard', () => {
    expect(isSenderAllowed('', allowed)).toBe(false);
    expect(isSenderAllowed('   ', allowed)).toBe(false);
  });

  it('fails closed when the list is empty', () => {
    // An unconfigured or half-migrated install must admit nobody, not everybody.
    expect(isSenderAllowed('ops@dm-us.com', new Set())).toBe(false);
  });

  it('does not match on a substring or a lookalike domain', () => {
    expect(isSenderAllowed('ops@dm-us.com.evil.net', allowed)).toBe(false);
    expect(isSenderAllowed('xops@dm-us.com', allowed)).toBe(false);
  });
});
