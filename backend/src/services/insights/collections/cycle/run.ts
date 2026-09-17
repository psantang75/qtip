/**
 * Stage 1 — the run.
 *
 * Every invoice the recurring run produced, by what the gateway said that day. This
 * is the denominator the rest of the page narrows down from, and the only figure on
 * the Collections section that can be looked up in CRM as a single number.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import { money, num } from '../../../insightsCollections.shared';
import { parts, type CycleScope, type OutcomeRow, type ReasonRow } from './scope';
import { BILLING_JOIN, repeatJoin, IS_REPEAT, RESULT_CASE } from './joins';

export async function getRunOutcomes({ whereSql, params }: CycleScope): Promise<OutcomeRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RESULT_CASE}        AS result,
            COUNT(*)              AS invoices,
            SUM(i.invoice_amount) AS amount
       FROM ie_fact_collections_invoice i ${BILLING_JOIN}
      ${whereSql}
      GROUP BY result`,
    params,
  );

  return rows.map((r) => ({
    result: String(r.result),
    invoices: num(r.invoices),
    amount: money(r.amount),
  }));
}

/**
 * Why the charges failed, by invoice, and how much of it we had already seen.
 *
 * Read off the winning billing row, so an invoice that declined on one group and was
 * rescued on another the same day is counted once, under the reason it declined for.
 *
 * The repeat columns are the efficiency lens: a first decline is unavoidable, but a
 * billing group declining again inside a year means the same card is still on file
 * and we are paying an agent to chase a failure we generated. Split by reason,
 * because a repeat "Insufficient Funds" is a payment-timing conversation while a
 * repeat "Closed Account" is a card that can never work and should never have been
 * re-run.
 */
export async function getDeclineReasons(scope: CycleScope): Promise<ReasonRow[]> {
  const joins = parts(BILLING_JOIN, repeatJoin(scope));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT IFNULL(b.decline_reason, 'Unspecified') AS reason,
            COUNT(*)                                AS invoices,
            SUM(i.invoice_amount)                   AS amount,
            SUM(${IS_REPEAT})                       AS repeat_invoices,
            SUM(CASE WHEN ${IS_REPEAT} THEN i.invoice_amount ELSE 0 END) AS repeat_amount
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} AND b.first_result = 'DECLINED'
      GROUP BY IFNULL(b.decline_reason, 'Unspecified')
      ORDER BY invoices DESC`,
    [...joins.params, ...scope.params],
  );

  return rows.map((r) => ({
    reason: String(r.reason),
    invoices: num(r.invoices),
    amount: money(r.amount),
    repeatInvoices: num(r.repeat_invoices),
    repeatAmount: money(r.repeat_amount),
  }));
}
