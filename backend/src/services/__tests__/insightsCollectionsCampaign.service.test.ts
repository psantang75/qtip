/**
 * Unit tests for the Campaign × Touch read service.
 *
 * Every case here is a number the report actually published. For August 2026 it
 * reported a 589.5% recovery rate on the aggregate and 205.2% on Declined CC (1st),
 * because the numerator and the denominator were assembled independently:
 *
 *   1. The aggregate summed recovery across ALL SEVEN campaigns while scoring it
 *      against a pool covering the four recurring runs — $357,583 of the $478,650
 *      numerator came from Check, Sales AR and Expiring CC, which the denominator
 *      excludes by design.
 *   2. Selecting a campaign with no failed charge borrowed the recurring runs' pool:
 *      Check reported $81,199 of "declined dollars" against a run it never has.
 *   3. Even scoped to one campaign the numerator counted debt the pool excludes. One
 *      refused submission (billing group 112016, $53,540.93) was carved out of at-risk
 *      as an ERROR but kept as recovery, and was 54% of that campaign's collection.
 *   4. `MAX(phase)` named each rung, and TERM sorts last, so 7 of 9 rungs rendered as
 *      terminations — red bars across a chart that was mostly ordinary outreach.
 *
 * The pool is mocked, so this runs without a database.
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

import { getCampaignTouch } from '../insightsCollectionsCampaign.service';
import { campaignLabel, loadCampaignVocabulary } from '../insightsCollections.shared';
import { __resetCampaignVocabulary } from '../insights/collections/campaignVocabulary';
import { CAMPAIGN_DIM_ROWS, isCampaignDimension } from './collectionsCampaignDimension';

const filters = { period: 'current_month' };
const LADDER_KEYS = ['CC_1_15', 'CC_16_31', 'ACH_1_15', 'ACH_16_31'];

/** Which query is this? Matched on SQL content, never on call position. */
const isEffort = (s: string) => s.includes('termTouches') && !s.includes(', agent');
const isRungMoney = (s: string) => s.includes('attributed_touch_seq IS NOT NULL') && !s.includes(', agent');
const isNoTouch = (s: string) => s.includes('attributed_touch_seq IS NULL');
/**
 * The declined basis — Cycle Performance's own population, and the only source the
 * Starting Point tiles are allowed to read. It carries the dollars AND the invoice
 * split, because they describe the same rows; they used to be two queries over two
 * different populations, which is exactly the defect this file now guards.
 */
const isDeclinedBasis = (s: string) =>
  s.includes('AS `declined`') && s.includes('FROM ie_fact_collections_invoice i');
const isTaskOutcomes = (s: string) =>
  s.includes('FROM ie_fact_collections_task f') && s.includes('AS `recovered`');
/** The task-anchored split, reached only by a campaign with no recurring run. */
const isNonRunInvoiceSplit = (s: string) =>
  s.includes('creditMemo') && s.includes('FROM ie_fact_collections_invoice ci');
const isSubsSplit = (s: string) => s.includes("WHEN 'REACTIVATED' THEN 1");
const isRungSubs = (s: string) =>
  s.includes('COUNT(DISTINCT sub.service_id)') && s.includes('attributed_touch_seq');
const isMemoWrittenOff = (s: string) =>
  s.includes('credit_memo_amount > 0') && s.includes('COUNT(DISTINCT ci.task_id) AS `tasks`');
const isMemoWorkedAfter = (s: string) => s.includes('tc.created_on > ci.credit_memo_on');
/**
 * The two reads over reactivation invoices share one subquery — reached through the
 * service that returned — and differ only by whether they place it on a rung.
 */
const isReactivationRungs = (s: string) =>
  s.includes('sb.successor_order_id') && s.includes('GROUP BY z.seq');
/** Win-back SERVICES, placed at the termination that lost them. */
const isReactivationSubs = (s: string) =>
  s.includes("s.outcome = 'REACTIVATED'") && s.includes('s.term_recorded_on');
