/**
 * Librarian: merges mined plays into a small canonical playbook. Tests pin the
 * two things that matter — support is SUMMED from the merged members (so ranking
 * stays honest), and a rebuild replaces prior canon + retires the raw pile it
 * represents rather than stacking duplicates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findMany, createMany, updateMany, callChatModel,
  resolveProvider, resolveTierModel, getMoSettings,
} = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
  callChatModel: vi.fn(),
  resolveProvider: vi.fn(),
  resolveTierModel: vi.fn(),
  getMoSettings: vi.fn(),
}));

vi.mock('../../../../../config/prisma', () => ({
  default: {
    ieSalesPlay: { findMany, createMany, updateMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ ieSalesPlay: { createMany, updateMany } }),
  },
}));
vi.mock('../../../../../config/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../ai/ChatModelClient', () => ({ callChatModel: (...a: unknown[]) => callChatModel(...a) }));
vi.mock('../../../../aiCallLogger', () => ({
  withCallLog: async (_m: unknown, _p: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result,
}));
vi.mock('../../analyzer', () => ({
  resolveProvider: () => resolveProvider(),
  resolveTierModel: (...a: unknown[]) => resolveTierModel(...a),
}));
vi.mock('../../settings', () => ({ getMissedOpportunitySettings: () => getMoSettings() }));

import { parseCanonical, canonicalizePlays } from '../librarian';

const minedRow = (
  id: number,
  support: number | null,
  over: { evidence_quote?: string | null; evidence_speaker?: string | null; source_outcome?: string } = {},
) => ({
  play_id: BigInt(id),
  title: `title ${id}`,
  body_md: `body ${id}`,
  evidence_quote: null as string | null,
  evidence_speaker: null as string | null,
  est_value_note: null,
  support_count: support,
  source_outcome: 'WON',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveProvider.mockReturnValue('anthropic');
  resolveTierModel.mockReturnValue('claude-sonnet-4-6');
  getMoSettings.mockResolvedValue({ systemPersona: 'persona' });
  createMany.mockResolvedValue({ count: 0 });
  updateMany.mockResolvedValue({ count: 0 });
});

describe('parseCanonical', () => {
  it('sums support from merged member indexes', () => {
    const rows = [minedRow(1, 3), minedRow(2, 5), minedRow(3, 2)];
    const out = parseCanonical(
      JSON.stringify({ plays: [{ title: 'Do X', body_md: 'say Y', members: [1, 2, 3] }] }),
      rows,
    );
    expect(out).toHaveLength(1);
    expect(out[0].support).toBe(10);
  });

  it('treats null support members as 1 and ignores out-of-range indexes', () => {
    const rows = [minedRow(1, null), minedRow(2, 4)];
    const out = parseCanonical(
      JSON.stringify({ plays: [{ title: 'Do X', body_md: 'say Y', members: [1, 2, 99] }] }),
      rows,
    );
    expect(out[0].support).toBe(5); // 1 (null) + 4, index 99 ignored
  });

  it('defaults support to 1 when no valid members', () => {
    const out = parseCanonical(JSON.stringify({ plays: [{ title: 'T', body_md: 'B', members: [] }] }), []);
    expect(out[0].support).toBe(1);
  });

  it('returns [] on invalid JSON', () => {
    expect(parseCanonical('not json', [])).toEqual([]);
  });

  // Provenance. The merged output is what grounds the reviewer's wording, so a
  // quote in it has to be words somebody really said on one of the source
  // calls — the model is never shown enough to compose one honestly.
  it('keeps the member quote the model picked, with that member’s speaker', () => {
    const rows = [
      minedRow(1, 3, { evidence_quote: 'We can start Monday if you order today', evidence_speaker: 'AGENT' }),
      minedRow(2, 5, { evidence_quote: 'Send me the link and I will do it tonight', evidence_speaker: 'CUSTOMER' }),
    ];
    const out = parseCanonical(
      JSON.stringify({
        plays: [{
          title: 'Do X',
          body_md: 'say Y',
          evidence_quote: 'Send me the link and I will do it tonight',
          evidence_speaker: 'AGENT',
          members: [1, 2],
        }],
      }),
      rows,
    );
    expect(out[0].evidenceQuote).toBe('Send me the link and I will do it tonight');
    // Speaker comes from the matched member, not the model's claim about it.
    expect(out[0].evidenceSpeaker).toBe('CUSTOMER');
  });

  it('replaces a quote the model composed with the best-supported real one', () => {
    const rows = [
      minedRow(1, 3, { evidence_quote: 'We can start Monday if you order today' }),
      minedRow(2, 9, { evidence_quote: 'Send me the link and I will do it tonight' }),
    ];
    const out = parseCanonical(
      JSON.stringify({
        plays: [{
          title: 'Do X',
          body_md: 'say Y',
          evidence_quote: 'Offer to start Monday and ask for the order today',
          members: [1, 2],
        }],
      }),
      rows,
    );
    expect(out[0].evidenceQuote).toBe('Send me the link and I will do it tonight');
  });

  it('derives the outcome from the members instead of asserting WON', () => {
    const won = parseCanonical(
      JSON.stringify({ plays: [{ title: 'T', body_md: 'B', members: [1, 2] }] }),
      [minedRow(1, 1), minedRow(2, 1)],
    );
    expect(won[0].sourceOutcome).toBe('WON');

    const mixed = parseCanonical(
      JSON.stringify({ plays: [{ title: 'T', body_md: 'B', members: [1, 2] }] }),
      [minedRow(1, 1), minedRow(2, 1, { source_outcome: 'LOST' })],
    );
    expect(mixed[0].sourceOutcome).toBe('MIXED');

    const lost = parseCanonical(
      JSON.stringify({ plays: [{ title: 'T', body_md: 'B', members: [1] }] }),
      [minedRow(1, 1, { source_outcome: 'LOST' })],
    );
    expect(lost[0].sourceOutcome).toBe('LOST');
  });
});

describe('canonicalizePlays', () => {
  it('skips when no provider is configured', async () => {
    resolveProvider.mockReturnValue(null);
    const s = await canonicalizePlays();
    expect(s.skipped).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('inserts canonical as active, sums support, and archives the raw pile', async () => {
    // Only the first category has mined rows; others empty.
    let served = false;
    findMany.mockImplementation(async () => {
      if (served) return [];
      served = true;
      return [minedRow(1, 6), minedRow(2, 4)];
    });
    callChatModel.mockResolvedValue({
      text: JSON.stringify({ plays: [{ title: 'Canonical', body_md: 'do it', members: [1, 2] }] }),
      model: 'claude-sonnet-4-6', tokensIn: 100, tokensOut: 50,
    });
    updateMany.mockResolvedValue({ count: 2 });

    const s = await canonicalizePlays({ activate: true });

    expect(s.activated).toBe(true);
    expect(s.categories).toBe(1);
    expect(s.canonicalInserted).toBe(1);
    // Canon inserted as active with summed support and null source (canon marker).
    const created = createMany.mock.calls[0][0].data[0];
    expect(created.status).toBe('active');
    expect(created.support_count).toBe(10);
    expect(created.source_conversation_id).toBeNull();
    expect(created.source_outcome).toBe('WON');
    // Raw pile retired.
    const archivedRaw = updateMany.mock.calls.find(
      ([a]) => a.data.status === 'archived' && a.where.source_conversation_id?.not === null,
    );
    expect(archivedRaw).toBeTruthy();
  });
});
