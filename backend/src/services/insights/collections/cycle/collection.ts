/**
 * Stage 3 — what came back, and the invoice list behind all of it.
 *
 * Cash is only ever counted against the invoice it was applied to, so money from the
 * next cycle cannot be credited to this run's recovery. Credit memos are reported
 * separately from cash: a written-off invoice is a closed task but not a collection.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import { campaignLabel, money, num } from '../../../insightsCollections.shared';
import {
  parts,
  type CycleScope, type PathRow, type CycleInvoiceRow, type CurrencyTotal,
} from './scope';
import { BILLING_JOIN, TASK_JOIN, touchJoin, RESULT_CASE, repeatJoin, IS_REPEAT } from './joins';
import { pathJoins, PATH_CASE, PAYER_CLASS, DIFFERENT_CARD, originalStillJoin } from './recoveryJoins';

/**
 * Every currency in the window, whether or not it is the one being displayed.
 *
 * The page reports one currency at a time so its totals mean something, which on its
 * own would make the others disappear — a worse failure than mixing them, because it
 * is silent. This is deliberately scoped WITHOUT the currency predicate so the UI can
 * always say what else is in the period and how much of it there is.
 *
 * An invoice whose currency the source never recorded is reported under an empty code
 * rather than being folded into USD, so an unresolved denomination stays visible.
 */
export async function getCurrencyTotals({ whereSql, params }: CycleScope): Promise<CurrencyTotal[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT IFNULL(i.currency_code, '') AS currency,
            COUNT(*)                    AS invoices,
            SUM(i.invoice_amount)       AS invoiced,
            SUM(i.cash_collected)       AS collected
       FROM ie_fact_collections_invoice i
      ${whereSql}
      GROUP BY IFNULL(i.currency_code, '')
      ORDER BY invoiced DESC`,
    params,
  );

  return rows.map((r) => ({
    currency: String(r.currency ?? ''),
    invoices: num(r.invoices),
    invoiced: money(r.invoiced),
    collected: money(r.collected),
  }));
}

export async function getRecoveryPaths(scope: CycleScope): Promise<PathRow[]> {
  const joins = parts(BILLING_JOIN, pathJoins(scope), originalStillJoin(scope));
  const [rows] = await pool.query<RowDataPacket[]>(
    // Cash comes from the invoice, not the recovery fact: recovery only admits money
    // on accounts we were chasing, so an invoice paid outside that gate showed up in a
    // path bucket with $0 against it. i.cash_collected is a superset of r.collected by
    // construction, so no bucket can lose money by reading it here.
    `SELECT ${PATH_CASE}                AS path,
            COUNT(*)                    AS invoices,
            SUM(i.invoice_amount)       AS invoiced,
            SUM(i.cash_collected)       AS collected,
            SUM(${DIFFERENT_CARD} AND os.last_key IS NOT NULL)
                                        AS original_still_charged
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} AND b.first_result = 'DECLINED'
      GROUP BY path
      ORDER BY invoices DESC`,
    [...joins.params, ...scope.params],
  );

  return rows.map((r) => ({
    path: String(r.path),
    invoices: num(r.invoices),
    invoiced: money(r.invoiced),
    collected: money(r.collected),
    originalStillCharged: num(r.original_still_charged),
  }));
}

/**
 * Write-offs, on both populations and with the partial ones called out.
 *
 * TWO POPULATIONS, BOTH NAMED. This used to report a single figure covering every
 * invoice in the cycle, sitting beside recovery paths that cover declined invoices
 * only — so the section invited a comparison between two different denominators. On
 * 2026-08 that is 60,394.43 against 13,965.97, and nothing on the page said they were
 * not the same population. Both are returned and labelled: `declined` matches every
 * other stage-3 measure, `allCycle` is the whole ledger, and the reader picks.
 *
 * PARTIAL IS NOT WRITTEN OFF. A memo that clears a remainder after most of the invoice
 * was paid is a rounding-down, not an abandonment, and counting its invoice among the
 * write-offs overstates what we gave up. Invoice 1943200 is the clearest: 8,600.00
 * invoiced, 8,084.00 collected in cash, 516.00 memoed. 1928520, 1936494, 1939569 and
 * 1943490 are the same shape. They are reported separately, with the cash beside the
 * memo, so "we wrote this off" is only ever said about an invoice where no cash came in.
 */
export async function getCreditMemos({ whereSql, params }: CycleScope) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(b.first_result = 'DECLINED')                    AS declined_invoices,
            SUM(CASE WHEN b.first_result = 'DECLINED'
                     THEN i.credit_memo_amount ELSE 0 END)      AS declined_amount,
            COUNT(*)                                            AS all_invoices,
            SUM(i.credit_memo_amount)                           AS all_amount,
            SUM(i.cash_collected > 0)                           AS partial_invoices,
            SUM(CASE WHEN i.cash_collected > 0
                     THEN i.credit_memo_amount ELSE 0 END)      AS partial_memo,
            SUM(CASE WHEN i.cash_collected > 0
                     THEN i.cash_collected ELSE 0 END)          AS partial_cash
       FROM ie_fact_collections_invoice i ${BILLING_JOIN}
      ${whereSql} AND i.credit_memo_amount > 0`,
    params,
  );

  return {
    declined: { invoices: num(row?.declined_invoices), amount: money(row?.declined_amount) },
    allCycle: { invoices: num(row?.all_invoices), amount: money(row?.all_amount) },
    partial: {
      invoices: num(row?.partial_invoices),
      memoAmount: money(row?.partial_memo),
      cashAmount: money(row?.partial_cash),
    },
  };
}

