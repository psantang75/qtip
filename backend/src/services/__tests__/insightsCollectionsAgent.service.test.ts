/**
 * Unit tests for the Agent Performance read service.
 *
 * WHAT THIS FILE GUARDS. The report used to measure `ie_fact_collections_recovery` on a
 * CALENDAR scope with no invoice basis at all, so its leaderboard total could not be
 * reconciled against Cycle Performance — or against anything else. Four leaks, all in the
 * same direction:
 *
 *   1. Every campaign at once, including Check, Expiring CC and Sales AR, none of which
 *      has a failed charge behind it.
 *   2. Every currency at once, adding CAD to USD behind one "$".
 *   3. Ad-hoc, non-recurring invoices alongside the recurring run's own output.
 *   4. Payments DATED in the month — which both swept in cash against invoices that
 *      declined in an earlier cycle AND dropped this cycle's cash when it landed after
 *      month end.
 *
 * Every case below asserts a property that would have caught one of those. The pool is
 * mocked, so this runs without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const execute = vi.fn();

vi.mock('../../config/database', () => ({
  default: {
    query: (...args: unknown[]) => query(...args),
    execute: (...args: unknown[]) => execute(...args),
  },
}));

vi.mock('../../utils/periodUtils', () => ({
  resolvePeriod: () => ({
    current: { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31) },
  }),
}));

import { getAgentPerformance } from '../insightsCollectionsAgent.service';
import { __resetCampaignVocabulary } from '../insights/collections/campaignVocabulary';
import { CAMPAIGN_DIM_ROWS, isCampaignDimension } from './collectionsCampaignDimension';

const filters = { period: 'current_month' };
const DECLINED_KEYS = ['CC_1_15', 'CC_16_31', 'ACH_1_15', 'ACH_16_31'];

/** Which query is this? Matched on SQL content, never on call position. */
const isDeclinedBasis = (s: string) =>
  s.includes('AS `declined`') && s.includes('FROM ie_fact_collections_invoice i');
const isTaskOutcomes = (s: string) =>
  s.includes('FROM ie_fact_collections_task f') && s.includes('AS `recovered`');
const isSubsSplit = (s: string) => s.includes("WHEN 'REACTIVATED' THEN 1");
const isAgentSplit = (s: string) => s.includes("THEN 'post' ELSE 'pre' END AS phase");
const isProcessors = (s: string) => s.includes('GROUP BY x.processor, x.isAgent');
/** The leaderboard's cash leg. `baseMeta` reads the same fact for the name dropdowns. */
const isAgentCash = (s: string) =>
  s.includes('FROM ie_fact_collections_recovery f') && s.includes('AS `payments`');
const isAgentEffort = (s: string) => s.includes('AS `tasksWorked`');
const isCallEffort = (s: string) => s.includes('FROM ie_fact_collections_call f');
/** Every query that MEASURES the basis carries the invoice restriction. */
const isBasisRestricted = (s: string) =>
  isAgentSplit(s) || isProcessors(s) || isAgentCash(s) || isAgentEffort(s) || isCallEffort(s);

/**
 * Answer the pool by SQL kind. Anything unmatched returns no rows, which every measure
 * treats as zero, so a case only has to state the rows it cares about.
 */
function mockQueries(routes: Array<[(s: string) => boolean, unknown[]]> = []) {
  query.mockReset();
  execute.mockReset();
  execute.mockResolvedValue([[{ ok: 1 }]]); // every fact table exists
  // The vocabulary is cached for the process, so without this the first case in the file
  // would be the only one whose dimension rows are ever read.
  __resetCampaignVocabulary();
  query.mockImplementation((sql: unknown) => {
    const s = String(sql);
    for (const [match, rows] of routes) if (match(s)) return Promise.resolve([rows]);
    if (isCampaignDimension(s)) return Promise.resolve([CAMPAIGN_DIM_ROWS]);
    if (s.includes('ie_source_report')) {
      return Promise.resolve([[{ frequency_minutes: 60, lastRun: null, nextRun: null }]]);
    }
    return Promise.resolve([[]]);
  });
}

const sqlFor = (match: (s: string) => boolean) =>
  query.mock.calls.map((c) => String(c[0])).filter(match);
const paramsFor = (match: (s: string) => boolean) =>
  query.mock.calls.filter((c) => match(String(c[0]))).map((c) => c[1] as unknown[]);

