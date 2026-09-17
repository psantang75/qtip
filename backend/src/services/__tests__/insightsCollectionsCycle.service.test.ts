/**
 * Unit tests for the Cycle Performance read service.
 *
 * These guard the joins the whole report rests on, each of which has produced a
 * wrong number in this codebase already:
 *
 *   1. The spine is the RUN (`recurring_id`), not the billing group's current
 *      payment method. bg.PMType drifts after the fact — on 2026-08-01 it put 75
 *      invoices from the check run and 5 from the ACH run into Declined CC (1st).
 *   2. Decline -> invoice joins on `order_id` (the gateway's PaymentOrderId), NEVER
 *      on billing group. Recurring charges the site's group while the invoice header
 *      is rewritten by whoever later paid, so a billing-group join reports invoices
 *      that plainly exist as missing (invoice 1923909).
 *   3. ONE billing row per invoice. The billing fact is billing-group grain, so an
 *      invoice charged on two groups the same day fans out — that pushed the
 *      2026-08-01 outcome totals to 7,950 against a spine of 7,942.
 *   4. The billing row is pinned to the invoice's OWN date_key, so `first_result` is
 *      what the RUN did. An agent re-keying a card three days later is recovery.
 *   5. Task activity is scoped to the invoice's own pass, by customer.
 *
 * The pool is mocked, so this runs without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();

vi.mock('../../config/database', () => ({
  default: { query: (...args: unknown[]) => query(...args) },
}));

vi.mock('../../utils/periodUtils', () => ({
  resolvePeriod: () => ({
    current: { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31) },
  }),
}));

import {
  getCyclePerformance, getCycleInvoices, getFailedChargeInvoices,
} from '../insightsCollectionsCycle.service';
import { clearCycleCache } from '../insights/collections/cycle/cache';
import { __resetCampaignVocabulary } from '../insights/collections/campaignVocabulary';
import { CAMPAIGN_DIM_ROWS, isCampaignDimension } from './collectionsCampaignDimension';

const filters = { period: 'current_month' };

const DEFAULT_FRESHNESS = [
  {
    report_code: 'collections_invoice', last_run_at: '2026-09-13T06:00:00Z',
    next_run_at: '2026-09-14T06:00:00Z', last_status: 'SUCCESS', is_active: 1,
    frequency_minutes: 60,
  },
];

/**
 * Answer the pool BY SQL KIND, not by call position.
 *
 * The measures are still served from `sequence` in order, because that order is the
 * thing several cases assert. The pipeline-freshness read is served from the registry
 * fixture wherever it happens to run — it moved to the front of the request when the
 * response cache started keying on the last pipeline run, and a positional chain made
 * that reordering look like 71 unrelated assertion failures.
 */
function respond(sequence: unknown[][], freshnessRows?: unknown[]) {
  query.mockReset();
  // The vocabulary is cached for the process, so without this the first case in the file
  // would be the only one whose dimension rows are ever read.
  __resetCampaignVocabulary();
  let next = 0;
  query.mockImplementation((sql: unknown) => {
    const text = String(sql);
    if (text.includes('ie_source_report')) return Promise.resolve([freshnessRows ?? DEFAULT_FRESHNESS]);
    if (text.includes('ie_ingestion_lock')) return Promise.resolve([[]]);
    // Answered ahead of the positional sequence, like freshness above: the campaign
    // vocabulary is read per request, and letting it consume a slot would shift every
    // index the assertions below depend on.
    if (isCampaignDimension(text)) return Promise.resolve([CAMPAIGN_DIM_ROWS]);
    return Promise.resolve(sequence[next++] ?? [[]]);
  });
}

/**
 * getCyclePerformance fires its stage queries through Promise.all, so they resolve
 * in call order. Each mock returns the shape that stage maps over. New stages are
 * appended, so the indices sqlOf() asserts on stay stable.
 */
function mockSummary(over: Partial<{
  outcomes: unknown[]; reasons: unknown[]; coverage: unknown[];
  statuses: unknown[]; bands: unknown[]; paths: unknown[]; memo: unknown;
  processors: unknown[]; currencies: unknown[]; freshness: unknown[];
}> = {}) {
  respond([
    [over.outcomes ?? [
      { result: 'OK', invoices: 7620, amount: 725944 },
      { result: 'DECLINED', invoices: 270, amount: 45063 },
      { result: 'ERROR', invoices: 4, amount: 54182 },
      { result: 'NO_CHARGE', invoices: 48, amount: 6385 },
    ]],
    [over.reasons ?? [
      { reason: 'Insufficient Funds', invoices: 119, amount: 9900, repeat_invoices: 61, repeat_amount: 5943 },
      { reason: 'Expired Card', invoices: 7, amount: 719, repeat_invoices: 0, repeat_amount: 0 },
    ]],
    [over.coverage ?? [
      { bucket: 'New Task Created', invoices: 270, amount: 45063, collected: 37782 },
    ]],
    [over.statuses ?? [
      {
        status: 'Paid', invoices: 228, amount: 38000, collected: 37557,
        self_invoices: 120, self_collected: 20000,
        agent_invoices: 85, agent_collected: 17557,
        system_invoices: 0, system_collected: 0,
      },
    ]],
    [over.bands ?? [
      {
        band: 'No Touch Logged', invoices: 150, amount: 20000, collected: 18000,
        self_invoices: 80, self_collected: 10000,
        agent_invoices: 68, agent_collected: 8000,
        system_invoices: 2, system_collected: 0,
      },
    ]],
    [over.paths ?? [
      { path: 'New Card Provided', invoices: 267, invoiced: 35638, collected: 35638 },
      { path: 'Written Off', invoices: 51, invoiced: 7015, collected: 0 },
    ]],
    [[over.memo ?? {
      declined_invoices: 51, declined_amount: 7015,
      all_invoices: 63, all_amount: 9120,
      partial_invoices: 4, partial_memo: 210, partial_cash: 3980,
    }]],
    [over.processors ?? [
      { who: 'Self-Service', invoices: 218, amount: 34233, collected: 34233 },
      { who: 'Agent', invoices: 207, amount: 21541, collected: 21466 },
      { who: 'Not Recovered', invoices: 106, amount: 14624, collected: 0 },
    ]],
    // Runs after the Promise.all block, across every currency rather than the selected one.
    [over.currencies ?? [
      { currency: 'USD', invoices: 15131, invoiced: 1238666.90, collected: 1219116.42 },
      { currency: 'CAD', invoices: 12, invoiced: 802.01, collected: 802.01 },
    ]],
  ], over.freshness);
}

