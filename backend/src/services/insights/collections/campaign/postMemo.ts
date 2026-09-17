/**
 * What happens AFTER an invoice is written off.
 *
 * The page treated a credit memo as the end of the story, and it is not. Shutting a
 * service off is what raises the memo, but the task stays open and keeps being worked:
 * across 2025-06..2026-09 the four recurring runs memoed 2,057 invoices worth
 * $333,269.79, and 1,605 of those tasks (79%) were touched AGAIN afterwards, 4,679
 * times in total. 275 of them came back on a reactivation invoice carrying $27,352.87
 * of cash. None of that effort or recovery was visible anywhere on the report.
 *
 * MEASURED FROM `credit_memo_on`, which the invoice fact populates on every memoed row
 * (2,057 of 2,057), so "after the memo" is an exact comparison rather than an estimate.
 *
 * THE MEMO POPULATION IS THE TILE'S POPULATION. `cash_collected = 0` matches the CM
 * bucket in the Starting Point invoice split, which tests cash before the memo the way
 * Cycle Performance does. An invoice part-paid and part-memoed is reported as paid on
 * both, so it is not counted here either — otherwise this section would claim recovery
 * the invoice row already counted as collected.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import {
  type CollectionsFilters,
  callLadderCampaigns,
  DEFAULT_CURRENCY,
  num,
} from '../../../insightsCollections.shared';
import { basisOrdersSql } from '../declinedBasis';

export interface PostMemoRecovery {
  /** Invoices written off with no cash against them. */
  invoices: number;
  /** Dollars written off on those invoices. */
  dollars: number;
  /** Tasks holding them. */
  tasks: number;
  /** Of those tasks, the ones touched again after the memo was raised. */
  tasksWorkedAfter: number;
  /** Touches logged after the memo — effort the ladder above cannot show. */
  touchesAfter: number;
  /** Reactivation invoices raised on the same billing group after the memo. */
  reactivationInvoices: number;
  /** Cash collected on those reactivation invoices. */
  reactivationCash: number;
}

/** Reactivation cash placed on the rung that was working the task when it came back. */
export interface ReactivationRung {
  /** The numbered touch it follows, or null when no touch preceded it. */
  seq: number | null;
  invoices: number;
  dollars: number;
  /** Services on the cohort's own invoices that came back, one rung each. */
  subs: number;
}

/**
 * Reactivation recovery, per touch rung.
 *
 * WHY IT CANNOT RIDE THE ORDINARY LADDER. Every other dollar on this page is cash
 * applied to a declined invoice, which the recovery fact attributes to a rung directly.
 * A reactivation is not that: the original invoice was written off and stays at zero
 * forever, and the money arrives on a NEW invoice that no rung can see. Folding it into
 * `incrementalDollars` would also break the page's tie to Cycle Performance, whose
 * Collected to Date counts cash on the declined invoices only.
 *
 * ATTRIBUTED TO THE LAST NUMBERED TOUCH BEFORE THE NEW INVOICE WAS RAISED, on the
 * memoed invoice's own task. That is the same rule the recovery fact applies to a
 * payment, so the two series answer the same question about effort. `touch_seq` rises
 * with time on a task, so the greatest sequence before that date IS the latest touch.
 *
 * Reactivations with no preceding touch return `seq: null` and belong to the no-touch
 * baseline, exactly as untouched payments do.
 *
 * DEDUPED TO ONE ROW PER REACTIVATION INVOICE. A billing group that was memoed twice
 * matches the same replacement invoice from both, which would count its cash twice.
 */
