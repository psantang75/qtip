/**
 * Campaign × Touch — the cohort headline and the subscription outcome panel.
 *
 * Split out of `insightsCollectionsCampaign.service.ts` on the measure boundary: that
 * file owns the touch ladder, this owns the starting point the ladder is measured
 * against and the retention picture for the same cohort.
 *
 * EVERY FIGURE HERE COMES FROM `declinedBasis`, which is Cycle Performance's own
 * declined population. See that module for what this replaced and by how much it was
 * out. The rule this file now keeps is simple: dollars, invoices, tasks and
 * subscriptions all describe the SAME rows, so a reader can add them up against the
 * validated report and land on the same numbers.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import { factTableExists } from '../../../insightsAgentActivity.service';
import {
  type CollectionsFilters,
  callLadderCampaigns,
  DEFAULT_CURRENCY,
  agentScope,
  cohortScope,
  num,
} from '../../../insightsCollections.shared';
import {
  type SqlFragment,
  basisOrdersSql,
  basisTasksSql,
  loadDeclinedBasis,
} from '../declinedBasis';

/**
 * Restrict recovery to the debt the campaign was actually handed.
 *
 * Without this the numerator is every payment that ever landed on a task raised in the
 * window, which for August 2026 Declined CC (1st) meant $99,070 of "recovery" against a
 * $48,279 pool — 205%.
 *
 * ONE GATE NOW, NOT TWO. This used to test the gateway attempt log for the invoice AND
 * then re-test the invoice fact for `recurring_id`/currency, because the first list came
 * from a source that knew neither. The basis is built on the invoice fact, so the run
 * gate and the currency gate are already inside it and a second test would be a copy
 * that can drift.
 *
 * Returns an empty fragment for a campaign with no declined run, where the restriction
 * has nothing to say: Check chases an invoice we never charged, so every payment on its
 * tasks is genuine recovery and there is no gateway pool to measure it against. Sales AR
 * and Expiring CC hold ZERO recurring invoices, so applying the gate would not tighten
 * their numbers, it would erase them.
 */
export function recoveryAgainstBasis(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  hasPool: boolean,
  currency: string = DEFAULT_CURRENCY,
): SqlFragment {
  if (!hasPool) return { sql: '', params: [] };
  const orders = basisOrdersSql(filters, fromKey, toKey, callLadderCampaigns(), currency);
  return { sql: ` AND f.order_id IN (${orders.sql})`, params: orders.params };
}

/** Where the cohort's subscriptions ended up, one state per service so the three sum. */
async function loadSubsSplit(restriction: SqlFragment) {
  if (!(await factTableExists('ie_fact_collections_subscription'))) {
    return { subs: 0, subsRetained: 0, subsTerminated: 0, subsReactivated: 0 };
  }
  // RANKED TO ONE OUTCOME PER SERVICE, so the three add up to the total printed above
  // them. A service can hold rows under two outcomes, so each resolves to its furthest
  // state: reactivated beats terminated beats retained. That is the business order, not
  // a tiebreak of convenience — a memo is raised when the service is shut off, and a
  // reactivation is that same service coming back, so the later state is the truer
  // description of where it ended up.
  //
  // Every termination counts here, AR or not. The tile answers "where did the cohort's
  // subscriptions end up", and a service shut off for a non-AR reason is still shut off;
  // `loadSubscriptionSummary` keeps the AR split for the panel that apportions blame.
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`subs\`,
            SUM(x.rnk = 1) AS \`reactivated\`,
            SUM(x.rnk = 2) AS \`terminated\`,
            SUM(x.rnk = 3) AS \`retained\`
       FROM (
         SELECT s.service_id,
                MIN(CASE s.outcome WHEN 'REACTIVATED' THEN 1
                                   WHEN 'TERMINATED'  THEN 2
                                   ELSE 3 END) AS rnk
           FROM ie_fact_collections_subscription s
          WHERE s.order_id IN (${restriction.sql})
          GROUP BY s.service_id
       ) x`,
    restriction.params,
  );
  return {
    subs: num(row?.subs),
    subsRetained: num(row?.retained),
    subsTerminated: num(row?.terminated),
    subsReactivated: num(row?.reactivated),
  };
}