const isMemoReactivation = (s: string) =>
  s.includes('sb.successor_order_id') && !s.includes('GROUP BY z.seq');
/**
 * Recovery reads that MEASURE — identified by the cohort join every measure carries.
 * The filter dropdowns read the same fact for the list of agent and department names,
 * and a name list is not scored against a pool.
 */
const isRecovery = (s: string) =>
  s.includes('FROM ie_fact_collections_recovery f') && onTaskCohort(s);
const onTaskCohort = (s: string) => s.includes('ie_fact_collections_task tk');

/**
 * Answer the pool by SQL kind. Anything unmatched returns no rows, which every
 * measure treats as zero, so a case only has to state the rows it cares about.
 */
function mockQueries(routes: Array<[(s: string) => boolean, unknown[]]> = []) {
  query.mockReset();
  execute.mockReset();
  // The vocabulary is cached for the process, so without this the first case in the file
  // would be the only one whose dimension rows are ever read.
  __resetCampaignVocabulary();
  execute.mockResolvedValue([[{ ok: 1 }]]); // every fact table exists
  query.mockImplementation((sql: unknown) => {
    const s = String(sql);
    for (const [match, rows] of routes) if (match(s)) return Promise.resolve([rows]);
    if (isCampaignDimension(s)) return Promise.resolve([CAMPAIGN_DIM_ROWS]);
    if (s.includes('ie_source_report')) {
      return Promise.resolve([[{ frequency_minutes: 60, lastRun: null, nextRun: null }]]);
    }
    if (s.includes('DISTINCT campaign_key')) {
      return Promise.resolve([[{ k: 'CC_1_15' }, { k: 'CHECK' }, { k: 'EXP_CC' }]]);
    }
    return Promise.resolve([[]]);
  });
}

const sqlFor = (match: (s: string) => boolean) =>
  query.mock.calls.map((c) => String(c[0])).filter(match);
const paramsFor = (match: (s: string) => boolean) =>
  query.mock.calls.filter((c) => match(String(c[0]))).map((c) => c[1] as unknown[]);

beforeEach(() => mockQueries());

describe('getCampaignTouch — the aggregate covers only what the pool covers', () => {
  it('bounds every cohort read to the four call-ladder campaigns', async () => {
    await getCampaignTouch(filters);

    const cohortReads = sqlFor(onTaskCohort);
    expect(cohortReads.length).toBeGreaterThan(0);
    for (const sql of cohortReads) {
      expect(sql).toContain('tk.campaign_key IN (?,?,?,?)');
    }
    // Check, Sales AR and Expiring CC contributed three quarters of August's numerator
    // against a denominator that excludes all three.
    for (const params of paramsFor(onTaskCohort)) {
      expect(params).toEqual(expect.arrayContaining(LADDER_KEYS));
    }
  });

  it('bounds the task denominator too, so tasks and dollars count one population', async () => {
    await getCampaignTouch(filters);

    // The tasks are named BY THE INVOICE now — a task is in scope because it chases a
    // declined invoice, not because it was raised in the window. That is 332 tasks for
    // Declined CC (1st) September against the 395 the task-anchored scope returned, and
    // the extra 63 were chasing debt the run never declined.
    const [sql] = sqlFor(isTaskOutcomes);
    expect(sql).toContain('f.task_id IN (');
    expect(sql).toContain('bt.campaign_key IN (?,?,?,?)');
    expect(paramsFor(isTaskOutcomes)[0]).toEqual(expect.arrayContaining(LADDER_KEYS));
  });

  it('offers the aggregate as All Declined, not All Campaigns', async () => {
    const res = await getCampaignTouch(filters);
    expect(res.campaigns[0]).toBe('All Declined');
    expect(res.selectedCampaign).toBe('All Declined');
  });
});