const BASIS = [{
  invoices: 333, declined: 58604, collected: 50430,
  paid: 274, creditMemo: 52, open: 7, tasks: 332,
}];
const SPLIT = [
  { phase: 'pre', payments: 97, accounts: 93, amount: 20805 },
  { phase: 'post', payments: 185, accounts: 184, amount: 29625 },
];

beforeEach(() => mockQueries());

describe('getAgentPerformance — the population it measures', () => {
  it('restricts every measure to the declined basis, not to a calendar month', async () => {
    await getAgentPerformance(filters, 'Declined CC (1st)');

    const measures = sqlFor(isBasisRestricted);
    expect(measures.length).toBeGreaterThanOrEqual(4);
    for (const sql of measures) {
      // The basis is expressed ONCE, inside the restriction. Re-asserting the window on
      // the activity fact is what dropped cash that landed after month end — Cycle
      // Performance follows the cycle's invoices however long recovery takes.
      expect(sql).not.toMatch(/f\.date_key BETWEEN/);
      expect(sql).toMatch(/order_id IN|task_id IN/);
      expect(sql).toContain("db.first_result = 'DECLINED'");
      expect(sql).toContain('recurring_id IS NOT NULL');
    }
  });

  it('passes the selected campaign and currency into the basis predicate', async () => {
    await getAgentPerformance(filters, 'Declined ACH (16th)', 'CAD');

    for (const params of paramsFor(isBasisRestricted)) {
      expect(params).toContain('ACH_16_31');
      expect(params).toContain('CAD');
      // One campaign, so the aggregate's four-key IN-list must not also be bound.
      expect(params).not.toContain('CC_1_15');
    }
  });

  it('falls back to the aggregate for a campaign it cannot measure', async () => {
    // Check has no failed charge behind it, so filtering to it would report a declined
    // basis that does not exist rather than the one the reader asked about.
    const res = await getAgentPerformance(filters, 'Check');

    expect(res.selectedCampaign).toBe('All Declined');
    for (const params of paramsFor(isBasisRestricted)) {
      for (const key of DECLINED_KEYS) expect(params).toContain(key);
    }
  });

  it('offers only the declined-charge campaigns', async () => {
    const res = await getAgentPerformance(filters);
    expect(res.campaigns).toEqual([
      'All Declined',
      'Declined CC (1st)', 'Declined CC (16th)',
      'Declined ACH (1st)', 'Declined ACH (16th)',
    ]);
  });
});

describe('getAgentPerformance — reconciliation', () => {
  it('opens on Cycle Performance’s own figures and publishes the attribution gap', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentSplit, SPLIT],
      [isTaskOutcomes, [{ tasks: 332, recovered: 266, stillOpen: 35 }]],
      [isSubsSplit, [{ subs: 1219, reactivated: 15, terminated: 52, retained: 1152 }]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    expect(res.cohort?.atRisk).toBe(58604);
    expect(res.cohort?.invoices).toBe(333);
    expect(res.cohort?.tasks).toBe(332);
    expect(res.cohort?.subs).toBe(1219);
    // Collected is the INVOICE fact's, so the tile equals Collected to Date. It is never
    // the sum of the sections below it, which is what made the old page self-consistent
    // and wrong.
    expect(res.cohort?.collected).toBe(50430);
    expect(res.cohort?.dollarRate).toBe(86.1);
    // $20,805 + $29,625 — the split accounts for all of it, so there is no gap to report.
    expect(res.cohort?.attributed).toBe(50430);
    expect(res.cohort?.unattributed).toBe(0);
  });

  it('reports cash the recovery fact cannot place rather than hiding it', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentSplit, [{ phase: 'post', payments: 100, accounts: 99, amount: 40000 }]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    expect(res.cohort?.collected).toBe(50430);
    expect(res.cohort?.attributed).toBe(40000);
    expect(res.cohort?.unattributed).toBe(10430);
    // The rate stays on the invoice fact, so it still matches the validated report —
    // it does not fall to 68.3% just because attribution could only place $40,000.
    expect(res.cohort?.dollarRate).toBe(86.1);
  });

  it('splits on whether a touch preceded the cash, not on who keyed it', async () => {
    mockQueries([[isDeclinedBasis, BASIS], [isAgentSplit, SPLIT]]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    expect(res.split.preAgent).toEqual({ payments: 97, accounts: 93, amount: 20805 });
    expect(res.split.postAgent).toEqual({ payments: 185, accounts: 184, amount: 29625 });
    expect(sqlFor(isAgentSplit)[0]).toContain('ie_fact_collections_touch tc');
    expect(sqlFor(isAgentSplit)[0]).not.toContain('processor_kind');
  });
});

