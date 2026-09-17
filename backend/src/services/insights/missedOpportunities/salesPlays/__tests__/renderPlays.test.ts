/**
 * The reviewer grounding block must stay bounded: at most PROMPT_MAX_PER_CATEGORY
 * plays per category, ranked by support_count, with a cue for how many of our
 * own calls each play was observed on.
 *
 * The cue says OBSERVED, not proven. Support counts how often a tactic recurred
 * on calls with a known outcome; it is not evidence the tactic caused the sale,
 * and "proven" invited the reviewer to recommend it as though it were.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../../../config/prisma', () => ({ default: { ieSalesPlay: { findMany } } }));

import { renderPlaysForPrompt, PROMPT_MAX_PER_CATEGORY } from '../plays.service';

function activePlay(id: number, category: string, support: number | null) {
  return {
    play_id: BigInt(id),
    category,
    title: `${category} play ${id}`,
    body_md: 'do the thing',
    evidence_quote: null,
    evidence_speaker: null,
    source_outcome: 'WON',
    source_conversation_id: null,
    source_agent_name: null,
    est_value_note: null,
    status: 'active',
    sort_order: 100,
    support_count: support,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('renderPlaysForPrompt', () => {
  it('caps each category to the top-N and shows the observed-on cue', async () => {
    // 10 closing plays (support 10..1), pre-sorted as the DB would return them.
    const closing = Array.from({ length: 10 }, (_, i) => activePlay(i + 1, 'closing', 10 - i));
    const discovery = [activePlay(100, 'discovery', 3), activePlay(101, 'discovery', null)];
    findMany.mockResolvedValue([...closing, ...discovery]);

    const out = await renderPlaysForPrompt();
    const closingLines = out.split('\n').filter((l) => l.includes('[closing]'));
    const discoveryLines = out.split('\n').filter((l) => l.includes('[discovery]'));

    expect(closingLines).toHaveLength(PROMPT_MAX_PER_CATEGORY);
    expect(discoveryLines).toHaveLength(2);
    // Best-supported kept, least-supported dropped.
    expect(out).toContain('observed on 10 won calls');
    expect(out).not.toContain('closing play 10'); // support 1 → dropped past the cap
    // Single-call plays get no cue.
    expect(out).not.toContain('observed on 1 won calls');
    // And the header must not claim these are proven winners.
    expect(out).not.toMatch(/proven|winning/i);
  });

  it('returns empty string when there are no active plays', async () => {
    findMany.mockResolvedValue([]);
    expect(await renderPlaysForPrompt()).toBe('');
  });
});