describe('getCampaignTouch — recovery is measured against the pool it is scored on', () => {
  it('restricts every recovery read to the invoices the pool declined on', async () => {
    await getCampaignTouch(filters);

    const reads = sqlFor(isRecovery);
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) {
      // Joined on order_id, never on billing group: a customer who declines on one
      // card and pays with another writes a payment under the PAYING group.
      expect(sql).toContain('f.order_id IN (');
      expect(sql).toContain('ie_fact_collections_billing');
      expect(sql).not.toContain('f.billing_group_id IN (');
    }
  });

  it('excludes reversed payments, as Cycle Performance does', async () => {
    await getCampaignTouch(filters);
    for (const sql of sqlFor(isRecovery)) expect(sql).toContain('f.is_reversed = 0');
  });

  it('counts only the run\'s own invoices, in the reported currency', async () => {
    await getCampaignTouch(filters);

    // The gateway attempt log knows no order type, so without this the pool admitted
    // ad-hoc invoices that merely declined under a ladder campaign key — $3,238.94 of
    // July 2026's "recovery" was mid-month one-offs, order 1912395 alone being
    // $2,591.04 raised on the 13th. `recurring_id IS NULL` is exactly "not a recurring
    // order", so requiring it is Cycle Performance's own spine.
    const reads = sqlFor(isRecovery);
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) {
      expect(sql).toContain('bo.recurring_id IS NOT NULL');
      // Recovery carries no currency of its own, so CAD was being summed into a figure
      // rendered with a "$". The test rides the invoice fact because that is the only
      // place the currency is recorded.
      expect(sql).toContain('bo.currency_code = ?');
    }
    for (const params of paramsFor(isRecovery)) expect(params).toContain('USD');
  });

  it('honours a caller-selected currency rather than pinning USD', async () => {
    await getCampaignTouch(filters, 'All Declined', 'CAD');
    for (const params of paramsFor(isRecovery)) expect(params).toContain('CAD');
  });

  it('never applies the run test to a campaign with no declined run', async () => {
    // Sales AR and Expiring CC hold ZERO recurring invoices, so requiring a run id
    // would not tighten them, it would erase them. The whole gate — pool and run test
    // together — must stay absent for a campaign the pool does not cover.
    //
    // Decoded from the vocabulary rather than spelled out, because the label IS the wire
    // value: the service resolves it back to a key, and a label this test does not
    // recognise resolves to undefined and silently widens the scope to "all" instead of
    // failing. Hardcoding the string let this test go on passing against the wrong
    // population the moment the label was corrected.
    await loadCampaignVocabulary();
    await getCampaignTouch(filters, campaignLabel('EXP_CC'));

    for (const sql of sqlFor(isRecovery)) {
      expect(sql).not.toContain('bo.recurring_id IS NOT NULL');
      expect(sql).not.toContain('f.order_id IN (');
    }
  });

  it('carves the refused submission out of BOTH halves, not just at-risk', async () => {
    await getCampaignTouch(filters);

    // Billing group 112016's $53,540.93 was a submission the GATEWAY refused — an ERROR,
    // never a decline. It was excluded from at-risk and kept as recovery, and was 54% of
    // Declined CC (1st)'s reported August collection.
    //
    // The basis requires the invoice to carry an actual DECLINED billing row, so an
    // ERROR-only invoice is absent from the denominator and the numerator by the same
    // test rather than by two rules that have to be kept in step.
    const [basis] = sqlFor(isDeclinedBasis);
    expect(basis).toContain("db.first_result = 'DECLINED'");
    for (const sql of sqlFor(isRecovery)) expect(sql).toContain("db.first_result = 'DECLINED'");
  });

  it('reports collected from the invoices, and says what the rungs could not claim', async () => {
    mockQueries([
      [isDeclinedBasis, [{
        invoices: 333, declined: 58604, collected: 50430, paid: 279, creditMemo: 52, open: 2,
        tasks: 332,
      }]],
      [isRungMoney, [
        { seq: 1, payments: 5, dollars: 15782.4, tasksRecovered: 5 },
        { seq: 2, payments: 3, dollars: 7721.6, tasksRecovered: 3 },
      ]],
      [isNoTouch, [{ payments: 4, dollars: 13035.3, tasksRecovered: 4 }]],
    ]);

    const res = await getCampaignTouch(filters);
    const rungs = res.touches.reduce((a, t) => a + t.incrementalDollars, 0);
    const c = res.cohort!;

    // The headline is the INVOICE fact's, so it equals Cycle Performance's Collected to
    // Date. Summing the rungs instead made the tile agree with the bars below it but not
    // with the validated report, which is the comparison that matters.
    expect(c.collected).toBe(50430);
    expect(c.ladderCollected).toBe(rungs + c.noTouch.dollars);
    // Surfaced, not reconciled away: cash on a cohort invoice that no touch precedes.
    expect(c.unattributed).toBe(c.collected - c.ladderCollected);
  });

  it('partitions the cohort invoices into paid, credit-memoed and open', async () => {
    mockQueries([
      [isDeclinedBasis, [{
        invoices: 333, declined: 58604, collected: 50430, paid: 279, creditMemo: 52, open: 2,
        tasks: 332,
      }]],
    ]);

    const c = (await getCampaignTouch(filters)).cohort!;
    expect(c.invoices).toBe(333);
    expect(c.invoicesPaid).toBe(279);
    expect(c.invoicesCreditMemo).toBe(52);
    expect(c.invoicesOpen).toBe(2);
    // The tile prints these three under the invoice count, so a gap between them
    // would read as invoices that simply vanished.
    expect(c.invoicesPaid + c.invoicesCreditMemo + c.invoicesOpen).toBe(c.invoices);
  });

  it('counts invoices and dollars off the SAME rows, not two populations', async () => {
    await getCampaignTouch(filters);

    // The tiles disagreed because they came from different places: dollars from the
    // gateway log at billing-group grain ($65,054 across 358 ACCOUNTS), counts from the
    // task fact (377 invoices, $114,805 invoiced — nearly double the declined amount).
    // One query now answers both, so they cannot drift apart again.
    const reads = sqlFor(isDeclinedBasis);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('AS `invoices`');
    expect(reads[0]).toContain('AS `declined`');
    expect(reads[0]).toContain('AS `collected`');
    expect(reads[0]).toContain('AS `tasks`');
  });

  it('settles a part-paid, part-memoed invoice as paid, as Cycle Performance does', async () => {
    await getCampaignTouch(filters);
    const [sql] = sqlFor(isDeclinedBasis);
    // Cash is tested first and the memo arm excludes it, so the two reports cannot
    // disagree about an invoice that carries both.
    expect(sql).toContain('i.cash_collected > 0');
    expect(sql).toContain('i.cash_collected = 0 AND i.credit_memo_amount > 0');
  });

  it('closes the cumulative curve on the cohort total, so it ties to Cycle Performance', async () => {
    mockQueries([
      [isDeclinedBasis, [{
        invoices: 288, declined: 36393, collected: 7797, paid: 73, creditMemo: 5, open: 210,
        tasks: 288,
      }]],
      [isRungMoney, [{ seq: 1, payments: 15, dollars: 1953.83, tasksRecovered: 15 }]],
      [isNoTouch, [{ payments: 58, dollars: 5842.67, tasksRecovered: 55 }]],
    ]);

    // 2026-09 Declined CC (16th). The ladder used to start at zero and close at
    // $1,954 while the headline reported $7,797, so the page contradicted itself and
    // Cycle Performance's Collected to Date. The curve opens on the no-touch baseline
    // now, so its last point IS the cohort's cash.
    const res = await getCampaignTouch(filters);
    const last = res.touches[res.touches.length - 1];
    expect(res.cohort!.noTouch.dollars).toBe(5843);
    expect(last.cumulativeDollars).toBe(7797);
    expect(last.cumulativeDollars).toBe(res.cohort!.collected);
    // Every dollar on these invoices reached a rung, so there is nothing unexplained.
    expect(res.cohort!.unattributed).toBe(0);
  });

  it('rates the cash against the invoices that produced it', async () => {
    mockQueries([
      [isDeclinedBasis, [{
        invoices: 333, declined: 58604, collected: 50430, paid: 279, creditMemo: 52, open: 2,
        tasks: 332,
      }]],
      [isRungMoney, [{ seq: 1, payments: 5, dollars: 24747, tasksRecovered: 5 }]],
      [isNoTouch, [{ payments: 4, dollars: 13035, tasksRecovered: 4 }]],
    ]);

    // Declined CC (1st), September 2026. The page published 77.6% — $50,455 over a
    // $65,054 gateway pool. Cycle Performance measures the same campaign at $50,430 over
    // $58,604 declined, which is 86.1%, and both halves now come from those invoices.
    const res = await getCampaignTouch(filters);
    expect(res.cohort!.atRisk).toBe(58604);
    expect(res.cohort!.collected).toBe(50430);
    expect(res.cohort!.dollarRate).toBe(86.1);
    // The defect this whole change exists to remove.
    expect(res.cohort!.dollarRate).toBeLessThan(100);
  });
});