/**
 * The pool calls that measure the run, in order. Excludes the reads that touch the
 * registry or a dimension rather than the facts — the freshness read and the campaign
 * vocabulary — because neither has a spine, a currency or a period to be scoped by, and
 * every assertion below is about how a measure is scoped.
 */
const measureCalls = () => query.mock.calls.filter((c) => {
  const s = String(c[0]);
  return !s.includes('ie_source_report')
    && !s.includes('ie_ingestion_lock')
    && !isCampaignDimension(s);
});

const sqlOf = (call: number) => String(measureCalls()[call][0]);
const paramsOf = (call: number) => measureCalls()[call][1] as unknown[];
const allSql = () => query.mock.calls.map((c) => String(c[0]));
const measureSql = () => measureCalls().map((c) => String(c[0]));
/** The measures that attach a gateway result, i.e. everything but the currency breakdown. */
const billingSql = () => allSql().filter((s) => s.includes('ie_fact_collections_billing b'));

// The response cache is process-wide, so without this a case would be answered from
// the previous case's mocked rows instead of running the SQL it means to assert.
beforeEach(() => { vi.clearAllMocks(); clearCycleCache(); });

describe('getCyclePerformance — the spine', () => {
  it('restricts the spine to invoices a recurring run produced', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    for (const sql of measureSql()) expect(sql).toContain('i.recurring_id IS NOT NULL');
  });

  it('never falls back to the billing group current payment method for scope', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // bg.PMType lands on the fact as pm_type and drifts; the run's own payment type
    // is the only thing allowed to decide campaign membership.
    for (const sql of allSql()) expect(sql).not.toMatch(/i\.pm_type/);
  });

  it('joins the gateway result to the invoice by order_id, never by billing group', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // The currency breakdown is the one measure that reads the invoice spine alone —
    // it counts populations per currency and has no gateway result to attach.
    for (const sql of billingSql()) {
      expect(sql).toContain('b.order_id = i.order_id');
      expect(sql).not.toMatch(/b\.billing_group_id\s*=\s*i\.billing_group_id/);
    }
  });

  it('collapses a multi-group invoice to one billing row so outcomes cannot exceed the spine', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // On 2026-08-01 eight invoices declined on the original group and were rescued on
    // a new one the same day. Without this the outcome rows summed to 7,950 of 7,942.
    expect(sqlOf(0)).toContain('NOT EXISTS');
    expect(sqlOf(0)).toContain(
      "CASE b2.first_result\n                        WHEN 'DECLINED' THEN 1 WHEN 'ERROR' THEN 2\n"
      + "                        WHEN 'VOIDED' THEN 3 WHEN 'OK' THEN 4\n"
      + "                        WHEN 'IN_FLIGHT' THEN 5 ELSE 6 END",
    );
  });

  it('never reports an unsettled row when another row for the day resolved', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // A capture awaiting settlement says less than any finished answer for the same
    // invoice, so it ranks below OK — and explicitly, not via the ELSE, so it cannot
    // trade places with the next outcome added the same way.
    const sql = sqlOf(0);
    expect(sql).toContain("WHEN 'IN_FLIGHT' THEN 5 ELSE 6 END");
    expect(sql.indexOf("WHEN 'OK' THEN 4")).toBeLessThan(sql.indexOf("WHEN 'IN_FLIGHT' THEN 5"));
  });

  it('ranks a reversed sale above a plain success when picking the run row', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // A sale that was accepted and then voided is an event someone has to see, so it
    // must not be hidden by an OK on another group; it is not our defect, so it stays
    // below ERROR. Without a rank of its own it fell to the ELSE and lost to both.
    const sql = sqlOf(0);
    expect(sql).toContain("WHEN 'VOIDED' THEN 3 WHEN 'OK' THEN 4");
    expect(sql.indexOf("WHEN 'ERROR' THEN 2")).toBeLessThan(sql.indexOf("WHEN 'VOIDED' THEN 3"));
  });

  it('does not let a same-day success hide our own submission failure', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // ERROR used to lose to OK, so an invoice we submitted badly on one group and then
    // settled on another reported as clean: 2026-09-01 had 15 ERROR rows across 13
    // invoices and the page showed 11. A decline is a customer event and still outranks
    // everything; a plain OK is the absence of a problem and has nothing to report.
    const rank = (result: string) =>
      sqlOf(0).indexOf(`WHEN '${result}' THEN`);
    expect(rank('DECLINED')).toBeLessThan(rank('ERROR'));
    expect(rank('ERROR')).toBeLessThan(rank('OK'));
  });

  it('pins the run result to the invoice own date so later agent charges are not intake', async () => {
    mockSummary();
    await getCyclePerformance(filters);
    expect(sqlOf(0)).toContain('b.date_key = i.date_key');
  });

  it('separates an unanswered ACH invoice from a card that was never attempted', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // ACH results land in the gateway log long after the run — 671 of 679 September
    // ACH invoices had no row on 09-10 against 45 of 8,049 card. Sharing the
    // NO_CHARGE bucket made settlement lag the largest apparent failure on the page.
    expect(sqlOf(0)).toContain("WHEN i.recurring_payment_type = 3         THEN 'PENDING_ACH'");
  });

  it('explains an invoice that was already settled before its own run date', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Not attempting an invoice that owes nothing is correct behaviour, not a miss, so
    // this arm is tested before every other no-billing-row case — all of which imply
    // something went wrong. 7 invoices across the window sit here worth 8,209.40, one
    // of them reported as "never attempted — expired card" for 415.17 when the balance
    // had been zero since before the run.
    const sql = sqlOf(0);
    expect(sql).toContain("THEN 'ALREADY_SETTLED'");
    expect(sql.indexOf("'ALREADY_SETTLED'")).toBeLessThan(sql.indexOf("'PENDING_ACH'"));
  });

  it('reads the settlement instant on the Eastern calendar the invoice was dated on', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // first_cash_on is a UTC instant, order_date a calendar day. A raw comparison files
    // anything settled in the last four hours of the previous evening on the wrong day.
    expect(sqlOf(0)).toMatch(
      /DATE\(DATE_SUB\(COALESCE\(i\.first_cash_on, i\.credit_memo_on\), INTERVAL IF\(/,
    );
  });
});

