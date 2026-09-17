/**
 * Stage 3 SQL fragments — the cash that came back and who applied it.
 *
 * Split from joins.ts on the stage boundary: that file owns the run/task spine
 * (`i`, `b`, `t`, `tc`), this owns recovery (`r`, `rk`, `pg`). Every fragment here
 * composes onto `ie_fact_collections_invoice i` and expects BILLING_JOIN's `b`.
 *
 * EVERY DERIVED TABLE HERE IS SCOPED. They were all unbounded aggregates over a
 * whole fact table, rebuilt independently by each query the page runs. Each one
 * documents below which of the two narrowings it can take, because they are not
 * interchangeable: a measure reading MIN/MAX over a group's history cannot be cut
 * by date without changing its answer, and is restricted by key set instead.
 */
import { parts, type CycleScope, type SqlPart } from './scope';

/**
 * Who actually took the money, ranked so one invoice resolves to one answer.
 *
 * `processor_crm_id` is tblPaymentsCredits.CreatedBy, and it identifies the payer
 * outright once you know the ID spaces: `tblSalesPeople.UserID` tops out at 201, so
 * anything above that is a `tblContacts.ContactID` — the customer's own portal login.
 * 0 is the automated recurring charge and 12 is the "Recurring Service" system
 * account.
 *
 * Deliberately NOT expressed as a numeric threshold. AGENT is already exact on
 * `processor_kind`, and 0/12 are exact, so everything left over is self-service —
 * which stays correct when staff 202 is hired. The only impurity is non-AR staff
 * (UserID 80 "Dealer User", 181, 29) landing in self-service: 175 of ~40,000 rows
 * warehouse-wide, none of them on a declined run. Dealer User is a portal login
 * anyway, so self-service is the honest bucket for it.
 *
 * RANKED, not MIN(processor_crm_id), because that would let the system account
 * outrank a real agent on a split payment. No invoice currently has payments from
 * two classes; the rank keeps the answer defensible if one ever does.
 */
const SYSTEM_CRM_IDS = '(0, 12)';

export const PROCESSOR_RANK = `
  MIN(CASE WHEN processor_kind = 'AGENT'                  THEN 1
           WHEN processor_crm_id IN ${SYSTEM_CRM_IDS}     THEN 3
           ELSE 2 END)`;

/**
 * The same three classes PROCESSOR_RANK ranks, named, and read at the grain of the ONE
 * payment `payerPick` chose rather than across all of the invoice's payments.
 *
 * The rank answers "was an agent involved at all", which is the right question for a
 * count but the wrong one for a row that names somebody: an invoice split between an
 * agent and the customer ranks AGENT, so a grid reading the rank would print the
 * customer's name under an agent label. This reads the winning payment's own fields, so
 * the class always describes the payer being shown.
 *
 * Every payment row in the warehouse carries a `processor_crm_id`, so the three arms
 * partition them exactly. A NULL result therefore means no payment at all, not an
 * unclassifiable one.
 */
export const PAYER_CLASS = `
  CASE WHEN r.processor_kind = 'AGENT'              THEN 'AGENT'
       WHEN r.processor_crm_id IN ${SYSTEM_CRM_IDS} THEN 'SYSTEM'
       WHEN r.processor_crm_id IS NOT NULL          THEN 'PORTAL'
  END`;

/**
 * Reads `r` from RECOVERY_JOIN.
 *
 * Gated on cash rather than on the presence of a recovery row: an invoice whose
 * payments net to zero has no processor worth naming, and counting it as one put
 * stage 2's unrecovered figure one below stage 3's written-off-plus-open total.
 */
const PAID = 'IFNULL(r.collected, 0) > 0';

export const PROCESSOR_CASE = `
  CASE WHEN NOT ${PAID}         THEN 'Not Recovered'
       WHEN r.processor_rank = 1 THEN 'Agent'
       WHEN r.processor_rank = 2 THEN 'Self-Service'
       WHEN r.processor_rank = 3 THEN 'System'
       ELSE 'Not Recovered'
  END`;