describe('getCampaignTouch — a campaign with no failed charge', () => {
  it('reports no at-risk and no rate rather than borrowing the runs pool', async () => {
    mockQueries();

    const res = await getCampaignTouch(filters, 'Check');

    expect(res.hasCallLadder).toBe(false);
    expect(res.cohort!.atRisk).toBeNull();
    expect(res.cohort!.dollarRate).toBeNull();
    // Check chases an invoice we never charged, so it holds no declined run output at
    // all. Reading the basis for it would return nothing and erase the page; the
    // task-anchored path is used instead, and no rate is drawn.
    expect(sqlFor(isDeclinedBasis)).toHaveLength(0);
    expect(sqlFor(isNonRunInvoiceSplit)).toHaveLength(1);
  });

  it('still counts its cash, because every payment on it is genuine recovery', async () => {
    mockQueries([[isNonRunInvoiceSplit, [{
      invoices: 412, paid: 354, creditMemo: 8, open: 50,
      collected: 289848, tasksWithInvoice: 400,
    }]]]);

    const res = await getCampaignTouch(filters, 'Check');

    expect(res.cohort!.collected).toBe(289848);
    // No declined run means no invoice restriction to apply — it would zero a real number.
    for (const sql of sqlFor(isRecovery)) expect(sql).not.toContain('f.order_id IN (');
  });
});