describe('getCyclePerformance — campaigns and totals', () => {
  it('scopes to the four declined-charge runs by default', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // ACH bills on the 1st and the 16th exactly as card does, so there are four runs
    // here, not three. It used to collapse into a single 'ACH' key, which was the only
    // instrument whose two cycles could not be compared with each other.
    const params = paramsOf(0);
    expect(params).toEqual([
      20260801, 20260831, 'CC_1_15', 'CC_16_31', 'ACH_1_15', 'ACH_16_31', 'USD',
    ]);
  });

  it('scopes to a single ACH run when one is selected', async () => {
    mockSummary();
    await getCyclePerformance({ ...filters, campaign: 'Declined ACH (16th)' });

    const params = paramsOf(0);
    expect(params).toEqual([20260801, 20260831, 'ACH_16_31', 'USD']);
  });

  it('will not scope to the retired pre-split ACH key', async () => {
    mockSummary();
    await getCyclePerformance({ ...filters, campaign: 'Declined ACH (pre-split)' });

    // The old key still decodes so a fact row loaded before the split renders a
    // readable label, but it is not a run anyone can report on.
    const params = paramsOf(0);
    expect(params).toEqual([
      20260801, 20260831, 'CC_1_15', 'CC_16_31', 'ACH_1_15', 'ACH_16_31', 'USD',
    ]);
  });

  it('scopes to a single campaign when one is selected', async () => {
    mockSummary();
    await getCyclePerformance({ ...filters, campaign: 'Declined CC (1st)' });

    const params = paramsOf(0);
    expect(params).toEqual([20260801, 20260831, 'CC_1_15', 'USD']);
  });

  it('ignores a campaign this report cannot measure instead of filtering to it', async () => {
    mockSummary();
    await getCyclePerformance({ ...filters, campaign: 'Check' });

    // Falls back to all four declined-charge runs, never 'CHECK'.
    const params = paramsOf(0);
    expect(params).toEqual([
      20260801, 20260831, 'CC_1_15', 'CC_16_31', 'ACH_1_15', 'ACH_16_31', 'USD',
    ]);
  });

  it('denominates every measure in one currency so CAD is never added to USD', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // August 2026 carries 17 Canadian invoices and September 13, and their dollars used
    // to be summed into the USD figures behind a "$". Filtering at the spine is what
    // makes each measure single-currency by construction rather than by remembering.
    // The breakdown itself is the sole exception and is asserted separately below.
    const measures = measureSql().filter((s) => !s.includes("IFNULL(i.currency_code, '')"));
    expect(measures).toHaveLength(measureSql().length - 1);
    for (const sql of measures) expect(sql).toContain('i.currency_code = ?');
  });

  it('honours a non-default currency instead of silently serving USD', async () => {
    mockSummary();
    await getCyclePerformance(filters, { currency: 'CAD' });

    const params = paramsOf(0);
    expect(params).toContain('CAD');
    expect(params).not.toContain('USD');
  });

  it('discloses the currencies it is not showing rather than dropping them', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    // Reporting one currency at a time would otherwise make the others invisible, which
    // is worse than mixing them because nothing on the page says they exist.
    expect(res.currency).toBe('USD');
    expect(res.currencies).toEqual([
      { currency: 'USD', invoices: 15131, invoiced: 1238666.90, collected: 1219116.42 },
      { currency: 'CAD', invoices: 12, invoiced: 802.01, collected: 802.01 },
    ]);
  });

  it('counts every currency in the breakdown, including the unselected ones', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // The breakdown is the ONE query that must not be currency-scoped.
    const currencySql = allSql().find((s) => s.includes("IFNULL(i.currency_code, '')"));
    expect(currencySql).toBeDefined();
    expect(currencySql).not.toContain('i.currency_code = ?');
  });

  it('keeps cents instead of rounding money to whole dollars', async () => {
    mockSummary({ memo: { declined_invoices: 3, declined_amount: 18738.129999999997 } });
    const res = await getCyclePerformance(filters);

    // A $32.95 invoice was being served as $33. Rounding to cents rather than not at
    // all keeps the sum of the parts equal to the whole however the rows are grouped.
    expect(res.creditMemos.declined.amount).toBe(18738.13);
  });

  it('separates the declined memo total from the whole cycle it was being mixed with', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    // Stage 3's paths cover declined invoices only, so a memo note beside them has to
    // count the same population. The all-cycle figure is still reported, labelled as
    // the wider one, rather than silently standing in for the narrow one.
    expect(res.creditMemos.declined).toEqual({ invoices: 51, amount: 7015 });
    expect(res.creditMemos.allCycle).toEqual({ invoices: 63, amount: 9120 });
    expect(res.creditMemos.partial)
      .toEqual({ invoices: 4, memoAmount: 210, cashAmount: 3980 });
  });

  it('lists every pipeline member even when only one registry row came back', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.freshness.map((f) => f.code)).toEqual([
      'collections_invoice', 'collections_billing', 'collections_task',
      'collections_touch', 'collections_recovery',
    ]);
    expect(res.freshness[0].lastRunAt).toBe('2026-09-13T06:00:00.000Z');
    expect(res.freshness[1].lastRunAt).toBeNull();
    expect(res.pipelineLoading).toBe(false);
  });

  it('offers All Declined first so the default selection exists in the dropdown', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    // Four runs, in cycle order per instrument. The retired pre-split ACH key is not
    // offered: it still decodes for a fact row loaded before the split, but it is not
    // a run anyone can report on.
    expect(res.campaigns).toEqual([
      'All Declined',
      'Declined CC (1st)', 'Declined CC (16th)',
      'Declined ACH (1st)', 'Declined ACH (16th)',
    ]);
    expect(res.selectedCampaign).toBe('All Declined');
  });

  it('echoes back the campaign it actually measured, not the one that was asked for', async () => {
    mockSummary();
    const res = await getCyclePerformance({ ...filters, campaign: 'Check' });
    expect(res.selectedCampaign).toBe('All Declined');
  });

  it('rolls every outcome into the invoiced total so nothing silently falls out', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.invoiced.invoices).toBe(7620 + 270 + 4 + 48);
    expect(res.invoiced.amount).toBe(725944 + 45063 + 54182 + 6385);
  });

  it('sums remaining balance due on declined invoices as amount outstanding', async () => {
    mockSummary({
      coverage: [
        {
          bucket: 'New Task Created', invoices: 5, amount: 500, collected: 200,
          outstanding_invoices: 3, outstanding: 210.5,
        },
      ],
    });
    const res = await getCyclePerformance(filters);

    expect(sqlOf(2)).toContain('i.open_balance > 0');
    expect(sqlOf(2)).toContain("b.first_result = 'DECLINED'");
    expect(res.outstanding).toEqual({ invoices: 3, amount: 210.5 });
  });

  it('stamps the header from the newest pipeline member, not a single fact', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);
    expect(res.dataLastUpdated).toBe('2026-09-13T06:00:00.000Z');
    expect(res.dataNextUpdate).toBe('2026-09-14T06:00:00.000Z');
    expect(res.updateEveryMinutes).toBe(60);
  });

  it('reports credit memos separately from recovered cash', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.creditMemos.declined).toEqual({ invoices: 51, amount: 7015 });
    const memoPath = res.recoveryPaths.find((p) => p.path === 'Written Off');
    expect(memoPath?.collected).toBe(0);
  });
});

