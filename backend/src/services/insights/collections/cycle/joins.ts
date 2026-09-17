/**
 * The run and task spine — SQL fragments for stages 1 and 2.
 *
 * scope.ts owns the filters and row types; this owns the joins every stage composes
 * onto `ie_fact_collections_invoice i`. Recovery (`r`, `rk`, `pg`) lives in
 * recoveryJoins.ts. Each fragment names its own alias (`b`, `t`, `tc`, `rp`) and
 * several expressions read an alias a different fragment introduces, so the pairings
 * noted below are load-bearing, not stylistic.
 */
import { easternDate, easternInstant } from '../easternTime';
import type { CycleScope, SqlPart } from './scope';

/**
 * The run's gateway result for this invoice, pinned to the invoice's own date.
 *
 * ONE ROW PER INVOICE. `ie_fact_collections_billing` is billing-group grain, so an
 * invoice charged on two groups the same day produces two rows and a plain join
 * double-counts it — on 2026-08-01 that was 8 invoices and it pushed the outcome
 * totals to 7,950 against a spine of 7,942. The NOT EXISTS picks a single winner,
 * mirroring the idiom in collections_invoice.transform.sql.
 *
 * DECLINED WINS. Every one of those 8 declined on the original group and succeeded
 * on a newly created one the same day. The run charged the original group, so the
 * run declined; the later success is recovery and belongs in stage 3, not intake.
 *
 * ERROR NOW BEATS OK (2026-09-11). It used to lose to both, which quietly hid our own
 * submission failures behind a retry that happened to work: 2026-09-01 had 15 ERROR
 * rows across 13 invoices and the page reported 11. A decline is a customer event and
 * still outranks everything, but a malformed or rejected submission is a defect on our
 * side and must stay visible even when a second group settled the same invoice — a
 * plain OK is the absence of a problem and has nothing to report.
 *
 * VOIDED SITS BETWEEN THEM (2026-09-14). It is a new outcome — see the extract — and
 * without a rank of its own it fell to the ELSE and lost to everything. A sale that was
 * accepted and then reversed is a real event someone needs to see, so it outranks a
 * plain OK; it is not a defect on our side, so it stays below ERROR.
 *
 * IN_FLIGHT RANKS LAST, BELOW OK (2026-09-16). A capture awaiting settlement says less
 * than any finished answer for the same invoice on the same day, so if one of the other
 * rows resolved, that is the one to report. Ranked explicitly rather than left to the
 * ELSE so it cannot silently trade places with a future outcome added the same way.
 */
export const BILLING_JOIN = `
  LEFT JOIN ie_fact_collections_billing b
         ON b.order_id = i.order_id
        AND b.date_key = i.date_key
        AND NOT EXISTS (
              SELECT 1 FROM ie_fact_collections_billing b2
               WHERE b2.order_id = b.order_id
                 AND b2.date_key = b.date_key
                 AND (CASE b2.first_result
                        WHEN 'DECLINED' THEN 1 WHEN 'ERROR' THEN 2
                        WHEN 'VOIDED' THEN 3 WHEN 'OK' THEN 4
                        WHEN 'IN_FLIGHT' THEN 5 ELSE 6 END,
                      b2.billing_group_id)
                   < (CASE b.first_result
                        WHEN 'DECLINED' THEN 1 WHEN 'ERROR' THEN 2
                        WHEN 'VOIDED' THEN 3 WHEN 'OK' THEN 4
                        WHEN 'IN_FLIGHT' THEN 5 ELSE 6 END,
                      b.billing_group_id)
            )`;

/**
 * Had this billing group already declined before this run?
 *
 * A repeat is the same billing group declining again within twelve months of a prior
 * decline. That is the wasted-effort measure: the first decline is unavoidable, every
 * one after it is a failure we generated and then paid an agent to chase. Measured on
 * the billing group because the card lives there, so a repeat means the same card is
 * still on file and still failing.
 *
 * `date_key - 10000` is exactly one year back — date_key is YYYYMMDD, so subtracting
 * 10000 decrements the year and leaves the month and day alone.
 *
 * CAVEAT: the fact holds a rolling 15 months, so the earliest months in the warehouse
 * have less than a full year of history behind them and under-report repeats.
 *
 * Only the NEAREST prior decline is needed: if the closest one is more than a year
 * back then none is inside the year. LAG gets that in a single ordered pass over the
 * ~12k declined rows. The obvious self-join instead pairs every decline with every
 * earlier decline on the same group, and since `uq_fcb_bg` leads on `date_key` there
 * is no index on `billing_group_id` to join through — it blew the statement timeout.
 *
 * The window runs over ALL declines, including rows whose invoice never resolved, so
 * a prior failure still counts even when we cannot name the invoice behind it. The
 * fact is one row per billing group per day, so a group cannot be its own prior.
 *
 * BOUND TO THE SELECTED BILLING ROW (2026-09-14). This used to join on
 * (order_id, date_key) against a billing-group-grain subquery, so an invoice declined
 * on two groups the same day matched twice and every aggregate downstream counted it
 * twice — the same fan-out BILLING_JOIN carries a NOT EXISTS to prevent. On 2026-09-01
 * the decline-reason breakdown read 336 invoices / $59,043.40 against an intake of
 * 333 / $58,603.60, the $439.80 gap being 1937202, 1941298 and 1943711 counted twice.
 * Joining on (billing_group_id, date_key) — the fact's unique key — pins the repeat
 * evidence to the one billing row BILLING_JOIN chose, so `b` must be joined first.
 */
