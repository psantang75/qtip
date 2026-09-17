/**
 * Consolidation collapses semantically-duplicate proposed plays into one
 * exemplar per cluster (within a category), rolls the cluster size into
 * support_count, and archives the absorbed duplicates. Approved (`active`) plays
 * are fixed canon — never archived — and only have their support bumped. When
 * the embedder is unavailable the whole pass is a no-op (plays are never lost).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, updateMany, embedQueryVectors } = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  embedQueryVectors: vi.fn(),
}));

vi.mock('../../../../../config/prisma', () => ({
  default: {
    ieSalesPlay: { findMany, updateMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ ieSalesPlay: { updateMany } }),
  },
}));
vi.mock('../../../../../config/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../KbIndexService', () => ({
  default: { embedQueryVectors },
  KbIndexService: { cosineSimilarity: (a: Float32Array, b: Float32Array) => a[0] * b[0] + a[1] * b[1] },
}));

import { consolidatePlays } from '../consolidate';

function play(id: number, title: string, opts: Partial<{ status: string; evidence: string | null; support: number | null }> = {}) {
  return {
    play_id: BigInt(id),
    category: 'closing',
    title,
    body_md: `${title} body`,
    evidence_quote: opts.evidence ?? null,
    status: opts.status ?? 'proposed',
    support_count: opts.support ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consolidatePlays', () => {
  it('keeps one exemplar per cluster, archives dupes, and records support', async () => {
    // A and B are near-identical (cosine ~1); C is orthogonal (distinct).
    findMany.mockImplementation(async ({ where }: { where: { status: string } }) =>
      where.status === 'active' ? [] : [play(1, 'A'), play(2, 'B'), play(3, 'C')],
    );
    embedQueryVectors.mockResolvedValue([
      Float32Array.from([1, 0]),
      Float32Array.from([0.995, 0.0998]),
      Float32Array.from([0, 1]),
    ]);

    const summary = await consolidatePlays();

    expect(summary.skipped).toBe(false);
    expect(summary.exemplars).toBe(2); // A and C
    expect(summary.archived).toBe(1); // B absorbed into A
    expect(summary.bumped).toBe(0);

    // B archived.
    const archiveCall = updateMany.mock.calls.find(([a]) => a.data.status === 'archived');
    expect(archiveCall?.[0].where.play_id.in).toEqual([BigInt(2)]);

    // Support set: A → 2 (itself + B), C → 1.
    const supportCalls = updateMany.mock.calls.filter(([a]) => a.data.status === undefined);
    const setFor = (id: number) =>
      supportCalls.find(([a]) => a.where.play_id.in.includes(BigInt(id)))?.[0].data.support_count;
    expect(setFor(1)).toBe(2);
    expect(setFor(3)).toBe(1);
  });

  it('bumps an approved (active) exemplar instead of archiving canon', async () => {
    findMany.mockImplementation(async ({ where }: { where: { status: string } }) =>
      where.status === 'active'
        ? [play(10, 'Canon close', { status: 'active', support: 5 })]
        : [play(11, 'Canon close reworded')],
    );
    // Proposed 11 is ~identical to active 10.
    embedQueryVectors.mockResolvedValue([
      Float32Array.from([1, 0]), // active 10
      Float32Array.from([0.999, 0.0447]), // proposed 11
    ]);

    const summary = await consolidatePlays();

    expect(summary.bumped).toBe(1);
    expect(summary.exemplars).toBe(0); // no new proposed exemplar
    expect(summary.archived).toBe(1); // proposed dup archived
    const setFor10 = updateMany.mock.calls.find(
      ([a]) => a.data.status === undefined && a.where.play_id.in.includes(BigInt(10)),
    );
    expect(setFor10?.[0].data.support_count).toBe(6); // 5 + 1
  });

  it('no-ops when the embedder is unavailable', async () => {
    findMany.mockImplementation(async ({ where }: { where: { status: string } }) =>
      where.status === 'active' ? [] : [play(1, 'A')],
    );
    embedQueryVectors.mockResolvedValue(null);

    const summary = await consolidatePlays();
    expect(summary.skipped).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when there are no proposed plays', async () => {
    findMany.mockResolvedValue([]);
    const summary = await consolidatePlays();
    expect(summary.proposedIn).toBe(0);
    expect(embedQueryVectors).not.toHaveBeenCalled();
  });
});