/**
 * Per-class invoice counts and cash, for any query grouped above invoice grain.
 *
 * The three paid classes do not sum to the row's invoice count. The shortfall used to
 * be shown as one unexplained "No Cash" figure; it is split here into the only two
 * states it can hold, so the reader is never left guessing what happened to it:
 *
 *  - MEMO — no cash applied, but a credit memo cleared the invoice. 96.9% of the
 *    shortfall warehouse-wide, and 100% of it on the 2026-08-01 run.
 *  - OPEN — no cash applied and no memo either. Genuinely unresolved.
 *
 * Split on `credit_memo_amount` rather than on `outcome`, so the two partition the
 * shortfall exactly and the columns always reconcile to the invoice count.
 *
 * OPEN carries a known impurity: 33 invoices warehouse-wide (through 2026-03-16) whose
 * ledger reports cash but which have no row at all in ie_fact_collections_recovery, so
 * the payment fact cannot see the money. They are a gap between the invoice and payment
 * extracts, not an AR outcome, and they land in OPEN because that is what the evidence
 * on hand supports. Fixing the extract moves them into the paid classes on its own.
 * `open_amount` sums open_balance, which those 33 report as zero.
 */
export const PROCESSOR_SPLIT_SELECT = `
  SUM(${PAID} AND r.processor_rank = 2)                                   AS self_invoices,
  SUM(CASE WHEN ${PAID} AND r.processor_rank = 2 THEN r.collected ELSE 0 END) AS self_collected,
  SUM(${PAID} AND r.processor_rank = 1)                                   AS agent_invoices,
  SUM(CASE WHEN ${PAID} AND r.processor_rank = 1 THEN r.collected ELSE 0 END) AS agent_collected,
  SUM(${PAID} AND r.processor_rank = 3)                                   AS system_invoices,
  SUM(CASE WHEN ${PAID} AND r.processor_rank = 3 THEN r.collected ELSE 0 END) AS system_collected,
  SUM(NOT ${PAID} AND i.credit_memo_amount > 0)                           AS memo_invoices,
  SUM(CASE WHEN NOT ${PAID} AND i.credit_memo_amount > 0
           THEN i.credit_memo_amount ELSE 0 END)                          AS memo_amount,
  SUM(NOT ${PAID} AND i.credit_memo_amount = 0)                           AS open_invoices,
  SUM(CASE WHEN NOT ${PAID} AND i.credit_memo_amount = 0
           THEN i.open_balance ELSE 0 END)                                AS open_amount`;

/** Cash applied to the invoice itself, reversals removed. */
/**
 * One payer per invoice, taken from ONE payment rather than assembled from several.
 *
 * The identity fields used to be independent MIN()s over the invoice's payments, so an
 * invoice paid twice reported a payer that never existed: the billing group off the
 * lowest-numbered group, the name off the alphabetically-first processor, the date off
 * the earliest application, with nothing tying them to the same payment. Ranking the
 * payments once and reading every identity field off the winning row keeps the answer
 * coherent — whoever is named is the person whose payment is described.
 *
 * The winner is the FIRST payment that actually moved money, which is the one that
 * answers "how did this come back". `payment_credit_id` breaks ties on identical
 * timestamps so the choice is deterministic rather than storage-order dependent.
 *
 * `paid_count` is carried so a caller can tell a single clean payment from a split one
 * instead of silently presenting the first of several as the whole story.
 */
const payerPick = (orders: SqlPart) => `
    SELECT rr.order_id,
           rr.billing_group_id,
           rr.payment_last4,
           rr.applied_on   AS first_paid_on,
           rr.processor_kind,
           rr.processor_crm_id,
           rr.agent_email,
           rr.processor_name
      FROM ie_fact_collections_recovery rr
     WHERE rr.is_reversed = 0
       AND rr.amount > 0
       AND rr.order_id IN (${orders.sql})
       AND NOT EXISTS (
             SELECT 1 FROM ie_fact_collections_recovery r2
              WHERE r2.order_id = rr.order_id
                AND r2.is_reversed = 0
                AND r2.amount > 0
                AND (r2.applied_on, r2.payment_credit_id)
                  < (rr.applied_on, rr.payment_credit_id)
           )`;

/**
 * Cash and processor class only — no per-payment identity. Stage 2 uses this.
 *
 * Keyed by order_id and joined to `i.order_id`, so restricting it to the scoped
 * orders removes only rows that could never be looked up.
 */
export const recoveryAggJoin = (scope: CycleScope): SqlPart => {
  const orders = scope.keySet('order_id');
  return {
    sql: `
  LEFT JOIN (
    SELECT order_id,
           SUM(amount)       AS collected,
           ${PROCESSOR_RANK} AS processor_rank
      FROM ie_fact_collections_recovery
     WHERE is_reversed = 0
       AND order_id IN (${orders.sql})
     GROUP BY order_id
  ) r ON r.order_id = i.order_id`,
    params: orders.params,
  };
};