describe('getCampaignTouch — a rung is named for what its touches were', () => {
  it('does not call a rung a termination because one touch on it was', async () => {
    mockQueries([[isEffort, [
      { seq: 1, touchesMade: 100, termTouches: 1, finalTouches: 0, tasksReached: 80, customers: 75 },
      { seq: 2, touchesMade: 10, termTouches: 9, finalTouches: 0, tasksReached: 10, customers: 10 },
      { seq: 3, touchesMade: 10, termTouches: 0, finalTouches: 8, tasksReached: 10, customers: 10 },
    ]]]);

    const res = await getCampaignTouch(filters);

    expect(res.touches.map((t) => [t.touchSeq, t.isTerm, t.label])).toEqual([
      [1, false, 'Touch 1'],
      [2, true, 'Touch 2'],
      [3, true, 'Final Call'],
    ]);
    // MAX(phase) returns TERM whenever a single TERM touch is present, because it
    // sorts after OUTREACH — which is how 7 of 9 rungs came back flagged.
    expect(sqlFor(isEffort)[0]).not.toContain('MAX(f.phase)');
  });
});

/**
 * Declined CC (1st), September 2026 reported 1,219 subscriptions behind 377 invoices.
 * The count was scoped only by billing group, and a billing group is a card rather than
 * an account: one carried 170 services, the next 122, then 100. Every service those
 * groups had ever held was counted, most of it history the cycle never billed.
 */