/** Task disposition for a named set of tasks. */
async function loadTaskOutcomes(restriction: SqlFragment) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`tasks\`,
            SUM(CASE WHEN f.outcome IN ('PAID','CARD_UPDATED','REACTIVATED') THEN 1 ELSE 0 END) AS \`recovered\`,
            SUM(CASE WHEN f.outcome LIKE 'OPEN%' THEN 1 ELSE 0 END) AS \`stillOpen\`
       FROM ie_fact_collections_task f
      WHERE f.task_id IN (${restriction.sql})`,
    restriction.params,
  );
  return {
    tasks: num(row?.tasks),
    recovered: num(row?.recovered),
    stillOpen: num(row?.stillOpen),
  };
}

/**
 * The cohort headline — everything the campaign was handed on day one, so the rungs
 * below read as progress against a known denominator rather than free-floating counts.
 *
 * `atRisk` and `collected` are now the SAME invoices: the declined run output, and the
 * cash applied to it. They were sourced independently before — a billing-group pool
 * against task-anchored payments — which is how the page once reached 589.5%, and how it
 * still read 77.6% where Cycle Performance said 86.0%.
 */
export async function loadCohortTotals(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  hasPool: boolean,
  currency: string = DEFAULT_CURRENCY,
) {
  if (!hasPool) return loadNonRunCohort(filters, fromKey, toKey);

  const basis = await loadDeclinedBasis(
    filters, fromKey, toKey, callLadderCampaigns(), currency,
  );
  const tasks = basisTasksSql(filters, fromKey, toKey, callLadderCampaigns(), currency);
  const orders = basisOrdersSql(filters, fromKey, toKey, callLadderCampaigns(), currency);
  const [outcomes, subs] = await Promise.all([
    loadTaskOutcomes(tasks),
    loadSubsSplit(orders),
  ]);

  return {
    tasks: basis.tasks,
    invoices: basis.invoices,
    invoicesPaid: basis.paid,
    invoicesCreditMemo: basis.creditMemo,
    invoicesOpen: basis.open,
    ...subs,
    recovered: outcomes.recovered,
    stillOpen: outcomes.stillOpen,
    // Every basis task is chasing a basis invoice by construction, so this is the task
    // count. Kept because the contract carries it and a non-run campaign still differs.
    tasksWithInvoice: basis.tasks,
    atRisk: basis.declined,
    /** Cycle Performance's Collected to Date, read from the same invoices. */
    invoiceCollected: basis.collected,
    taskRate: basis.tasks > 0 ? +((outcomes.recovered / basis.tasks) * 100).toFixed(1) : null,
  };
}

/**
 * Campaigns with no failed charge behind them — Check, Expiring CC, Sales AR.
 *
 * They hold no recurring invoice at all, so the declined basis is empty for them and
 * applying it would erase a page rather than correct one. Their effort is real and is
 * reported task-anchored; only the dollar denominator is absent, which `atRisk: null`
 * says explicitly so no rate is drawn.
 */
async function loadNonRunCohort(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
) {
  const scope = agentScope(filters, fromKey, toKey, callLadderCampaigns());
  const cohortTasks: SqlFragment = {
    sql: `SELECT f.task_id FROM ie_fact_collections_task f ${scope.joinSql} ${scope.whereSql}`,
    params: scope.params,
  };
  const cohortOrders: SqlFragment = {
    sql: `SELECT ci.order_id FROM ie_fact_collections_invoice ci
           WHERE ci.task_id IN (${cohortTasks.sql})`,
    params: cohortTasks.params,
  };

  const [[inv]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`invoices\`,
            SUM(ci.cash_collected > 0) AS \`paid\`,
            SUM(ci.cash_collected = 0 AND ci.credit_memo_amount > 0) AS \`creditMemo\`,
            SUM(ci.cash_collected = 0 AND ci.credit_memo_amount = 0) AS \`open\`,
            SUM(ci.cash_collected) AS \`collected\`,
            COUNT(DISTINCT ci.task_id) AS \`tasksWithInvoice\`
       FROM ie_fact_collections_invoice ci
      WHERE ci.task_id IN (${cohortTasks.sql})`,
    cohortTasks.params,
  );
  const [outcomes, subs] = await Promise.all([
    loadTaskOutcomes(cohortTasks),
    loadSubsSplit(cohortOrders),
  ]);

  return {
    tasks: outcomes.tasks,
    invoices: num(inv?.invoices),
    invoicesPaid: num(inv?.paid),
    invoicesCreditMemo: num(inv?.creditMemo),
    invoicesOpen: num(inv?.open),
    ...subs,
    recovered: outcomes.recovered,
    stillOpen: outcomes.stillOpen,
    tasksWithInvoice: num(inv?.tasksWithInvoice),
    atRisk: null as number | null,
    invoiceCollected: Math.round(num(inv?.collected)),
    taskRate: outcomes.tasks > 0
      ? +((outcomes.recovered / outcomes.tasks) * 100).toFixed(1)
      : null,
  };
}