export async function loadReactivationRungs(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  currency: string = DEFAULT_CURRENCY,
): Promise<ReactivationRung[]> {
  const scope = basisOrdersSql(filters, fromKey, toKey, callLadderCampaigns(), currency);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT z.seq AS \`seq\`,
            COUNT(*)      AS \`invoices\`,
            SUM(z.cash)   AS \`dollars\`
       FROM (
         SELECT ni.order_id,
                MAX(ni.cash_collected) AS cash,
                MAX((SELECT MAX(tc.touch_seq)
                       FROM ie_fact_collections_touch tc
                      WHERE tc.task_id = ci.task_id
                        AND tc.touch_seq > 0
                        AND tc.created_on <= ni.order_date)) AS seq
           FROM ie_fact_collections_invoice ci
           JOIN ie_fact_collections_invoice ni
             ON ni.billing_group_id = ci.billing_group_id
            AND ni.order_date > DATE(ci.credit_memo_on)
            AND ni.is_reactivation = 1
          WHERE ci.credit_memo_amount > 0 AND ci.cash_collected = 0
            AND ci.credit_memo_on IS NOT NULL
            AND ci.order_id IN (${scope.sql})
          GROUP BY ni.order_id
       ) z
      GROUP BY z.seq`,
    scope.params,
  );

  // ── Reactivated SERVICES per rung ──────────────────────────────────────────────
  // COUNTED OFF THE SUBSCRIPTION FACT, NOT OFF THE REACTIVATION INVOICE. The invoice
  // route cannot see most of them: September's cohort holds 15 reactivated services
  // behind only 3 reactivation invoices, because a win-back is not always billed on a
  // new order within the window, and the reactivation invoice is order type 6 — which
  // the subscription fact deliberately excludes, so it carries no service rows at all.
  // Reading the cohort's own services keeps this column equal to the count on the
  // Starting Point tile, which is the number the reader is comparing it against.
  //
  // PLACED AT THE TERMINATION, which is the moment the ladder lost the service and the
  // memo was raised. Every REACTIVATED row has `term_recorded_on` by construction — the
  // extract only reaches that arm when a termination exists — so the rung is always
  // resolvable, and it answers the question the chart is really asking: how far down the
  // cadence had we got when this one went, before it later came back.
  //
  // One rung per service (`MAX` inside the group), so the column partitions and can be
  // added up against the tile instead of double-counting a service billed twice.
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT z.seq AS \`seq\`, COUNT(*) AS \`subs\`
       FROM (
         SELECT s.service_id,
                MAX((SELECT MAX(tc.touch_seq)
                       FROM ie_fact_collections_touch tc
                      WHERE tc.task_id = s.task_id
                        AND tc.touch_seq > 0
                        AND tc.created_on <= s.term_recorded_on)) AS seq
           FROM ie_fact_collections_subscription s
          WHERE s.outcome = 'REACTIVATED'
            AND s.term_recorded_on IS NOT NULL
            AND s.order_id IN (${scope.sql})
          GROUP BY s.service_id
       ) z
      GROUP BY z.seq`,
    scope.params,
  );

  const bySeq = new Map<number | null, ReactivationRung>();
  const at = (raw: unknown): ReactivationRung => {
    const seq = raw == null ? null : Number(raw);
    if (!bySeq.has(seq)) bySeq.set(seq, { seq, invoices: 0, dollars: 0, subs: 0 });
    return bySeq.get(seq)!;
  };
  for (const r of rows) {
    const t = at(r.seq);
    t.invoices = num(r.invoices);
    t.dollars = Math.round(num(r.dollars));
  }
  for (const r of subRows) at(r.seq).subs = num(r.subs);
  return [...bySeq.values()];
}

export async function loadPostMemo(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  currency: string = DEFAULT_CURRENCY,
): Promise<PostMemoRecovery> {
  // THE MEMOED INVOICES ARE THE COHORT'S OWN — the declined basis, restricted to the
  // rows the Starting Point already reports in its CM bucket. This read the task fact
  // before, which admitted memos on invoices that never declined on the run and so
  // claimed write-offs the page's own invoice split did not contain.
  const scope = basisOrdersSql(filters, fromKey, toKey, callLadderCampaigns(), currency);
  const memoed = `ci.credit_memo_amount > 0 AND ci.cash_collected = 0
                    AND ci.order_id IN (${scope.sql})`;

  const [[wrote]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`invoices\`,
            SUM(ci.credit_memo_amount) AS \`dollars\`,
            COUNT(DISTINCT ci.task_id) AS \`tasks\`
       FROM ie_fact_collections_invoice ci
      WHERE ${memoed}`,
    scope.params,
  );

  const [[worked]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`touches\`,
            COUNT(DISTINCT ci.task_id) AS \`tasksWorked\`
       FROM ie_fact_collections_invoice ci
       JOIN ie_fact_collections_touch tc
         ON tc.task_id = ci.task_id
        AND tc.created_on > ci.credit_memo_on
      WHERE ${memoed} AND ci.credit_memo_on IS NOT NULL`,
    scope.params,
  );

  // Linked by billing group, the only key the memoed invoice and its replacement share
  // — a reactivation is a NEW order, so it carries neither the old order id nor the old
  // task. `is_reactivation` is the invoice fact's own flag, not an inference.
  const [[back]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT ni.order_id) AS \`invoices\`,
            SUM(ni.cash_collected) AS \`cash\`
       FROM ie_fact_collections_invoice ci
       JOIN ie_fact_collections_invoice ni
         ON ni.billing_group_id = ci.billing_group_id
        AND ni.order_date > DATE(ci.credit_memo_on)
        AND ni.is_reactivation = 1
      WHERE ${memoed} AND ci.credit_memo_on IS NOT NULL`,
    scope.params,
  );

  return {
    invoices: num(wrote?.invoices),
    dollars: Math.round(num(wrote?.dollars)),
    tasks: num(wrote?.tasks),
    tasksWorkedAfter: num(worked?.tasksWorked),
    touchesAfter: num(worked?.touches),
    reactivationInvoices: num(back?.invoices),
    reactivationCash: Math.round(num(back?.cash)),
  };
}