/** As RECOVERY_AGG_JOIN, plus the winning payment's identity. Scoped the same way. */
const recoveryJoin = (scope: CycleScope): SqlPart => {
  const agg = scope.keySet('order_id');
  const pick = scope.keySet('order_id');
  return {
    sql: `
  LEFT JOIN (
    SELECT agg.order_id,
           agg.collected,
           agg.paid_count,
           agg.processor_rank,
           pick.billing_group_id,
           pick.payment_last4,
           pick.first_paid_on,
           pick.processor_kind,
           pick.processor_crm_id,
           pick.agent_email,
           pick.processor_name
      FROM (
        SELECT order_id,
               SUM(amount)                       AS collected,
               SUM(amount > 0)                   AS paid_count,
               ${PROCESSOR_RANK}                 AS processor_rank
          FROM ie_fact_collections_recovery
         WHERE is_reversed = 0
           AND order_id IN (${agg.sql})
         GROUP BY order_id
      ) agg
      LEFT JOIN (${payerPick(pick)}) pick ON pick.order_id = agg.order_id
  ) r ON r.order_id = i.order_id`,
    params: [...agg.params, ...pick.params],
  };
};

/**
 * Was the card replaced on the same billing group after the run failed?
 *
 * Answered once for every declined billing row instead of once per result row. The
 * natural way to write this is a correlated EXISTS on `billing_group_id`, but the
 * only index covering that column is `uq_fcb_bg (date_key, billing_group_id)` — the
 * group is not leading, so each probe scans the fact and this single measure cost
 * ~10s of an ~11s page load.
 *
 * Pre-aggregating collapses 194,717 successful charges into 28,877
 * (billing group, last4) pairs, which the optimiser can hash-join in one pass.
 * MAX(date_key) is exact for the question being asked: a later OK charge on that
 * card exists if and only if the latest one is after the run day.
 *
 * NARROWED TWICE (perf). The declined side `d` is restricted to the scoped orders,
 * because `rk` is joined on `(order_id, date_key)` and nothing else can be read.
 * The successful side `ok` is restricted to `date_key >= fromKey`, which is safe
 * precisely because the comparison is one-directional: every `d` row is inside the
 * window, so only an OK charge at or after the window's first day can ever satisfy
 * `last_ok_key > d.date_key`. If a group's true latest OK charge is older than
 * that, the restricted set is empty and yields no match — which is the same answer
 * the unrestricted MAX gives, since that MAX would also fail the comparison.
 */
const rekeyJoin = (scope: CycleScope): SqlPart => {
  const orders = scope.keySet('order_id');
  return {
    sql: `
  LEFT JOIN (
    SELECT d.order_id,
           d.date_key,
           MAX(CASE WHEN ok.billing_group_id IS NOT NULL THEN 1 ELSE 0 END) AS rekeyed
      FROM ie_fact_collections_billing d
      LEFT JOIN (
        SELECT billing_group_id, charge_last4, MAX(date_key) AS last_ok_key
          FROM ie_fact_collections_billing
         WHERE first_result = 'OK' AND charge_last4 IS NOT NULL
           AND date_key >= ?
         GROUP BY billing_group_id, charge_last4
      ) ok ON ok.billing_group_id = d.billing_group_id
          AND ok.charge_last4    <> d.charge_last4
          AND ok.last_ok_key      > d.date_key
     WHERE d.first_result = 'DECLINED' AND d.charge_last4 IS NOT NULL
       AND d.order_id IN (${orders.sql})
     GROUP BY d.order_id, d.date_key
  ) rk ON rk.order_id = i.order_id AND rk.date_key = i.date_key`,
    params: [scope.fromKey, ...orders.params],
  };
};

/**
 * Had the billing group that paid ever been charged before this run?
 *
 * The proxy that separates "the customer gave us a new card" from "the customer paid
 * with another card they already had". CRM does not update a card in place — it
 * creates a NEW billing group row to hold the replacement — so a group with no
 * billing history before the decline is a card we did not have on file.
 *
 * The group's real `tblBillingGroups.CreatedOn` is not in the warehouse, so first
 * charge date stands in for it. A card payment is a gateway transaction and lands in
 * the billing fact, which is what makes the stand-in hold.
 *
 * NARROWED BY GROUP, NEVER BY DATE (perf). This is the one derived table here that
 * must keep its full history: `first_key` is a MIN over everything the group was
 * ever charged, and it decides "new card" against "card we already had". Cutting
 * the input by date would move that MIN forward and start reporting cards we have
 * held for years as newly provided. Restricting to the groups that actually paid a
 * scoped invoice changes nothing — `pg` is joined on `r.billing_group_id`, so no
 * other group is ever read — while collapsing the input to the handful of groups in
 * the cycle rather than all ~30k in the warehouse.
 */