describe('getCyclePerformance — stage 2 task activity', () => {
  /** Position of getTouchBands in the Promise.all block the service fires. */
  const TOUCH_BANDS = 4;

  it('follows the link the transform resolved instead of re-deriving one', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // The read path used to re-match the task here — earliest task for the same
    // customer in the same half-month pass — which is a second, weaker copy of a rule
    // the fact already answers, and it disagreed with the fact on 21 invoices.
    // Customer 122706 is the worked example: three tasks opened the same morning on
    // different billing groups, and "earliest for the customer" handed all of that
    // customer's invoices the 15:48 one whatever card was charged.
    expect(sqlOf(3)).toContain('t.task_id = i.task_id');
    expect(sqlOf(3)).not.toContain('t.customer_id = i.customer_id');
    expect(sqlOf(3)).not.toContain('t.pass_key');
  });

  it('drops the ranking subquery the customer-scoped match needed to stay inside the timeout', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // task_id is unique in the fact (19,302 of 19,302), so an equality join cannot fan
    // out and there is nothing left to rank. ie_fact_collections_task has no index on
    // customer_id, which is what made the old lookup expensive in the first place.
    expect(sqlOf(3)).not.toContain('ROW_NUMBER() OVER');
    expect(sqlOf(3)).not.toContain('ranked.rn = 1');
  });

  it('says how each task was linked rather than presenting an inference as a record', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // New work, a prior open task, or no pickup we can prove. EXPLICIT / AMBIGUOUS /
    // TRIGGERED collapse to one "new" bucket so the page does not split provenance.
    for (const label of [
      'New Task Created', 'Added to Existing Task', 'No Task Created',
    ]) expect(sqlOf(2)).toContain(label);
    expect(sqlOf(2)).toContain('CASE i.task_link_source');
    expect(sqlOf(2)).not.toContain('ie_fact_collections_recovery');
    expect(sqlOf(2)).not.toContain('ie_fact_collections_task');
  });

  it('measures task activity against declines only, since a clean invoice raises no task', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    for (const call of [2, 3, 4]) expect(sqlOf(call)).toContain("b.first_result = 'DECLINED'");
  });

  it('bands only the outreach that preceded the payment', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Lifetime touches presented post-payment work as the work that recovered the
    // invoice: on 1919497, five touches for a memo that only three of them preceded.
    // The band reads touches_before; the lifetime count survives beside it for the
    // "how much did this task cost in total" question, which is a different one.
    const sql = sqlOf(TOUCH_BANDS);
    expect(sql).toContain("WHEN IFNULL(tw.touches_before, 0) = 0 THEN 'No Touch Logged'");
    expect(sql).toContain('ft.created_on <  COALESCE(iv.first_cash_on, iv.credit_memo_on)');
  });

  it('reports post-payment and same-second touches instead of folding them into the bands', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // A touch stamped at the financial event to the second cannot be ordered against
    // it — CRM writes both from one workflow. Calling it "before" inflates effort and
    // "after" erases it, so it is counted apart and disclosed as unresolved.
    const sql = sqlOf(TOUCH_BANDS);
    expect(sql).toContain("SUM(placement = 'AFTER')    AS touches_after");
    expect(sql).toContain("SUM(placement = 'SAME_SEC') AS touches_same_second");
    expect(sql).toContain('SUM(IFNULL(tw.touches_same_second, 0) > 0) AS unresolved_order');
  });

  it('starts the touch window at the invoice own decline, in Eastern', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // A task spanning several cycles would otherwise credit this invoice with the
    // previous one's outreach. created_on is a UTC instant and order_date a calendar
    // day, so a raw comparison pulls in the last hours of the previous evening.
    expect(sqlOf(TOUCH_BANDS))
      .toMatch(/DATE_SUB\(ft\.created_on, INTERVAL IF\([\s\S]*?\) HOUR\) >= iv\.order_date/);
  });

  it('reports collected cash beside every task count so a Paid status cannot stand in for money', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.coverage[0]).toEqual({
      bucket: 'New Task Created', invoices: 270, amount: 45063, collected: 37782,
    });
    expect(res.taskStatuses[0].collected).toBe(37557);
    expect(res.touchBands[0].collected).toBe(18000);
  });
});

describe('getCyclePerformance — repeat declines', () => {
  it('counts a repeat only when the same group failed within the trailing year', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // date_key is YYYYMMDD, so subtracting 10000 steps back exactly one year.
    expect(sqlOf(1)).toContain('rp.prev_key >= i.date_key - 10000');
    expect(sqlOf(1)).toContain('rp.prev_key IS NOT NULL');
  });

  it('finds the nearest prior decline with one ordered pass, not a self-join', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Pairing every decline with every earlier one on the same group blew the
    // statement timeout — billing_group_id has no index of its own to join through.
    expect(sqlOf(1)).toContain('LAG(date_key) OVER (PARTITION BY billing_group_id ORDER BY date_key)');
    expect(sqlOf(1)).not.toMatch(/prior\.billing_group_id\s*=\s*cur\.billing_group_id/);
  });

  it('measures repeats against every prior decline, including ones with no invoice', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // The window's only filter is the decline itself, so a prior failure we cannot tie
    // to an invoice still marks the next one as a repeat.
    expect(sqlOf(1)).toContain('LAG(date_key)');
    expect(sqlOf(1)).not.toContain('WHERE order_id IS NOT NULL');
  });

  it('binds repeat evidence to the selected billing row so one invoice cannot match twice', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Joining on (order_id, date_key) against a billing-group-grain subquery fanned an
    // invoice declined on two groups the same day into two rows, inflating 2026-09-01
    // from 333/$58,603.60 to 336/$59,043.40. (billing_group_id, date_key) is the fact's
    // unique key, so the repeat row is pinned to the billing row BILLING_JOIN chose.
    expect(sqlOf(1)).toContain('rp.billing_group_id = b.billing_group_id');
    expect(sqlOf(1)).toContain('rp.date_key = b.date_key');
    expect(sqlOf(1)).not.toMatch(/rp\.order_id\s*=\s*i\.order_id/);
  });

  it('splits repeat count and repeat dollars per reason', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.declineReasons[0]).toEqual({
      reason: 'Insufficient Funds', invoices: 119, amount: 9900,
      repeatInvoices: 61, repeatAmount: 5943,
    });
    // A reason with no history must report zero, not the row total.
    expect(res.declineReasons[1]).toMatchObject({ repeatInvoices: 0, repeatAmount: 0 });
  });
});