/**
 * SCOPED TO THE LOOKBACK, NOT THE WHOLE FACT (perf). The window used to run over
 * every declined row in the warehouse — ~253k rows ordered and partitioned on
 * every page load, nine times over. `IS_REPEAT` only accepts a prior decline at
 * `date_key - 10000` or later, so a decline older than one year before the first
 * day of the window can never qualify for any row in it, and dropping those
 * cannot change an answer:
 *
 *   - The true nearest prior is older than `fromKey - 10000`. Then it is also
 *     older than `D - 10000` for every in-window row D, so IS_REPEAT was already
 *     false; restricted, LAG returns NULL and it is false again.
 *   - The true nearest prior is `fromKey - 10000` or later. Then it is inside the
 *     restricted set, and still the nearest, so LAG returns exactly the same row.
 *
 * The fact holds a rolling 15 months either way, so this is a narrowing of an
 * already-bounded history, not a new limit on what a repeat means.
 */
export const repeatJoin = ({ fromKey, toKey }: CycleScope): SqlPart => ({
  sql: `
  LEFT JOIN (
    SELECT billing_group_id, date_key,
           LAG(date_key) OVER (PARTITION BY billing_group_id ORDER BY date_key) AS prev_key
      FROM ie_fact_collections_billing
     WHERE first_result = 'DECLINED'
       AND date_key BETWEEN ? AND ?
  ) rp ON rp.billing_group_id = b.billing_group_id AND rp.date_key = b.date_key`,
  params: [fromKey - 10000, toKey],
});

/** True when this decline is not the billing group's first in the trailing year. */
export const IS_REPEAT = '(rp.prev_key IS NOT NULL AND rp.prev_key >= i.date_key - 10000)';

/**
 * When this invoice stopped being collectable: first cash, else the write-off.
 *
 * The moment the debt ended, whichever way it ended. Used both to decide that a run had
 * nothing to collect (RESULT_CASE) and to close the outreach window (TOUCH_JOIN), so the
 * two can never disagree about when an invoice was resolved.
 */
export const financialEvent = (alias: string) =>
  `COALESCE(${alias}.first_cash_on, ${alias}.credit_memo_on)`;