const payingGroupJoin = (scope: CycleScope): SqlPart => {
  const orders = scope.keySet('order_id');
  return {
    sql: `
  LEFT JOIN (
    SELECT billing_group_id, MIN(date_key) AS first_key
      FROM ie_fact_collections_billing
     WHERE billing_group_id IN (
             SELECT rr.billing_group_id
               FROM ie_fact_collections_recovery rr
              WHERE rr.is_reversed = 0
                AND rr.billing_group_id IS NOT NULL
                AND rr.order_id IN (${orders.sql})
           )
     GROUP BY billing_group_id
  ) pg ON pg.billing_group_id = r.billing_group_id`,
    params: orders.params,
  };
};

/**
 * Was the declined card charged again after this run?
 *
 * Paying with a different card does not take the old one off file. CRM creates a
 * new billing group for a replacement and leaves the declined group sitting there,
 * so the next cycle will try it again unless someone retires it. That is the repeat
 * risk the path labels do not answer — they only say which card paid THIS invoice.
 *
 * Bound to BILLING_JOIN's row (group + date), same as REPEAT_JOIN, so a two-group
 * decline cannot count twice. A later charge on the same group AND last four is
 * the proof the declined card was still on file and still being sent.
 *
 * NARROWED FORWARD (perf), on the same reasoning as REKEY_JOIN's `ok` side: `b` is
 * always inside the window, so only a charge at or after the window's first day can
 * satisfy `last_key > b.date_key`, and a group whose true latest charge predates
 * that fails the comparison either way.
 */
export const originalStillJoin = ({ fromKey }: CycleScope): SqlPart => ({
  sql: `
  LEFT JOIN (
    SELECT billing_group_id, charge_last4, MAX(date_key) AS last_key
      FROM ie_fact_collections_billing
     WHERE charge_last4 IS NOT NULL
       AND date_key >= ?
     GROUP BY billing_group_id, charge_last4
  ) os ON os.billing_group_id = b.billing_group_id
      AND os.charge_last4     = b.charge_last4
      AND os.last_key         > b.date_key`,
  params: [fromKey],
});

/**
 * How the declined money came back, named for what the CUSTOMER had to do.
 *
 * CORRECTED 2026-09-11. This used to split "New billing group" from "Card re-keyed on
 * same group" and call the first an account-ownership problem. It is not: all 248
 * August cases were the SAME CustomerID, 206 of the paying groups were created on or
 * after the decline, and 235 carried a different last4. CRM simply creates a new
 * billing group row to hold a replacement card and repoints the invoice header at it,
 * so the two paths were one business event — a new card — split by whether CRM reused
 * the row. They are merged. What is genuinely distinct is paying from a card we
 * already held, which is the 42 remaining cases.
 *
 * CASH IS TESTED FIRST. The credit-memo test used to run ahead of it, so an invoice
 * both written off and partly paid reported as a memo and vanished from recovery.
 * With cash leading, "written off" plus "still open" reconciles to stage 2's
 * unrecovered count — they disagreed by the memo-and-paid rows before.
 *
 * IT FALLS BACK TO THE INVOICE'S OWN CASH (2026-09-11). Every branch above the last
 * one used to read `r`, so an invoice with no row in the recovery fact dropped
 * straight through to 'Still open' no matter what the invoice itself said. That is
 * not a rare edge: `ie_fact_collections_recovery` only admits cash on accounts we
 * were chasing, so an invoice the RUN collected has no recovery row at all — on
 * 2026-09-01 that mislabelled 6,616 paid invoices worth $705,876.25, including
 * 1936470, which reads CASH_PAID for $6,888.44 with a zero balance and a paid_on of
 * 07:37 that morning. `ie_fact_collections_invoice` already carries the applied cash,
 * so the last two arms answer "did the money come back" from the invoice, and the
 * recovery branch is left to answer only "HOW did it come back" for the rows it
 * actually covers. Order is unchanged for those rows, so stage 3's declined cohort
 * keeps its existing paths.
 *
 * THE GROUP COMPARISON FALLS BACK TO THE CHARGED GROUP (2026-09-11). Both "did the
 * group change" branches read `b.billing_group_id`, and `b` is the billing row — which
 * by definition does not exist for a never-attempted invoice. The comparison was
 * therefore skipped for that whole bucket and every paid row dropped to the last arm,
 * reporting a new card as the original one being retried. On 2026-08-01 that was 5 of
 * the 20 paid never-attempted invoices, each paid from a 113xxx group the run had never
 * touched. `i.card_billing_group_id` is the group the run was pointed at, so it answers
 * the same question when there is no billing row to ask.
 */