describe('getCyclePerformance — who took the payment', () => {
  const PROCESSORS = 7;

  it('classifies without a staff-id threshold, so hiring cannot break it', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // AGENT is already exact on processor_kind and 0/12 are the system accounts, so
    // everything left over is self-service. A numeric cut at the current max UserID
    // would silently reclassify the next agent hired as a customer.
    expect(sqlOf(PROCESSORS)).toContain("processor_kind = 'AGENT'");
    expect(sqlOf(PROCESSORS)).toContain('processor_crm_id IN (0, 12)');
    expect(sqlOf(PROCESSORS)).not.toMatch(/processor_crm_id\s*[<>]/);
  });

  it('ranks the processor so the system account cannot outrank a real agent', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // MIN(processor_crm_id) would pick 0 over an agent on a split payment.
    expect(sqlOf(PROCESSORS)).toContain('MIN(CASE WHEN processor_kind');
    expect(sqlOf(PROCESSORS)).not.toContain('MIN(processor_crm_id)');
  });

  it('counts every declined invoice, so unrecovered ones are not silently dropped', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(sqlOf(PROCESSORS)).not.toContain('r.collected > 0');
    expect(res.processors.map((p) => p.who)).toContain('Not Recovered');
    expect(res.processors[0]).toEqual({
      who: 'Self-Service', invoices: 218, amount: 34233, collected: 34233,
    });
  });

  it('splits task statuses and touch bands by who collected', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    expect(res.taskStatuses[0]).toMatchObject({
      status: 'Paid', invoices: 228,
      selfInvoices: 120, selfCollected: 20000,
      agentInvoices: 85, agentCollected: 17557,
    });
    expect(res.touchBands[0]).toMatchObject({
      band: 'No Touch Logged', selfInvoices: 80, agentInvoices: 68, systemInvoices: 2,
    });
  });

  it('leaves the processor counts short of the invoice count when nobody paid', async () => {
    mockSummary();
    const res = await getCyclePerformance(filters);

    // 228 Paid against 205 processed is the "closed as Paid, no cash applied" gap
    // the page surfaces as its No cash column.
    const s = res.taskStatuses[0];
    expect(s.invoices - s.selfInvoices - s.agentInvoices - s.systemInvoices).toBe(23);
  });

});

describe('getCyclePerformance — stage 3 recovery', () => {
  it('answers the card re-key question from a pre-aggregate, not a per-row probe', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // uq_fcb_bg leads on date_key, so billing_group_id cannot be seeked and a
    // correlated EXISTS scanned the fact once per result row — ~10s of an ~11s load.
    expect(sqlOf(5)).toContain('GROUP BY billing_group_id, charge_last4');
    expect(sqlOf(5)).toContain('ok.last_ok_key      > d.date_key');
    expect(sqlOf(5)).toContain('IFNULL(rk.rekeyed, 0) = 1');
    expect(sqlOf(5)).not.toContain('b2.charge_last4');
  });

  it('tests cash before the credit memo so a part-paid write-off still counts as recovery', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Memo-first hid one August recovery inside "Credit memo" and left stage 3's
    // unrecovered total one below stage 2's.
    const sql = sqlOf(5);
    expect(sql.indexOf('IFNULL(r.collected, 0) > 0'))
      .toBeLessThan(sql.indexOf('WHEN i.credit_memo_amount > 0'));
    expect(sql).toContain("THEN 'Written Off'");
  });

  it('treats a new card as one outcome whether or not CRM made a new billing group', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // All 248 August "new billing group" cases were the SAME customer — CRM creates a
    // group to hold a replacement card, so splitting it from a re-key invented an
    // account-ownership problem that does not exist.
    const sql = sqlOf(5);
    expect(sql).not.toContain('New billing group');
    expect(sql).not.toContain('Card re-keyed on same group');
    // Three arms reach it: a different paying card, a different paying group, and the
    // re-key proxy. One outcome, three ways of establishing it.
    expect(sql.match(/'New Card Provided'/g)).toHaveLength(3);
  });

  it('decides the card from the payment that paid, not from the billing group', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // 1919833 declined 08-01 on group 68054 last4 1781 and was paid 08-03 on group
    // 112957 last4 4587, and reported "Original card retried" — because that was the
    // ELSE arm and the group evidence it relied on is rewritten by CRM after payment.
    const sql = sqlOf(5);
    expect(sql).toContain('r.payment_last4');
    expect(sql.indexOf('r.payment_last4 <>')).toBeLessThan(sql.indexOf('r.billing_group_id <>'));
  });

  it('will not credit the original card when the instrument cannot be established', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // 'Original card retried' used to be the ELSE, so everything unplaceable landed on
    // it. It is now a positive finding and the fall-through says so instead.
    const sql = sqlOf(5);
    expect(sql).toContain("ELSE 'Card Not Identified'");
    expect(sql).not.toMatch(/ELSE 'Original card retried'/);
  });

  it('treats a matching last four as inconclusive rather than as the same card', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Two cards can share their last four and a re-issue usually keeps them, so only a
    // DIFFERENCE concludes. A match falls through to the group evidence.
    const sql = sqlOf(5);
    expect(sql).not.toMatch(/r\.payment_last4\s*=\s*NULLIF/);
    expect(sql).toContain('r.payment_last4 <>');
  });

  it('reads the payer off one payment instead of assembling it from several', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // The identity fields were independent MIN()s over the invoice's payments, so a
    // twice-paid invoice reported a group from one payment, a name from another and a
    // date from a third — a payer who never existed. Ranking once and reading every
    // field off the winning row keeps the person named and the payment described the same.
    const sql = sqlOf(5);
    expect(sql).not.toMatch(/MIN\(processor_name\)/);
    expect(sql).not.toMatch(/MIN\(billing_group_id\)/);
    expect(sql).not.toMatch(/MIN\(applied_on\)/);
    expect(sql).not.toMatch(/MIN\(agent_email\)/);
    expect(sql).toContain('pick.processor_name');
    expect(sql).toContain('pick.billing_group_id');
  });

  it('breaks a payment tie deterministically so the payer cannot change between loads', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    expect(sqlOf(5)).toContain('(r2.applied_on, r2.payment_credit_id)');
  });

  it('still ranks the processor across all payments, not just the winning one', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Picking one payment answers "who paid"; the rank answers "was an agent involved
    // at all", which has to see every payment or a split one would lose the agent.
    expect(sqlOf(5)).toContain("MIN(CASE WHEN processor_kind = 'AGENT'");
  });

  it('separates a card we already held from one the customer just gave us', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // tblBillingGroups.CreatedOn is not warehoused, so the group's first charge
    // stands in for it: no billing history before the decline means a new card.
    expect(sqlOf(5)).toContain('MIN(date_key) AS first_key');
    expect(sqlOf(5)).toContain('IFNULL(pg.first_key, i.date_key) >= i.date_key');
    expect(sqlOf(5)).toContain("THEN 'Another Card on File'");
  });

  it('names a successful retry of the declined card so it cannot be read as retired', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // "Original card retried" was being read as "retired". The path is the declined
    // card being used again, which is the opposite.
    expect(sqlOf(5)).toContain("THEN 'Same Card Tried Again'");
    expect(sqlOf(5)).not.toContain("THEN 'Original card retried'");
  });

  it('counts declined cards that were charged again after a different card paid', async () => {
    mockSummary();
    await getCyclePerformance(filters);

    // Paying with a new card does not take the old one off file. A later charge on
    // the same group and last four is the proof the next cycle will hit it again.
    const sql = sqlOf(5);
    expect(sql).toContain('os.last_key         > b.date_key');
    expect(sql).toContain('AND os.last_key IS NOT NULL');
    expect(sql).not.toContain('later.charge_last4');
  });
});