/**
 * Close the headline with the cash.
 *
 * `collected` IS THE INVOICE FACT'S, so the tile equals Cycle Performance's Collected to
 * Date on the same cohort. It used to be the sum of the published rungs, which made the
 * tile agree with the bars beneath it but not with the validated report — and the whole
 * point of this page's headline is that it ties back.
 *
 * `ladderCollected` is what the rungs actually add up to, reported beside it rather than
 * reconciled away. A gap means cash landed on a basis invoice that the recovery fact
 * never attributed to this cohort's tasks, and that is a real finding about attribution,
 * not a rounding artifact to be hidden by choosing whichever total looks tidier.
 */
export function withCollected<T extends { atRisk: number | null; invoiceCollected: number }>(
  cohort: T,
  ladderCollected: number,
) {
  const { atRisk, invoiceCollected } = cohort;
  return {
    ...cohort,
    collected: invoiceCollected,
    ladderCollected,
    unattributed: invoiceCollected - ladderCollected,
    dollarRate: atRisk && atRisk > 0
      ? +((invoiceCollected / atRisk) * 100).toFixed(1)
      : null,
  };
}

/**
 * Retention / churn / reactivation for the cohort.
 *
 * COHORT-scoped like everything else on the page. It read the subscription fact's own
 * `date_key` before, which is a calendar slice — so the retention panel described a
 * different population from the ladder directly above it.
 *
 * The subscription fact carries no employee key, so a viewer on SELF or DEPARTMENT
 * scope still sees org-wide counts here; that is tracked in the known-issues backlog
 * and is moot while the only grants are ALL.
 */
export async function loadSubscriptionSummary(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
) {
  const scope = cohortScope(filters, fromKey, toKey, {
    withEmployee: false, campaignKeys: callLadderCampaigns(),
  });

  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(CASE WHEN f.outcome = 'RETAINED' THEN 1 ELSE 0 END) AS \`retained\`,
            SUM(CASE WHEN f.outcome = 'TERMINATED' AND f.is_ar_reason = 1 THEN 1 ELSE 0 END) AS \`terminated\`,
            SUM(CASE WHEN f.outcome = 'TERMINATED' AND f.is_ar_reason = 0 THEN 1 ELSE 0 END) AS \`terminatedOther\`,
            SUM(CASE WHEN f.outcome = 'REACTIVATED' THEN 1 ELSE 0 END) AS \`reactivated\`,
            SUM(CASE WHEN f.outcome = 'RETAINED' THEN f.mrr_amount ELSE 0 END) AS \`retainedMrr\`,
            SUM(CASE WHEN f.outcome = 'TERMINATED' AND f.is_ar_reason = 1 THEN f.mrr_amount ELSE 0 END) AS \`lostMrr\`
       FROM ie_fact_collections_subscription f
       ${scope.joinSql}
       ${scope.whereSql}`,
    scope.params,
  );
  const [statusRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.status_at_outcome AS \`status\`, COUNT(*) AS \`count\`
       FROM ie_fact_collections_subscription f
       ${scope.joinSql}
       ${scope.whereSql} AND f.outcome = 'TERMINATED' AND f.is_ar_reason = 1
      GROUP BY f.status_at_outcome
      ORDER BY \`count\` DESC
      LIMIT 12`,
    scope.params,
  );
  return {
    retained: num(row?.retained),
    terminated: num(row?.terminated),
    terminatedOther: num(row?.terminatedOther),
    reactivated: num(row?.reactivated),
    retainedMrr: Math.round(num(row?.retainedMrr)),
    lostMrr: Math.round(num(row?.lostMrr)),
    terminatedByStatus: statusRows.map((r) => ({ status: (r.status as string) ?? '—', count: num(r.count) })),
  };
}