describe('getCampaignTouch — subscriptions are the cohort\'s, not the billing group\'s history', () => {
  it('counts the services those invoices billed, keyed on the invoice itself', async () => {
    mockQueries();

    await getCampaignTouch(filters);

    const sql = sqlFor(isSubsSplit)[0];
    // The billing group is a card, not an account. Keying on it reported 961 services
    // for Declined CC (1st) September of which only 594 were on those invoices, while
    // missing 729 that were; keying on order_id returns CRM's own 1,323.
    expect(sql).toContain('s.order_id IN (');
    expect(sql).not.toContain('s.billing_group_id IN (');
  });

  it('resolves a service holding two outcomes to one, so the split sums to the total', async () => {
    mockQueries([[isSubsSplit, [
      { subs: 959, retained: 832, terminated: 94, reactivated: 33 },
    ]]]);

    const res = await getCampaignTouch(filters);

    const c = res.cohort!;
    expect(c.subs).toBe(959);
    // 836 + 69 + 33 + 25 raw rows describe 963 states across 959 services. Printing the
    // buckets unranked under a total of 959 shows a breakdown that overshoots its own
    // headline — the ranking is what makes the three reconcile.
    expect(c.subsRetained + c.subsTerminated + c.subsReactivated).toBe(c.subs);
  });
});

describe('getCampaignTouch — the ladder subscription column partitions', () => {
  it('counts subscriptions recovered at a rung, not every one worked there', async () => {
    mockQueries([[isRungSubs, [{ seq: 2, subs: 40 }]]]);

    const res = await getCampaignTouch(filters);

    expect(res.touches.find((t) => t.touchSeq === 2)!.subs).toBe(40);
    const sql = sqlFor(isRungSubs)[0];
    // Read from the touch fact, a subscription worked at rungs 1, 2 and 3 landed in all
    // three, so the column could never foot against the tile above it. Recovery carries
    // exactly one attributed rung.
    expect(sql).toContain('FROM ie_fact_collections_recovery f');
    expect(sql).not.toContain('FROM ie_fact_collections_touch f');
  });

  it('counts the untouched bucket too, so the first bar is not blank', async () => {
    mockQueries([
      [isNoTouch, [{ payments: 58, dollars: 5843, tasksRecovered: 55 }]],
      [isRungSubs, [{ seq: null, subs: 413 }, { seq: 1, subs: 296 }]],
    ]);

    const res = await getCampaignTouch(filters);

    // The query filtered `attributed_touch_seq > 0` BEFORE counting services, so the
    // no-touch bar reported real recovered cash beside an empty subscription count —
    // September's baseline holds 413 of them. Every other measure on the chart opens on
    // this bucket, and subscriptions were the one that silently did not.
    expect(res.cohort!.noTouch.subsRecovered).toBe(413);
    expect(res.touches.find((t) => t.touchSeq === 1)!.subs).toBe(296);
  });
});

/**
 * The page ended at the credit memo, as though the work did too. Across 2025-06..2026-09
 * the four runs memoed $333,269.79 and kept working 79% of those tasks afterwards, taking
 * real cash back on reactivation invoices — none of it reported anywhere.
 */