function mockInvoiceQueries(rows: unknown[] = [], total = 0) {
  respond([[rows], [[{ total }]]]);
}

describe('getCycleInvoices', () => {
  it('only counts cash applied to that same invoice, so next cycle money cannot leak in', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    expect(sqlOf(0)).toContain('r.order_id = i.order_id');
    expect(sqlOf(0)).toContain('is_reversed = 0');
  });

  it('formats dates in SQL so a DATE column cannot slip a day through the driver', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // mysql2 hands back a DATE as local midnight, which stringified an 08-01 invoice
    // to "Fri Jul 31" in any timezone behind UTC.
    expect(sqlOf(0)).toContain("DATE_FORMAT(i.order_date, '%Y-%m-%d')");
    expect(sqlOf(0)).toContain("DATE_FORMAT(COALESCE(r.first_paid_on, i.paid_on), '%Y-%m-%d')");
  });

  it('reads cash and paid date off the invoice, not the recovery fact', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // ie_fact_collections_recovery only admits cash on accounts we were chasing, so an
    // invoice the RUN collected has no row in it at all. Reading the grid's money from
    // there showed 1936470 — CASH_PAID for $6,888.44 at 07:37 on the 1st, zero balance
    // — with no cash and a "Still open" path. The invoice fact already knows.
    const sql = sqlOf(0);
    expect(sql).toContain('i.cash_collected                      AS collected');
    expect(sql).not.toContain('IFNULL(r.collected, 0)                AS collected');
  });

  it('asks the recovery fact how the money came back, and the invoice whether it did', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // Every branch above the last used to read `r`, so an invoice with no recovery row
    // dropped straight through to "Still open" — 6,616 paid invoices worth $705,876.25
    // on 2026-09-01 alone. The recovery branch keeps its place at the top so stage 3's
    // declined cohort still gets its existing paths; the new arms only catch what falls
    // past it.
    const sql = sqlOf(0);
    const at = (needle: string) => sql.indexOf(needle);
    expect(at('IFNULL(r.collected, 0) > 0 THEN')).toBeLessThan(at("'Collected on the Run'"));
    expect(at("'Collected on the Run'")).toBeLessThan(at("'Collected, Source Unknown'"));
    expect(at("'Collected, Source Unknown'")).toBeLessThan(at("ELSE 'Still Open'"));
  });

  it('compares the paying group against the charged group when there is no billing row', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // Both "did the group change" branches read b.billing_group_id, and b does not
    // exist for a never-attempted invoice — so the whole bucket skipped the comparison
    // and dropped to the last arm, reporting a new card as the original one retried.
    // On 2026-08-01 that was 5 of the 20 paid never-attempted invoices, each paid from
    // a 113xxx group the run had never touched.
    const sql = sqlOf(0);
    expect(sql).toContain('IFNULL(b.billing_group_id, i.card_billing_group_id)');
    expect(sql).not.toMatch(/r\.billing_group_id\s*<>\s*b\.billing_group_id/);
  });

  it('explains a submission error with the message the gateway actually returned', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // decline_reason is deliberately NULL outside DECLINED in the fact, which left all
    // 15 ERROR rows on 2026-09-01 with nothing to show. result_message keeps the raw
    // text for every result, so an Invalid Amount reads differently from a malformed
    // request instead of both rendering as a bare "Submission error".
    expect(sqlOf(0)).toContain("CASE WHEN b.first_result = 'ERROR' THEN b.result_message END");
  });

  it('names the payer when the customer paid through the portal', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    // processor_crm_id identifies the payer exactly, but only AR staff were resolved,
    // so a self-service payment rendered as "No agent" beside a real name.
    expect(sqlOf(0)).toContain('COALESCE(r.processor_name, r.agent_email)');
  });

  it('filters through RESULT_CASE itself so the bucket ladder is never restated', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters, { result: 'NO_CHARGE_EXPIRED' });

    // Only OK/DECLINED/ERROR are a literal on first_result. The three never-attempted
    // buckets and PENDING_ACH are all "no billing row", separated by the run's payment
    // type and the card state, so a hand-written predicate per bucket would drift the
    // moment one is added — which is exactly what splitting NO_CHARGE did.
    expect(sqlOf(0)).toContain("WHEN i.card_state = 'EXPIRED'             THEN 'NO_CHARGE_EXPIRED'");
    expect(sqlOf(0)).not.toContain('b.first_result = ?');
    const params = paramsOf(0);
    expect(params).toContain('NO_CHARGE_EXPIRED');
  });

  it('lists still-outstanding declines by remaining balance, not as a run result', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters, { result: 'OUTSTANDING' });

    expect(sqlOf(0)).toContain("b.first_result = 'DECLINED'");
    expect(sqlOf(0)).toContain('i.open_balance > 0');
    const params = paramsOf(0);
    expect(params).not.toContain('OUTSTANDING');
  });

  it('tests ACH before card state so an unanswered ACH never lands in a card bucket', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters, { result: 'NO_CHARGE' });

    // Order in the CASE is the guarantee: 671 of 679 September ACH invoices had no
    // gateway row, and an ACH billing group carries CRM's default 12/2100 expiry, so
    // reaching the card arms at all would file every one of them as a valid card.
    const sql = sqlOf(0);
    expect(sql.indexOf("'PENDING_ACH'")).toBeLessThan(sql.indexOf("'NO_CHARGE_EXPIRED'"));
  });

  it('reports a submitted charge that was never answered as its own outcome', async () => {
    // NOT a never-attempted bucket, which is where it used to be filed. Invoice
    // 1922467 has gateway request row 3454889 at 04:04:07 for $1,149.93 on last4 1008
    // with no answer, and settled untouched on that same card three days later. We
    // attempted it.
    mockInvoiceQueries();
    await getCycleInvoices(filters, { result: 'NO_RESPONSE' });

    const sql = sqlOf(0);
    expect(sql).toContain("WHEN i.pay_request_state = 'NO_RESPONSE'  THEN 'NO_RESPONSE'");
    expect(sql).toContain("WHEN i.card_state = 'EXPIRED'             THEN 'NO_CHARGE_EXPIRED'");
    expect(sql).not.toContain('NO_CHARGE_UNCONFIRMED');
    expect(sql).not.toContain('NO_CHARGE_REPLACED');
  });

  it('never claims we skipped an invoice we demonstrably submitted', async () => {
    // NO_RESPONSE outranks the card so the page cannot label a submitted charge
    // "never attempted". They do not collide today — EXPIRED + NO_RESPONSE occurs zero
    // times across the 15-month window, since a dead card is rejected internally in the
    // same second — but the ordering is what keeps the labels honest if that changes.
    mockInvoiceQueries();
    await getCycleInvoices(filters);

    const sql = sqlOf(0);
    expect(sql.indexOf("'NO_RESPONSE'")).toBeLessThan(sql.indexOf("'NO_CHARGE_EXPIRED'"));
  });

  it('folds every did-not-reach-the-gateway state into one never-attempted bucket', async () => {
    // UNSUBMITTED, NOT_SENT and NULL all mean the charge never went out. NULL cannot be
    // matched by equality, so the arm has to be the fall-through rather than a test.
    mockInvoiceQueries();
    await getCycleInvoices(filters, { result: 'NO_CHARGE' });

    const sql = sqlOf(0);
    expect(sql).toContain("ELSE 'NO_CHARGE' END");
    expect(sql).not.toContain("pay_request_state = 'NOT_SENT'");
    expect(sql).not.toContain("pay_request_state = 'UNSUBMITTED'");
  });

  it('clamps the row cap so a year-wide selection cannot pull the whole fact', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters, { limit: 999999 });

    expect(sqlOf(0)).toContain('LIMIT 5000');
  });

  it('reports the full population so a capped page cannot read as the whole cohort', async () => {
    mockInvoiceQueries([], 536);
    const res = await getCycleInvoices(filters, { limit: 500 });

    // August's declined cohort runs past the 500 default; the grid used to simply end
    // with nothing saying that 36 invoices were missing.
    expect(res.total).toBe(536);
    expect(sqlOf(1)).toContain('COUNT(*) AS total');
  });

  it('pages with a unique tie-breaker so a row cannot be served twice or skipped', async () => {
    mockInvoiceQueries();
    await getCycleInvoices(filters, { limit: 100, offset: 200 });

    // Two invoices sharing a date and an amount would otherwise be free to swap places
    // between requests, which is how paging loses rows.
    expect(sqlOf(0)).toContain('ORDER BY i.date_key DESC, i.invoice_amount DESC, i.order_id DESC');
    expect(sqlOf(0)).toContain('LIMIT 100 OFFSET 200');
  });

  it('counts the total over the same predicate as the page it returns', async () => {
    mockInvoiceQueries([], 7);
    await getCycleInvoices(filters, { result: 'DECLINED' });

    // A total measured over a different population is worse than no total at all, so
    // the count carries the same scope and the same result filter.
    //
    // The two param lists are no longer identical, and should not be: the row query's
    // derived tables (touches, recovery, re-key) are scoped to the same window, so it
    // binds that window once per join before binding it for its own WHERE. The count
    // query needs none of those joins. What must still hold is that the count's params
    // are exactly the scope-plus-filter tail of the row query's — same window, same
    // campaign, same currency, same result filter — so both count one population.
    const rowParams = paramsOf(0);
    const countParams = paramsOf(1);
    expect(countParams).toEqual(rowParams.slice(rowParams.length - countParams.length));
    expect(sqlOf(1)).toContain('i.currency_code = ?');
    // ...but without the page's own window, or it would just recount the page.
    expect(sqlOf(1)).not.toContain('LIMIT');
    expect(sqlOf(1)).not.toContain('ie_fact_collections_touch');
    expect(sqlOf(1)).not.toContain('ie_fact_collections_recovery');
  });

  it('rejects an unsupported currency rather than quietly showing USD', async () => {
    mockInvoiceQueries();
    const res = await getCycleInvoices(filters, { currency: 'CAD' });

    expect(res.currency).toBe('CAD');
    expect(paramsOf(0)).toContain('CAD');
  });

  it('maps a declined row into the grid shape the page renders', async () => {
    mockInvoiceQueries([{
      order_id: 1923909, customer_id: 104231, order_date: '2026-08-01', campaign_key: 'CC_1_15',
      invoice_amount: 433.43, result: 'DECLINED', decline_reason: 'Insufficient Funds',
      charge_bg: 98280, charge_last4: '4242',
      task_id: 1104608, final_status_label: 'Paid', task_agent: 'bbettis@dm-us.com',
      touches: 2, path: 'New Card Provided',
      collected: 433.43, first_paid_on: '2026-08-04',
      processor_kind: 'AGENT', agent_email: 'agent@example.com',
      credit_memo_amount: 0, open_balance: 0, currency_code: 'USD',
    }], 1);

    const { rows, total } = await getCycleInvoices(filters);
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      currency: 'USD',
      orderId: 1923909,
      customerId: 104231,
      orderDate: '2026-08-01',
      campaign: 'Declined CC (1st)',
      result: 'DECLINED',
      chargeBillingGroupId: 98280,
      chargeLast4: '4242',
      taskId: 1104608,
      taskStatus: 'Paid',
      taskAgent: 'bbettis@dm-us.com',
      touches: 2,
      recoveryPath: 'New Card Provided',
      paidOn: '2026-08-04',
      processor: 'agent@example.com',
    });
  });

  it('carries the CRM account so the grid can build an Order/Detail link, null when absent', async () => {
    mockInvoiceQueries([
      { order_id: 1, customer_id: 104231, currency_code: 'USD' },
      { order_id: 2, customer_id: null, currency_code: 'USD' },
    ], 2);

    const { rows } = await getCycleInvoices(filters);
    expect(sqlOf(0)).toContain('i.customer_id');
    expect(rows[0].customerId).toBe(104231);
    expect(rows[1].customerId).toBeNull();
  });

  it('flags a repeat off the same LAG-based measure the breakdown uses, pinned to the billing row', async () => {
    mockInvoiceQueries([
      { order_id: 1, is_repeat: 1, currency_code: 'USD' },
      { order_id: 2, is_repeat: 0, currency_code: 'USD' },
    ], 2);

    const { rows } = await getCycleInvoices(filters);
    // Same fragments as the decline-reason breakdown, so a per-row repeat and the
    // repeat count on the aggregate can never disagree.
    expect(sqlOf(0)).toContain('LAG(date_key) OVER (PARTITION BY billing_group_id ORDER BY date_key)');
    expect(sqlOf(0)).toContain('rp.prev_key >= i.date_key - 10000');
    expect(sqlOf(0)).toContain('rp.billing_group_id = b.billing_group_id');
    expect(rows[0].isRepeat).toBe(true);
    expect(rows[1].isRepeat).toBe(false);
  });

  it('tells a member of staff from the customer paying through the portal', async () => {
    mockInvoiceQueries([
      { order_id: 1, processor_class: 'AGENT', agent_email: 'Adrian Gaston', currency_code: 'USD' },
      { order_id: 2, processor_class: 'PORTAL', agent_email: 'Adam Keho', currency_code: 'USD' },
      { order_id: 3, processor_class: 'SYSTEM', agent_email: 'Automatic recurring run', currency_code: 'USD' },
      { order_id: 4, processor_class: null, agent_email: null, currency_code: 'USD' },
    ], 4);

    const { rows } = await getCycleInvoices(filters);

    // All three classes arrive carrying a person's name, so the name cannot say which
    // one it was — the customer's portal login reads exactly like an agent.
    expect(sqlOf(0)).toContain("r.processor_kind = 'AGENT'");
    expect(sqlOf(0)).toContain('r.processor_crm_id IN (0, 12)');
    // Read off the ONE payment that settled the invoice, never the rank across all of
    // them: an invoice split between an agent and the customer ranks AGENT, which would
    // print the customer's name under an agent label.
    expect(sqlOf(0)).not.toContain('r.processor_rank');
    expect(rows.map((r) => r.processorClass)).toEqual(['AGENT', 'PORTAL', 'SYSTEM', null]);
  });
});