/**
 * The run's outcome per invoice.
 *
 * A CARD invoice with no billing row is NO_CHARGE — the run never reached the
 * gateway for it. That is a real operational bucket, not a data gap: on 2026-08-01
 * all 47 were later handled by a person (33 card payments, 12 credit memos).
 *
 * ACH IS NOT THE SAME and must not share that bucket. ACH results reach
 * tblPaymentResponseLog well after the cycle — the 2026-09-01 run had 671 of 679 ACH
 * invoices with no gateway row on 09-10, against 45 of 8,049 for card. Calling those
 * "never attempted" made settlement lag look like the largest failure on the page.
 * They are reported as PENDING_ACH: still invoiced, outcome openly unknown.
 *
 * NO_RESPONSE IS NOT A "NEVER ATTEMPTED" BUCKET, and it used to be filed as one. We
 * submitted the charge to the gateway and no answer was ever recorded, which is a
 * failure on OUR side, so it sits with ERROR rather than with the customer-caused
 * outcomes. Invoice 1922467 is the proof: gateway request row 3454889 at 04:04:07 for
 * $1,149.93 on last4 1008, no answer; the same card settled untouched three days later
 * for the same amount. Calling that "never attempted" was simply false.
 *
 * IT IS TESTED BEFORE THE CARD, deliberately. The page must never claim we did not
 * attempt an invoice that we demonstrably did, whatever the card said. The two do not
 * collide today — EXPIRED + NO_RESPONSE occurs zero times across the whole 15-month
 * window, because a dead card is rejected internally in the same second and never
 * leaves a request outstanding — but the ordering is what keeps the labels honest if
 * that ever changes.
 *
 * ALREADY SETTLED IS TESTED FIRST of the no-billing-row arms, because it is the only
 * one that explains the absence rather than describing it. When the invoice was paid or
 * written off on an earlier day than it was raised, there was no debt for the run to
 * collect and not attempting it is correct behaviour, not a miss. Every other bucket
 * here implies something went wrong. 7 invoices across the 15-month window are in this
 * state, worth 8,209.40, and one of them was being reported as "never attempted —
 * expired card" for 415.17: the card had indeed lapsed, and it could not matter less
 * when the balance was already zero. Compared on the EASTERN calendar day (see
 * easternTime.ts) because the settlement is a UTC instant and order_date is a calendar
 * day; the raw comparison would miss anything settled in the last four hours of the
 * previous evening.
 *
 * NEVER ATTEMPTED THEN SPLITS IN TWO, and both mean the charge never went out:
 *   NO_CHARGE_EXPIRED  the card had already lapsed on the run date. The customer's
 *                      problem, and the one with an obvious fix.
 *   NO_CHARGE          everything else — CRM started the payment step but nothing
 *                      reached the gateway (UNSUBMITTED), no step started (NOT_SENT),
 *                      or there are no recurring items to ask (NULL). A NULL cannot be
 *                      matched by equality, which is why this arm is the fall-through.
 *                      pay_request_state keeps the three apart for drill-down.
 *
 * There was briefly a NO_CHARGE_REPLACED, for invoices whose billing group was
 * created after the run. It is gone: it was an artefact of reading the card off
 * tblOrders.BillingGroupID, which CRM repoints at whichever group later paid. Against
 * the group the run actually charged (tblRecurringItems), most of those invoices are
 * plain expired cards, so splitting them out was drawing a line through one cause.
 *
 * card_state is stamped by the transform from the charged group AS OF the invoice
 * date, never from the live group — see collections_invoice.extract.sql. Reading it
 * live said 10 of 25 expired instead of 16, because six customers had already fixed
 * their card by the time the report ran.
 */
export const RESULT_CASE = `
  CASE WHEN b.first_result IS NOT NULL           THEN b.first_result
       WHEN ${easternDate(financialEvent('i'))} < i.order_date
                                                 THEN 'ALREADY_SETTLED'
       WHEN i.recurring_payment_type = 3         THEN 'PENDING_ACH'
       WHEN i.pay_request_state = 'NO_RESPONSE'  THEN 'NO_RESPONSE'
       WHEN i.card_state = 'EXPIRED'             THEN 'NO_CHARGE_EXPIRED'
       ELSE 'NO_CHARGE' END`;

/**
 * The AR task that chased this invoice.
 *
 * Follows the link the transform already resolved. This used to re-derive the task
 * here instead — earliest task for the same customer within the same half-month pass —
 * which is a second, weaker copy of a rule the fact already answers, and it disagreed
 * with the fact on 21 August/September invoices. Customer 122706 is the worked example:
 * three AR tasks opened on 2026-08-01 against different billing groups, and "earliest
 * for the customer" gave every one of that customer's invoices the 15:48 task
 * regardless of which card was actually charged. The transform matches on the charged
 * group and tie-breaks by closeness, so invoice 1923909 gets 1104608 and 1923912 gets
 * 1104697. See collections_invoice.transform.sql for how the link is made.
 *
 * Collapsing to an equality also drops the pass-key ranking subquery that existed only
 * to keep the customer-scoped version inside the statement timeout, and it lets the
 * COVERED case through: a task that opened in an earlier pass and is still open cannot
 * satisfy `pass_key = <invoice pass>`, so the old join could never see one.
 *
 * `task_id` is unique in the fact (19,302 of 19,302), so this cannot fan out.
 */
export const TASK_JOIN = `
  LEFT JOIN ie_fact_collections_task t
         ON t.task_id = i.task_id`;

/**
 * How the invoice and its task came to be linked, for the coverage breakdown.
 *
 * Read from `task_link_source`, which the transform stamps — never re-derived here.
 * The four states are not degrees of the same thing: EXPLICIT and AMBIGUOUS come from
 * a link CRM recorded, TRIGGERED and COVERED from our own inference over the charged
 * billing group. Labels say which, because "the task CRM says chased this invoice" and
 * "the task we believe chased it" are different claims and the reader is entitled to
 * know which one they are looking at. See collections_invoice.transform.sql.
 */
