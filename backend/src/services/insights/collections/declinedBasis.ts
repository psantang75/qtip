/**
 * THE declined basis — the one population Campaign × Touch is allowed to measure.
 *
 * IT IS CYCLE PERFORMANCE'S POPULATION, BY CONSTRUCTION. Cycle Performance is the
 * validated report, and every figure here is read from the same rows with the same
 * predicate it uses in `cycle/scope.ts` + `b.first_result = 'DECLINED'`: recurring
 * invoices in the window, one campaign, one currency, that declined on the run. No
 * second definition, so the two pages cannot drift.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG. Campaign × Touch built its four opening
 * tiles from THREE different populations, none of them Cycle Performance's. Measured on
 * Declined CC (1st), September 2026:
 *
 *   Cycle Performance declined       333 invoices   $58,604 declined   $50,430 collected
 *   "Declined Dollars" tile          358 ACCOUNTS   $65,054            (gateway log)
 *   Invoices / Tasks / Subs tiles    377 invoices   $114,805 invoiced  (task-anchored)
 *
 * The dollars came from `declinedPool`, which reads the gateway attempt log at BILLING
 * GROUP grain — a different unit from an invoice, so its total could never equal the
 * invoice figure the reader was comparing it to. The counts came from the task fact:
 * every invoice attached to a task raised in the window, which sweeps in invoices that
 * never declined at all. $114,805 against $58,604 declined is the size of that leak.
 * Both errors then fed the recovery rate, which is why it read 77.6% instead of 86.0%.
 *
 * THE GATEWAY POOL IS GONE. `declinedPool.ts` bypassed invoices because CRM once wrote
 * no recurring invoice for a failed charge — "of the 277 accounts that declined on the
 * 2026-08-01 run, 154 have an invoice dated that day and 123 have none at all". That
 * stopped being true once the invoice extract was fixed: of September's 358 declined pool
 * groups, 358 have an invoice and ZERO do not, so the workaround contributed nothing but
 * its own error. It survived only because Channel Effectiveness still read it, and it was
 * deleted with that report. Its two still-useful pieces — the `SqlFragment` shape and
 * campaign resolution — moved here, where the basis they serve is defined.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';
import {
  type CollectionsFilters,
  DEFAULT_CURRENCY,
  campaignKeyForLabel,
  num,
} from '../../insightsCollections.shared';

/** A composable piece of SQL and the binds that go with it. */
export interface SqlFragment {
  sql: string;
  params: Array<string | number>;
}

/**
 * Resolve the selected campaign to a key the caller's report can measure, or undefined
 * for the aggregate. A label outside scope resolves to undefined rather than filtering
 * to a campaign the measure has no pool for.
 */
export function scopedCampaignKey(
  filters: CollectionsFilters,
  campaignKeys: readonly string[],
): string | undefined {
  const key = filters.campaign ? campaignKeyForLabel(filters.campaign) : undefined;
  return key && campaignKeys.includes(key) ? key : undefined;
}

/**
 * The scope predicate against an arbitrary alias, so every read below and every
 * restriction handed to the ladder is literally the same test.
 *
 * `recurring_id IS NOT NULL` is the run gate Cycle Performance calls its spine: across
 * the warehouse all 248,015 order-type-3 invoices carry a run id and the 14,766 type-1/6
 * ones never do, so it is exactly "the recurring run's own output".
 *
 * The currency test is not optional here. Amounts are rendered behind a "$" with no
 * exchange rate involved, so mixing currencies adds unlike units.
 */