describe('getAgentPerformance — the leaderboard', () => {
  it('keeps an agent who worked the cycle but keyed no cash', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentCash, [
        { agent: 'Kiara Kelley', department: 'Collections', collected: 10389, payments: 23 },
      ]],
      [isAgentEffort, [
        { agent: 'Kiara Kelley', department: 'Collections', touches: 117, tasksWorked: 47 },
        { agent: 'Marc Joseph', department: 'Collections', touches: 31, tasksWorked: 25 },
      ]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    expect(res.rows.map((r) => r.agent)).toEqual(['Kiara Kelley', 'Marc Joseph']);
    // Effort without a close is a real result, and a recovery-anchored query cannot show
    // it — that agent has no row in the cash leg to be found by.
    expect(res.rows[1]).toMatchObject({ collected: 0, payments: 0, touches: 31, tasksWorked: 25 });
    expect(res.rows[0]).toMatchObject({ collected: 10389, payments: 23, touches: 117 });
  });

  it('credits the agent who keyed the payment, and ignores reversals', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentCash, [
        { agent: 'Brian Bettis', department: 'Collections', collected: 8479, payments: 27 },
      ]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    // `processor_kind` is the credit test: it names who TOOK the payment, which is what a
    // leaderboard is for. The separate question of whether the campaign had to intervene
    // is what the pre/post-agent split answers.
    expect(sqlFor(isAgentCash)[0]).toContain("f.processor_kind = 'AGENT'");
    expect(sqlFor(isAgentCash)[0]).toContain('f.is_reversed = 0');
    expect(res.rows[0]).toMatchObject({ collected: 8479, payments: 27 });
  });

  it('binds phone time to the basis tasks and splits it by who placed the call', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentCash, [
        { agent: 'Kiara Kelley', department: 'Collections', collected: 10389, payments: 23 },
      ]],
      [isCallEffort, [{
        agent: 'Kiara Kelley', department: 'Collections',
        outboundCalls: 131, inboundCalls: 16,
        outboundSecs: 12_000, inboundSecs: 2_820,
      }]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    // Reached through the task, never through a calendar window — this is the whole point
    // of the invoice → task → call chain, so it is asserted rather than assumed.
    expect(sqlFor(isCallEffort)[0]).toContain('f.task_id IN');
    expect(sqlFor(isCallEffort)[0]).not.toMatch(/f\.date_key BETWEEN/);

    expect(res.rows[0]).toMatchObject({
      outboundCalls: 131, outboundTalkMinutes: 200,
      inboundCalls: 16, inboundTalkMinutes: 47,
    });
    // The two legs sum to the total beside them, so a reader adding the columns lands on
    // the printed figure instead of a value a minute off it.
    expect(res.rows[0].talkMinutes).toBe(247);
    expect(res.rows[0].dollarsPerTalkHour).toBe(Math.round(10389 / (247 / 60)));
  });

  it('keeps an agent who only dialled, with no cash and no touches', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isCallEffort, [{
        agent: 'Jason Spangler', department: 'Support',
        outboundCalls: 15, inboundCalls: 0, outboundSecs: 3_360, inboundSecs: 0,
      }]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      agent: 'Jason Spangler', collected: 0, touches: 0, outboundCalls: 15, talkMinutes: 56,
    });
  });

  it('leaves $/talk hour at zero rather than dividing by no talk time', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isAgentCash, [
        { agent: 'Patricia Fuller', department: 'Collections', collected: 150, payments: 1 },
      ]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');
    expect(res.rows[0].dollarsPerTalkHour).toBe(0);
  });

  it('counts a dial that never connected as effort without inventing talk time', async () => {
    mockQueries([
      [isDeclinedBasis, BASIS],
      [isCallEffort, [{
        agent: 'Marc Joseph', department: 'Collections',
        outboundCalls: 9, inboundCalls: 0, outboundSecs: 0, inboundSecs: 0,
      }]],
    ]);

    const res = await getAgentPerformance(filters, 'Declined CC (1st)');
    expect(res.rows[0]).toMatchObject({ outboundCalls: 9, talkMinutes: 0, dollarsPerTalkHour: 0 });
  });
});