describe('getCampaignTouch — recovery after a write-off', () => {
  it('reports the effort and the cash that followed the memo', async () => {
    mockQueries([
      [isMemoWrittenOff, [{ invoices: 59, dollars: 9324, tasks: 59 }]],
      [isMemoWorkedAfter, [{ touches: 96, tasksWorked: 51 }]],
      [isMemoReactivation, [{ invoices: 7, cash: 812 }]],
    ]);

    const res = await getCampaignTouch(filters);

    expect(res.postMemo).toEqual({
      invoices: 59, dollars: 9324, tasks: 59,
      tasksWorkedAfter: 51, touchesAfter: 96,
      reactivationInvoices: 7, reactivationCash: 812,
    });
  });

  it('places win-backs on their own series, never inside the save figure', async () => {
    mockQueries([
      [isDeclinedBasis, [{
        invoices: 10, declined: 10000, collected: 1200, paid: 5, creditMemo: 3, open: 2,
        tasks: 10,
      }]],
      [isRungMoney, [{ seq: 1, payments: 5, dollars: 1000, tasksRecovered: 5 }]],
      [isNoTouch, [{ payments: 2, dollars: 200, tasksRecovered: 2 }]],
      [isReactivationRungs, [
        { seq: 1, invoices: 2, dollars: 500 },
        { seq: null, invoices: 1, dollars: 100 },
      ]],
      [isReactivationSubs, [{ seq: 1, subs: 4 }]],
    ]);

    const res = await getCampaignTouch(filters);
    const r1 = res.touches.find((t) => t.touchSeq === 1)!;

    expect(r1.incrementalDollars).toBe(1000);
    expect(r1.reactivationDollars).toBe(500);
    // Counted off the cohort's own subscriptions, so the column sums to the Starting
    // Point tile. The reactivation INVOICE cannot supply them: September holds 15
    // reactivated services behind 7 such invoices, because one replacement commonly
    // stands in for several shut-off services.
    expect(r1.reactivationSubs).toBe(4);
    // A win-back with no preceding touch opens the curve, exactly as untouched cash does.
    expect(res.cohort!.noTouch.reactivationDollars).toBe(100);
    expect(r1.cumulativeReactivationDollars).toBe(600);
    // THE SAVE CURVE MUST NOT ABSORB IT. The memoed invoice stays at zero forever, so
    // this money is invisible to Cycle Performance's Collected to Date — adding it would
    // break the tie the rest of this file exists to protect, and would credit the
    // campaign twice for a service it lost before winning back.
    expect(r1.cumulativeDollars).toBe(1200);
    expect(res.cohort!.collected).toBe(1200);
  });

  it('does not look for win-backs on a campaign that has nothing to memo', async () => {
    mockQueries();
    await getCampaignTouch(filters, 'Check');
    expect(sqlFor(isReactivationRungs)).toHaveLength(0);
  });

  it('excludes memos that carried cash, which the invoice split already calls paid', async () => {
    mockQueries();

    await getCampaignTouch(filters);

    // Counting a part-paid, part-memoed invoice here would claim recovery against an
    // invoice the Starting Point tile has already reported as collected.
    expect(sqlFor(isMemoWrittenOff)[0]).toContain('ci.cash_collected = 0');
  });

  it('reaches win-back cash through the service that returned, not the billing group', async () => {
    mockQueries();

    await getCampaignTouch(filters);

    const sql = sqlFor(isMemoReactivation)[0];
    // A reactivation is normally paid by a NEW card, so the replacement sits on a
    // DIFFERENT billing group from the invoice written off. On the 60 declined and memoed
    // September CC invoices the group match found 3 invoices and $605.71 where the
    // service link finds 7 and $3,202.80.
    expect(sql).toContain('ni.order_id = sb.successor_order_id');
    expect(sql).not.toContain('ni.billing_group_id = ci.billing_group_id');
    // Type 3 is the recurring run's own output — counting it would report ordinary
    // renewal billing as recovery and break the tie to Cycle Performance.
    expect(sql).toContain('ni.order_type_id IN (1, 6)');
    // Anchored on the shut-off, not the memo posting: `> credit_memo_on` discarded every
    // same-day comeback, 2 invoices and $1,197.29 of that $3,202.80.
    expect(sql).toContain('ni.order_date >= DATE(sb.term_recorded_on)');
    expect(sql).not.toContain('ni.order_date > DATE(ci.credit_memo_on)');
    // One replacement invoice can be reached by every service it brought back, so cash is
    // aggregated per successor invoice rather than over the join.
    expect(sql).toContain('GROUP BY ni.order_id');
  });
});

describe('getCampaignTouch — measures are not substituted for one another', () => {
  it('reports zero subscriptions rather than passing off the task count', async () => {
    mockQueries([[isEffort, [
      { seq: 1, touchesMade: 100, termTouches: 0, finalTouches: 0, tasksReached: 50, customers: 45 },
    ]]]);

    const res = await getCampaignTouch(filters);

    expect(res.touches[0].tasksReached).toBe(50);
    expect(res.touches[0].subs).toBe(0);
  });
});
