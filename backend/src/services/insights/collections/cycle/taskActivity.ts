/**
 * Stage 2 — what AR actually did about the declines.
 *
 * Narrowed to the invoices the run declined, because a processed invoice raises no
 * task. Four questions, in the order the AR review asks them:
 *
 *   1. Did the decline even get picked up? (coverage)
 *   2. Who ended up taking the money? (processor split)
 *   3. Where did the task end up? (final CRM status)
 *   4. How much outreach did it take? (touch bands)
 *
 * Every measure carries collected cash alongside the count, so "we worked it" and
 * "we got paid" are never conflated — the 2026-08-01 review found tasks closed as
 * Paid on accounts where no cash had been applied at all.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import { money, num } from '../../../insightsCollections.shared';
import {
  parts,
  type CycleScope, type CoverageRow, type ProcessorRow, type ProcessorSplit,
  type StatusRow, type TouchBandRow,
} from './scope';
import { BILLING_JOIN, TASK_JOIN, TASK_LINK_CASE, touchJoin } from './joins';
import { recoveryAggJoin, PROCESSOR_CASE, PROCESSOR_SPLIT_SELECT } from './recoveryJoins';

const DECLINED_ONLY = "AND b.first_result = 'DECLINED'";

const mapSplit = (r: RowDataPacket): ProcessorSplit => ({
  selfInvoices: num(r.self_invoices),
  selfCollected: money(r.self_collected),
  agentInvoices: num(r.agent_invoices),
  agentCollected: money(r.agent_collected),
  systemInvoices: num(r.system_invoices),
  systemCollected: money(r.system_collected),
  memoInvoices: num(r.memo_invoices),
  memoAmount: money(r.memo_amount),
  openInvoices: num(r.open_invoices),
  openAmount: money(r.open_amount),
});

/**
 * Declines that reached a task versus those that were never picked up.
 *
 * Three states, not two: an invoice can also land inside a collection effort that was
 * already running, which raises no new task and used to read as "No task raised". See
 * TASK_LINK_CASE.
 */
export async function getTaskCoverage({ whereSql, params }: CycleScope): Promise<{
  coverage: CoverageRow[]
  outstanding: { invoices: number; amount: number }
}> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${TASK_LINK_CASE}            AS bucket,
            COUNT(*)                    AS invoices,
            SUM(i.invoice_amount)       AS amount,
            SUM(i.cash_collected)       AS collected,
            SUM(i.open_balance > 0)     AS outstanding_invoices,
            SUM(CASE WHEN i.open_balance > 0 THEN i.open_balance ELSE 0 END) AS outstanding
       FROM ie_fact_collections_invoice i ${BILLING_JOIN}
      ${whereSql} ${DECLINED_ONLY}
      GROUP BY bucket
      ORDER BY invoices DESC`,
    params,
  );

  return {
    coverage: rows.map((r) => ({
      bucket: String(r.bucket),
      invoices: num(r.invoices),
      amount: money(r.amount),
      collected: money(r.collected),
    })),
    outstanding: {
      invoices: rows.reduce((a, r) => a + num(r.outstanding_invoices), 0),
      amount: money(rows.reduce((a, r) => a + num(r.outstanding), 0)),
    },
  };
}

/**
 * Who took the payment on each declined invoice.
 *
 * The headline of stage 2, and not the one the section title implies: on August 2026
 * the customer's own portal returned 61% of recovered cash against the agents' 38%,
 * at a higher average ticket. Self-service is the largest collections channel we
 * have, so it is reported as a peer of agent effort rather than folded into it.
 */
export async function getProcessorSplit(scope: CycleScope): Promise<ProcessorRow[]> {
  const joins = parts(BILLING_JOIN, recoveryAggJoin(scope));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${PROCESSOR_CASE}           AS who,
            COUNT(*)                    AS invoices,
            SUM(i.invoice_amount)       AS amount,
            SUM(IFNULL(r.collected, 0)) AS collected
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} ${DECLINED_ONLY}
      GROUP BY who
      ORDER BY collected DESC`,
    [...joins.params, ...scope.params],
  );

  return rows.map((r) => ({
    who: String(r.who),
    invoices: num(r.invoices),
    amount: money(r.amount),
    collected: money(r.collected),
  }));
}

/** Where the task finished, as the agent left it in CRM. */
export async function getTaskStatuses(scope: CycleScope): Promise<StatusRow[]> {
  const joins = parts(BILLING_JOIN, TASK_JOIN, recoveryAggJoin(scope));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT IFNULL(t.final_status_label, 'Still Open') AS status,
            COUNT(*)                    AS invoices,
            SUM(i.invoice_amount)       AS amount,
            SUM(IFNULL(r.collected, 0)) AS collected,
            ${PROCESSOR_SPLIT_SELECT}
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} ${DECLINED_ONLY} AND t.task_id IS NOT NULL
      GROUP BY status
      ORDER BY invoices DESC`,
    [...joins.params, ...scope.params],
  );

  return rows.map((r) => ({
    status: String(r.status),
    invoices: num(r.invoices),
    amount: money(r.amount),
    collected: money(r.collected),
    ...mapSplit(r),
  }));
}

/**
 * How much outreach each decline took BEFORE it was resolved.
 *
 * Banded rather than averaged: the distribution is heavily zero-weighted (a large
 * share of 2026-08-01 declines were resolved with no logged touch at all, because
 * the customer paid through the portal), and a mean hides that entirely.
 *
 * Banded on pre-resolution touches, not lifetime ones. Counting a task's whole life
 * presented work done after the money arrived as work that brought it in — see
 * TOUCH_JOIN for the 1919497 walk-through. Same-second touches are excluded from the
 * band rather than guessed at, and returned separately so the caller can disclose how
 * much of the population has an unresolved ordering.
 *
 * Read the bands as a symptom, not a cause. An account that pays on the first notice
 * is never touched again, and one that will not pay keeps getting worked, so a high
 * band is where the effort went rather than what lost the money.
 */
export async function getTouchBands(scope: CycleScope): Promise<TouchBandRow[]> {
  const joins = parts(BILLING_JOIN, TASK_JOIN, touchJoin(scope), recoveryAggJoin(scope));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CASE
              WHEN IFNULL(tw.touches_before, 0) = 0 THEN 'No Touch Logged'
              WHEN tw.touches_before = 1            THEN '1 Touch'
              WHEN tw.touches_before = 2            THEN '2 Touches'
              ELSE '3 or More Touches'
            END                              AS band,
            COUNT(*)                         AS invoices,
            SUM(i.invoice_amount)            AS amount,
            SUM(IFNULL(r.collected, 0))      AS collected,
            SUM(IFNULL(tw.touches_after, 0)) AS touches_after,
            SUM(IFNULL(tw.touches_same_second, 0) > 0) AS unresolved_order,
            ${PROCESSOR_SPLIT_SELECT}
       FROM ie_fact_collections_invoice i ${joins.sql}
      ${scope.whereSql} ${DECLINED_ONLY} AND t.task_id IS NOT NULL
      GROUP BY band
      ORDER BY MIN(IFNULL(tw.touches_before, 0))`,
    [...joins.params, ...scope.params],
  );

  return rows.map((r) => ({
    band: String(r.band),
    invoices: num(r.invoices),
    amount: money(r.amount),
    collected: money(r.collected),
    touchesAfter: num(r.touches_after),
    unresolvedOrder: num(r.unresolved_order),
    ...mapSplit(r),
  }));
}