export function declinedBasisWhere(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  campaignKeys: readonly string[],
  currency: string = DEFAULT_CURRENCY,
  alias = 'i',
): SqlFragment {
  const key = scopedCampaignKey(filters, campaignKeys);
  const where = [`${alias}.date_key BETWEEN ? AND ?`, `${alias}.recurring_id IS NOT NULL`];
  const params: Array<string | number> = [fromKey, toKey];

  if (key) {
    where.push(`${alias}.campaign_key = ?`);
    params.push(key);
  } else {
    where.push(`${alias}.campaign_key IN (${campaignKeys.map(() => '?').join(',')})`);
    params.push(...campaignKeys);
  }

  where.push(`${alias}.currency_code = ?`);
  params.push(currency);

  // DECLINED WINS, so a bare EXISTS is exact rather than an approximation of the
  // precedence join Cycle Performance uses. That join picks one billing row per
  // (order, day) ordered DECLINED > ERROR > VOIDED > OK > IN_FLIGHT and then tests it
  // for DECLINED — which selects a row if and only if a declined row exists at all.
  where.push(`EXISTS (
        SELECT 1 FROM ie_fact_collections_billing db
         WHERE db.order_id = ${alias}.order_id
           AND db.date_key = ${alias}.date_key
           AND db.first_result = 'DECLINED')`);

  return { sql: where.join(' AND '), params };
}

/** The basis invoices, for an `order_id IN (...)` restriction on recovery or subscriptions. */
export function basisOrdersSql(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  campaignKeys: readonly string[],
  currency: string = DEFAULT_CURRENCY,
): SqlFragment {
  const w = declinedBasisWhere(filters, fromKey, toKey, campaignKeys, currency, 'bo');
  return {
    sql: `SELECT bo.order_id FROM ie_fact_collections_invoice bo WHERE ${w.sql}`,
    params: w.params,
  };
}

/**
 * The tasks chasing those invoices, for a `task_id IN (...)` restriction on touches.
 *
 * Read off the invoice rather than the task fact on purpose: a task is in scope because
 * it is chasing a declined invoice, not because it happened to be raised in the window.
 * That distinction is 332 tasks against the 395 the task-anchored scope returned.
 */
export function basisTasksSql(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  campaignKeys: readonly string[],
  currency: string = DEFAULT_CURRENCY,
): SqlFragment {
  const w = declinedBasisWhere(filters, fromKey, toKey, campaignKeys, currency, 'bt');
  return {
    sql: `SELECT bt.task_id FROM ie_fact_collections_invoice bt
           WHERE ${w.sql} AND bt.task_id IS NOT NULL`,
    params: w.params,
  };
}

/** The opening position: what the run declined, and where those invoices ended up. */
export interface DeclinedBasis {
  /** Invoices that declined on the run — the population every other tile describes. */
  invoices: number;
  /** Dollars on them. This is the denominator for every rate on the page. */
  declined: number;
  /** Cash applied to those same invoices, as Cycle Performance reports it. */
  collected: number;
  paid: number;
  creditMemo: number;
  open: number;
  /** Tasks raised to chase them. */
  tasks: number;
}

export async function loadDeclinedBasis(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  campaignKeys: readonly string[],
  currency: string = DEFAULT_CURRENCY,
): Promise<DeclinedBasis> {
  const w = declinedBasisWhere(filters, fromKey, toKey, campaignKeys, currency);

  // CASH IS TESTED FIRST, matching `PATH_CASE` in cycle/recoveryJoins.ts: an invoice
  // both part-paid and part-memoed is PAID on both pages rather than written off on one
  // of them. The three buckets partition the count exactly, so paid + creditMemo + open
  // always equals invoices.
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*)                        AS \`invoices\`,
            SUM(i.invoice_amount)           AS \`declined\`,
            SUM(i.cash_collected)           AS \`collected\`,
            SUM(i.cash_collected > 0)       AS \`paid\`,
            SUM(i.cash_collected = 0 AND i.credit_memo_amount > 0)  AS \`creditMemo\`,
            SUM(i.cash_collected = 0 AND i.credit_memo_amount = 0)  AS \`open\`,
            COUNT(DISTINCT i.task_id)       AS \`tasks\`
       FROM ie_fact_collections_invoice i
      WHERE ${w.sql}`,
    w.params,
  );

  return {
    invoices: num(row?.invoices),
    declined: Math.round(num(row?.declined)),
    collected: Math.round(num(row?.collected)),
    paid: num(row?.paid),
    creditMemo: num(row?.creditMemo),
    open: num(row?.open),
    tasks: num(row?.tasks),
  };
}
