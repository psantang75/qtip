/**
 * What happens AFTER an invoice is written off.
 *
 * The page treated a credit memo as the end of the story, and it is not. Shutting a
 * service off is what raises the memo, but the task stays open and keeps being worked:
 * across 2025-06..2026-09 the four recurring runs memoed 2,057 invoices worth
 * $333,269.79, and 1,605 of those tasks (79%) were touched AGAIN afterwards, 4,679
 * times in total. 121 reactivation invoices then took $58,586.29 back. None of that
 * effort or recovery was visible anywhere on the report.
 *
 * THAT CASH IS REACHED THROUGH THE SERVICE THAT RETURNED, not through the billing group
 * — see `reactivationInvoicesSql`. Matching on the group was wrong in BOTH directions
 * over that same history: it returned 227 invoices totalling only $19,534.67, because it
 * swept in every reactivation that happened to sit on the same card whether or not it
 * related to the memoed invoice, while missing the real win-backs — which move to a NEW
 * card, that being much of why they could be won back at all.
 *
 * These figures therefore depend on
 * `ie_fact_collections_subscription.successor_order_id`, which populates per window as
 * that window is ingested; a window loaded before migration
 * 20260917210000_collections_subscription_successor reports no reactivation cash until
 * it is reloaded.
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
import { basisOrdersSql, type SqlFragment } from '../declinedBasis';

/**
 * The memoed cohort, against alias `ci`: written off with no cash against it, inside
 * the declined basis. Every read in this file measures exactly this population.
 */
const memoedWhere = (scope: SqlFragment): string =>
  `ci.credit_memo_amount > 0 AND ci.cash_collected = 0
     AND ci.order_id IN (${scope.sql})`;

/**
 * One row per reactivation invoice the memoed cohort brought back — the invoice, the
 * cash on it, and the rung that was working the task when it arrived. Both reads below
 * share it so the tile total and the chart cannot disagree.
 *
 * REACHED THROUGH THE SERVICE THAT CAME BACK (`successor_order_id`), because the
 * memoed invoice and its replacement share no other honest key: a win-back is normally
 * paid by a new card, so matching on billing group missed most of it.
 *
 * GROUPED BY THE SUCCESSOR INVOICE so its cash is counted once however many services
 * it brought back, and however many memoed invoices reach it. One replacement invoice
 * standing in for three shut-off services is ordinary, not an edge case.
 *
 * ANCHORED ON THE SHUT-OFF, NOT ON THE MEMO POSTING. The termination is the event this
 * section is about; the memo is the bookkeeping that follows it, and `>` against
 * `credit_memo_on` silently discarded every SAME-DAY comeback — the fastest and best
 * saves there are. On the September CC cohort that was 2 invoices and $1,197.29 of
 * $3,202.80, including one where memo, shut-off and replacement all fell on 2026-09-14.
 * `term_recorded_on` is never NULL on a REACTIVATED row: the extract only reaches that
 * outcome when a termination exists.
 *
 * Order types 1 and 6 only — type 3 is the recurring run's own output, and counting it
 * would report renewal billing as recovery.
 */
const reactivationInvoicesSql = (memoed: string): string =>
  `SELECT ni.order_id,
          MAX(ni.cash_collected) AS cash,
          MAX((SELECT MAX(tc.touch_seq)
                 FROM ie_fact_collections_touch tc
                WHERE tc.task_id = ci.task_id
                  AND tc.touch_seq > 0
                  AND tc.created_on <= ni.order_date)) AS seq
     FROM ie_fact_collections_invoice ci
     JOIN ie_fact_collections_subscription sb
       ON sb.order_id = ci.order_id
      AND sb.outcome = 'REACTIVATED'
      AND sb.successor_order_id IS NOT NULL
     JOIN ie_fact_collections_invoice ni
       ON ni.order_id = sb.successor_order_id
      AND ni.order_type_id IN (1, 6)
      AND ni.order_date >= DATE(sb.term_recorded_on)
    WHERE ${memoed} AND ci.credit_memo_on IS NOT NULL
    GROUP BY ni.order_id`;

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
  /** Reactivation invoices that brought one of the cohort's own services back. */
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
       FROM (${reactivationInvoicesSql(memoedWhere(scope))}) z
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
  const memoed = memoedWhere(scope);

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

  // LINKED BY THE SERVICE THAT CAME BACK, through the subscription fact's
  // `successor_order_id`. A reactivation is a NEW order carrying neither the old order
  // id nor the old task, so this used to match on billing group — the only key the two
  // invoices appeared to share. That key is wrong for this event: a win-back is
  // normally paid by a new card and so lands on a DIFFERENT billing group. On the 60
  // declined and memoed September CC invoices it found 3 invoices and $605.71 where the
  // service link finds 7 and $3,202.80 (migration
  // 20260917210000_collections_subscription_successor).
  //
  // Order types 1 and 6 only. Type 3 is the recurring run's own output, so counting it
  // would report ordinary renewal billing as recovery and break the page's tie to Cycle
  // Performance. Types the invoice fact does not ingest simply fail the join.
  //
  // AGGREGATED OVER DISTINCT SUCCESSOR INVOICES, not over the join. One invoice can be
  // reached by every service it brought back — five services on one replacement is
  // ordinary — and summing the join would multiply its cash by that count.
  const [[back]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`invoices\`, SUM(z.cash) AS \`cash\`
       FROM (${reactivationInvoicesSql(memoed)}) z`,
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