/**
 * getFailedChargeInvoices fires the row query, the total count and the decline-reason
 * breakdown concurrently, so they resolve in call order: rows, reasons, total. The
 * currency breakdown and freshness reads follow and can be empty.
 */
function mockFailedChargeQueries(opts: { rows?: unknown[]; reasons?: unknown[]; total?: number } = {}) {
  respond([[opts.rows ?? []], [opts.reasons ?? []], [[{ total: opts.total ?? 0 }]]]);
}

describe('getFailedChargeInvoices', () => {
  it('pins the list to declined charges, whatever reason is chosen', async () => {
    mockFailedChargeQueries();
    await getFailedChargeInvoices(filters);

    // Same RESULT_CASE ladder as Cycle Invoices, forced to DECLINED — the page is the
    // declined slice, so no other outcome may ever enter it.
    expect(sqlOf(0)).toContain('i.customer_id');
    expect(paramsOf(0)).toContain('DECLINED');
  });

  it('narrows to a single decline reason when one is selected', async () => {
    mockFailedChargeQueries();
    await getFailedChargeInvoices(filters, { reason: 'Insufficient Funds' });

    // Matched with the same IFNULL(...,'Unspecified') the reason breakdown groups by,
    // so a row here is exactly one of the reasons the buttons offer.
    expect(sqlOf(0)).toContain("IFNULL(b.decline_reason, 'Unspecified') = ?");
    expect(paramsOf(0)).toContain('Insufficient Funds');
  });

  it('shows every declined invoice when no reason is chosen', async () => {
    mockFailedChargeQueries();
    await getFailedChargeInvoices(filters);

    expect(sqlOf(0)).not.toContain("IFNULL(b.decline_reason, 'Unspecified') = ?");
  });

  it('returns the decline-reason breakdown that drives the filter buttons', async () => {
    mockFailedChargeQueries({
      reasons: [
        { reason: 'Insufficient Funds', invoices: 119, amount: 9900, repeat_invoices: 61, repeat_amount: 5943 },
        { reason: 'Expired Card', invoices: 7, amount: 719, repeat_invoices: 0, repeat_amount: 0 },
      ],
      total: 126,
    });

    const res = await getFailedChargeInvoices(filters);
    expect(res.total).toBe(126);
    expect(res.declineReasons).toEqual([
      { reason: 'Insufficient Funds', invoices: 119, amount: 9900, repeatInvoices: 61, repeatAmount: 5943 },
      { reason: 'Expired Card', invoices: 7, amount: 719, repeatInvoices: 0, repeatAmount: 0 },
    ]);
    // The breakdown is scoped to declines within the currency, same as Cycle Performance.
    expect(sqlOf(1)).toContain("b.first_result = 'DECLINED'");
  });
});