const RUN_GROUP = 'IFNULL(b.billing_group_id, i.card_billing_group_id)';

/**
 * The card the run tried, as of the run. `b.charge_last4` is what the gateway was
 * actually handed; `i.card_last4` is the charged group's card stamped as of the invoice
 * date, and covers the invoices with no billing row at all.
 */
const RUN_LAST4 = 'NULLIF(IFNULL(b.charge_last4, i.card_last4), \'\')';

/** Paid by a different card or group than the run charged. */
export const DIFFERENT_CARD = `
  ( (r.payment_last4 IS NOT NULL AND ${RUN_LAST4} IS NOT NULL
     AND r.payment_last4 <> ${RUN_LAST4})
    OR (r.billing_group_id IS NOT NULL AND ${RUN_GROUP} IS NOT NULL
        AND r.billing_group_id <> ${RUN_GROUP})
    OR IFNULL(rk.rekeyed, 0) = 1 )`;

/**
 * IT IS DECIDED FROM THE PAYING CARD, NOT A GROUP PROXY (2026-09-14).
 *
 * 'Original card retried' was the ELSE arm, so it collected everything the rule could
 * not place — and the rule could rarely place anything, because it compared the invoice
 * header's billing group (which CRM rewrites after payment) against the run's group,
 * then fell back to a proxy asking whether ANY later success existed on the group with
 * a different last four. Neither describes the payment that settled this invoice.
 * 1919833 is the worked example: declined 08-01 on group 68054 last4 1781, paid 08-03
 * on group 112957 last4 4587, reported as the original card being retried.
 *
 * `payment_last4` comes off the gateway row for the payment itself, so the comparison
 * is now between the card the run tried and the card that actually paid. The asymmetry
 * is deliberate and matters: a DIFFERENT last four proves a different card, but an
 * IDENTICAL last four does not prove the same card — two cards can share them, and a
 * re-issue usually keeps them. So a difference concludes, and a match does not: it
 * falls through to the group evidence, and only claims the original card was retried
 * when the payment landed on the same group the run charged. When neither the card nor
 * the group can be established the instrument is reported unknown rather than being
 * quietly credited to the original card.
 */
export const PATH_CASE = `
  CASE
    WHEN IFNULL(r.collected, 0) > 0 THEN
      CASE
        WHEN r.payment_last4 IS NOT NULL
         AND ${RUN_LAST4} IS NOT NULL
         AND r.payment_last4 <> ${RUN_LAST4}
         AND IFNULL(pg.first_key, i.date_key) >= i.date_key  THEN 'New Card Provided'
        WHEN r.payment_last4 IS NOT NULL
         AND ${RUN_LAST4} IS NOT NULL
         AND r.payment_last4 <> ${RUN_LAST4}                 THEN 'Another Card on File'
        WHEN r.billing_group_id IS NOT NULL
         AND ${RUN_GROUP} IS NOT NULL
         AND r.billing_group_id <> ${RUN_GROUP}
         AND IFNULL(pg.first_key, i.date_key) >= i.date_key  THEN 'New Card Provided'
        WHEN r.billing_group_id IS NOT NULL
         AND ${RUN_GROUP} IS NOT NULL
         AND r.billing_group_id <> ${RUN_GROUP}              THEN 'Another Card on File'
        WHEN IFNULL(rk.rekeyed, 0) = 1                       THEN 'New Card Provided'
        WHEN r.payment_last4 IS NOT NULL
         AND ${RUN_LAST4} IS NOT NULL
         AND r.billing_group_id = ${RUN_GROUP}               THEN 'Same Card Tried Again'
        ELSE 'Card Not Identified'
      END
    WHEN i.cash_collected > 0 AND b.first_result = 'OK'      THEN 'Collected on the Run'
    WHEN i.cash_collected > 0                                THEN 'Collected, Source Unknown'
    WHEN i.credit_memo_amount > 0                            THEN 'Written Off'
    ELSE 'Still Open'
  END`;

/** PATH_CASE reads `rk` and `pg`, so any query using it must join these too. */
export const pathJoins = (scope: CycleScope): SqlPart =>
  parts(recoveryJoin(scope), rekeyJoin(scope), payingGroupJoin(scope));
