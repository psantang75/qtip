/**
 * Range selection tests — specifically the round-robin cap. When a 90-day window
 * has more calls than the ceiling, the cut must be balanced across reps (so a
 * seed can't drop whoever the SQL happens to sort last) while each rep's calls
 * stay chronological.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }));

vi.mock('../../../../utils/databaseUtils', () => ({ executeQuery }));
vi.mock('../../PhoneSystemService', () => ({ default: {} }));
vi.mock('../../transcriptRender', () => ({ formatTranscriptContent: (s: string) => s }));

import { clampTranscript, selectCandidateCallsInRange } from '../candidates';

/** Build phone rows the SQL would return (ordered by agent, then start time). */
function rows(spec: Record<string, number>) {
  const out: Record<string, unknown>[] = [];
  for (const [agent, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) {
      out.push({
        conversation_id: `${agent}-${i}`,
        agent_name: agent,
        email: null,
        phone_user_id: null,
        started_at: new Date(`2026-06-${String(11 + i).padStart(2, '0')}T13:00:00Z`),
        direction: 'inbound',
        talk_secs: 300,
        remote_party: null,
        wrap_up_code: null,
      });
    }
  }
  return out;
}

const args = (maxCalls: number) => ({
  startDate: '2026-06-11',
  endDate: '2026-09-08',
  minTalkSecs: 100,
  roster: ['Alice', 'Bob', 'Cara'],
  maxCalls,
});

beforeEach(() => vi.clearAllMocks());

describe('clampTranscript', () => {
  // Truncation used to keep the head and drop the tail, which removed the close
  // of the call — the exact stretch the closing and next-step rules are graded
  // on. Those rules were then judged against a transcript missing their
  // evidence, which biases them straight toward false positives.
  const long = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

  it('leaves a transcript under the cap untouched', () => {
    expect(clampTranscript('short call', 100)).toBe('short call');
  });

  it('keeps the close of the call, not only the opening', () => {
    const text = long(400);
    const out = clampTranscript(text, 600);
    expect(out).toContain('line 0');
    expect(out).toContain('line 399');
  });

  it('marks the gap so the model does not read it as silence', () => {
    const out = clampTranscript(long(400), 600);
    expect(out).toContain('MIDDLE OF THIS TRANSCRIPT OMITTED');
  });

  it('drops from the middle rather than either end', () => {
    const out = clampTranscript(long(400), 600);
    expect(out).not.toContain('line 200');
  });
});

describe('selectCandidateCallsInRange — round-robin cap', () => {
  it('returns everything when under the cap', async () => {
    executeQuery.mockResolvedValue(rows({ Alice: 2, Bob: 1 }));
    const kept = await selectCandidateCallsInRange(args(100));
    expect(kept).toHaveLength(3);
  });

  it('balances the cut across reps rather than dropping whoever sorts last', async () => {
    executeQuery.mockResolvedValue(rows({ Alice: 5, Bob: 3, Cara: 1 }));
    const kept = await selectCandidateCallsInRange(args(6));
    expect(kept).toHaveLength(6);
    const perRep = kept.reduce<Record<string, number>>((m, c) => {
      m[c.agentName] = (m[c.agentName] ?? 0) + 1;
      return m;
    }, {});
    // 6 across 3 reps, one-per-pass: Alice 3, Bob 2, Cara 1 — never 5 Alices + 1 Bob.
    expect(perRep).toEqual({ Alice: 3, Bob: 2, Cara: 1 });
  });

  it('keeps each rep\'s calls in chronological order', async () => {
    executeQuery.mockResolvedValue(rows({ Alice: 3, Bob: 3 }));
    const kept = await selectCandidateCallsInRange(args(4));
    const alice = kept.filter((c) => c.agentName === 'Alice').map((c) => c.conversationId);
    expect(alice).toEqual(['Alice-0', 'Alice-1']);
  });

  it('returns nothing for an empty roster', async () => {
    const kept = await selectCandidateCallsInRange({ ...args(10), roster: [] });
    expect(kept).toHaveLength(0);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