export const TASK_LINK_CASE = `
  CASE i.task_link_source
    WHEN 'COVERED' THEN 'Added to Existing Task'
    WHEN 'EXPLICIT' THEN 'New Task Created'
    WHEN 'AMBIGUOUS' THEN 'New Task Created'
    WHEN 'TRIGGERED' THEN 'New Task Created'
    ELSE 'No Task Created' END`;

/**
 * Outreach logged against that task, split around the moment the invoice was resolved.
 *
 * WHAT A TOUCH IS. A logged move along the CRM status ladder, not "a contact attempt".
 * The touch extractor reads status changes, so a call that was made and never logged is
 * absent and a status correction with no customer contact is present. The page labels
 * them as logged status moves for that reason; widening the claim would need the call,
 * email and dunning channels ingested and reconciled, not this column relabelled.
 *
 * WHY THE SPLIT. Every touch on the task used to be counted, over its whole life, and
 * presented as the effort that recovered the invoice. Work logged AFTER the money
 * arrived is therefore reported as work that brought it in. Invoice 1919497 is the
 * worked example: 419.40 was credit-memoed on 08-06 at 15:07:40 Eastern, and of the
 * five touches on task 1104623 three precede it (Declined CC #1, #2, #3) and two follow
 * it (Credit Memo - No Contact 53 seconds later, Not Reactivated - Contacted an hour
 * after that). Reporting five overstates the effort by two thirds on that invoice, and
 * at least 42 declined invoices carry post-resolution touches this way.
 *
 * THE BOUNDS. Lower bound is the invoice's own decline, so a task covering several
 * cycles does not credit this invoice with the previous one's outreach; it is compared
 * in Eastern because order_date is a calendar day and created_on is a UTC instant (see
 * easternTime.ts). Upper bound is the financial event — first cash if any, otherwise
 * the credit memo. An invoice that is still open has no upper bound, which is correct:
 * all of its outreach is still pre-resolution.
 *
 * SAME-SECOND EVENTS ARE NOT ASSIGNED. A touch stamped at exactly the financial event
 * cannot be shown to precede or follow it — CRM writes both from the same workflow and
 * the ordering is not recoverable from the data. Counting it as "before" would inflate
 * effort and counting it as "after" would erase it, so it is returned separately and
 * the reader is told the count is unresolved rather than given a confident wrong number.
 *
 * Lifetime activity stays available alongside, because "how much work did this task
 * take in total" is a real question — it is just not the same question as "what did it
 * take to resolve this invoice".
 *
 * SCOPED TO THE WINDOW (perf). Both derived tables used to be unbounded: `tc` grouped
 * every row of the touch fact, and `placed` joined EVERY invoice in the warehouse to
 * its task's touches — ~253k invoices to produce lookups for the ~8.6k in the cycle.
 * Both are keyed by something only a scoped invoice can present (`tc` by task_id, `tw`
 * by order_id), so restricting them to the scoped rows drops only rows that were never
 * going to be joined. `tc` is restricted with `IN (task_id...)` rather than a join to
 * the invoice fact deliberately: several invoices can share one task, and joining would
 * fan out and multiply the COUNT.
 */
export const touchJoin = (scope: CycleScope): SqlPart => {
  const tasks = scope.keySet('task_id');
  const invoices = scope.rowSet('iv');
  return {
    sql: `
  LEFT JOIN (
    SELECT task_id, COUNT(*) AS touches
      FROM ie_fact_collections_touch
     WHERE task_id IN (${tasks.sql})
     GROUP BY task_id
  ) tc ON tc.task_id = i.task_id
  LEFT JOIN (
    SELECT order_id,
           SUM(placement = 'BEFORE')   AS touches_before,
           SUM(placement = 'AFTER')    AS touches_after,
           SUM(placement = 'SAME_SEC') AS touches_same_second
      FROM (
        SELECT iv.order_id,
               CASE
                 WHEN ${financialEvent('iv')} IS NULL            THEN 'BEFORE'
                 WHEN ft.created_on = ${financialEvent('iv')}    THEN 'SAME_SEC'
                 WHEN ft.created_on <  ${financialEvent('iv')}   THEN 'BEFORE'
                 ELSE 'AFTER'
               END AS placement
          FROM ie_fact_collections_invoice iv
          JOIN ie_fact_collections_touch ft
            ON ft.task_id = iv.task_id
           AND ${easternInstant('ft.created_on')} >= iv.order_date
         WHERE ${invoices.sql}
      ) placed
     GROUP BY order_id
  ) tw ON tw.order_id = i.order_id`,
    params: [...tasks.params, ...invoices.params],
  };
};