/**
 * The invoice list behind the summary — the drill the other Collections pages lack,
 * and the thing that can be walked against CRM row by row.
 *
 * Capped rather than paginated: a run's decline population is a few hundred rows a
 * month, and the cap only bites if someone selects a year at once.
 */
export async function getCycleInvoiceRows(
  scope: CycleScope,
  opts: { result?: string; reason?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: CycleInvoiceRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const offset = Math.max(opts.offset ?? 0, 0);

  // Filter THROUGH RESULT_CASE rather than restating it. Only two of the six buckets
  // are a literal on first_result; the rest are all "no billing row", separated by the
  // run's payment type and the card state. A second copy of that ladder drifts the
  // moment a bucket is added — which is exactly what splitting NO_CHARGE would have done.
  const extra: string[] = [];
  const extraParams: Array<string | number> = [];
  if (opts.result === 'OUTSTANDING') {
    extra.push("b.first_result = 'DECLINED'");
    extra.push('i.open_balance > 0');
  } else if (opts.result) {
    extra.push(`${RESULT_CASE} = ?`);
    extraParams.push(opts.result);
  }
  // A specific decline reason narrows to a single failure cause. Matched with the same
  // IFNULL(...,'Unspecified') the decline-reason breakdown groups by, so a row here is
  // exactly one of the reasons the Failed Charge buttons offer — no drift between the
  // count on the button and the population it opens.
  if (opts.reason) {
    extra.push("IFNULL(b.decline_reason, 'Unspecified') = ?");
    extraParams.push(opts.reason);
  }

  const joins = parts(
    BILLING_JOIN, repeatJoin(scope), TASK_JOIN, touchJoin(scope), pathJoins(scope),
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    // Dates are formatted in SQL rather than read off a driver Date: mysql2 hands
    // back a DATE as local midnight, so an 08-01 invoice stringified to "Jul 31" in
    // any timezone behind UTC. Formatting here keeps the calendar day the DB stores.
    `SELECT i.order_id, i.customer_id, i.campaign_key, i.invoice_amount, i.currency_code,
            DATE_FORMAT(i.order_date, '%Y-%m-%d')      AS order_date,
            ${RESULT_CASE}                        AS result,
            -- A submission error is our own failure and the gateway said why, so the
            -- reason column carries its message too. decline_reason stays NULL outside
            -- DECLINED in the fact, which is what kept ERROR unexplainable here.
            COALESCE(b.decline_reason,
                     CASE WHEN b.first_result = 'ERROR' THEN b.result_message END)
                                                  AS decline_reason,
            -- Same wasted-effort measure the decline-reason breakdown counts: this
            -- billing group declined again within a year, so the same card is still on
            -- file and still failing. Read off the winning billing row REPEAT_JOIN pins
            -- to, so a two-group day cannot flag one invoice as a repeat twice.
            ${IS_REPEAT}                          AS is_repeat,
            b.billing_group_id AS charge_bg, b.charge_last4,
            t.task_id, t.final_status_label, t.agent_email AS task_agent,
            i.task_link_source,
            IFNULL(tw.touches_before, 0)          AS touches,
            IFNULL(tc.touches, 0)                 AS touches_lifetime,
            IFNULL(tw.touches_same_second, 0)     AS touches_same_second,
            ${PATH_CASE}                          AS path,
            -- The invoice's own applied cash, for the same reason PATH_CASE falls back
            -- to it: an invoice the run collected has no recovery row to read.
            i.cash_collected                      AS collected,
            DATE_FORMAT(COALESCE(r.first_paid_on, i.paid_on), '%Y-%m-%d') AS first_paid_on,
            ${PAYER_CLASS}                        AS processor_class,
            COALESCE(r.processor_name, r.agent_email) AS agent_email,
            i.credit_memo_amount, i.open_balance
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} ${extra.length ? `AND ${extra.join(' AND ')}` : ''}
      -- order_id is the unique tie-breaker. Without it two invoices sharing a date and
      -- an amount could swap places between pages, so a row could be served twice or
      -- not at all while the caller pages through.
      ORDER BY i.date_key DESC, i.invoice_amount DESC, i.order_id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [...joins.params, ...scope.params, ...extraParams],
  );

  // Counted over the same predicate, so the caller can tell a full population from the
  // page it was handed. The cap used to be applied silently: August's declined cohort
  // ran past the 500 default and the grid simply ended, with nothing saying so.
  const [[totalRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM ie_fact_collections_invoice i
            ${BILLING_JOIN}
      ${scope.whereSql} ${extra.length ? `AND ${extra.join(' AND ')}` : ''}`,
    [...scope.params, ...extraParams],
  );

  const mapped = rows.map((r) => ({
    orderId: num(r.order_id),
    customerId: r.customer_id == null ? null : num(r.customer_id),
    orderDate: r.order_date ? String(r.order_date) : '',
    campaign: r.campaign_key == null ? '' : campaignLabel(String(r.campaign_key)),
    amount: money(r.invoice_amount),
    currency: r.currency_code ? String(r.currency_code) : '',
    result: String(r.result),
    declineReason: r.decline_reason ? String(r.decline_reason) : null,
    isRepeat: num(r.is_repeat) === 1,
    chargeBillingGroupId: r.charge_bg == null ? null : num(r.charge_bg),
    chargeLast4: r.charge_last4 ? String(r.charge_last4) : null,
    taskId: r.task_id == null ? null : num(r.task_id),
    taskStatus: r.final_status_label ? String(r.final_status_label) : null,
    taskAgent: r.task_agent ? String(r.task_agent) : null,
    taskLinkSource: r.task_link_source ? String(r.task_link_source) : null,
    touches: num(r.touches),
    touchesLifetime: num(r.touches_lifetime),
    touchesSameSecond: num(r.touches_same_second),
    recoveryPath: String(r.path),
    collected: money(r.collected),
    paidOn: r.first_paid_on ? String(r.first_paid_on) : null,
    processor: r.agent_email ? String(r.agent_email) : null,
    processorClass: r.processor_class ? String(r.processor_class) : null,
    creditMemoAmount: money(r.credit_memo_amount),
    openBalance: money(r.open_balance),
  }));

  return { rows: mapped, total: num(totalRow?.total) };
}