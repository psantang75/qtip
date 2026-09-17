/* Collections Invoice transform (primary pool): ie_stg_collections_invoice ->
   ie_fact_collections_invoice. FULL_RELOAD_WINDOW: delete the re-extracted date_key
   window, then re-insert. date -> ie_dim_date. NOTE: block comments only.

   TASK LINK: `task_id` is the AR task that chased this invoice, and `task_link_source`
   says how we know. Four ways an invoice and a task belong together, in that order of
   preference:

     EXPLICIT  — CRM recorded the link itself in tblTaskOrder (AR task types only; see
                 the extract). Authoritative, and the only evidence that reaches an
                 invoice whose task CRM filed against a different billing group.
                 Invoice 1919833 is that case: it declined on group 68054 and its AR
                 task 1104237 is recorded against 112957, the group that later paid, so
                 no group-keyed rule can find it. Across 2026-08/09 there are 103 such
                 links over 88 invoices; they agree with the inference on 35, overrule
                 it on 13 worth 6,911.42, and supply 55 worth 8,741.62 it misses.
     AMBIGUOUS — several AR tasks link explicitly. The earliest is used, because one
                 task has to be chosen for attribution to stay single-owner, but the
                 doubt is recorded so the page can say so rather than imply certainty.
     TRIGGERED — a task raised on or after the invoice was written, while it was still
                 owed. The invoice CAUSED the task, so the invoice's `paid_on` is the
                 task's success date, which is the definition the business uses ("the
                 invoice that triggered the task for that month; use its paid date as
                 success").
     COVERED   — no task was raised, but one opened earlier on the same card is STILL
                 OPEN, so the invoice landed inside a collection effort already under
                 way. Invoice 1932164 is the shape of it: task 1083006 opened 2026-05-07
                 against group 65482 and is still 'Contact Attempted' today, so the
                 08-16 invoice was never going to raise a second task. Reading that as
                 "no task" credited the agent with nothing and hid the invoice from
                 every task-based measure. 107 August/September invoices are in this
                 state. Openness is the status flag, not a date — closed AR tasks
                 frequently never get a CompletedOn (see collections_task.extract.sql),
                 so "was it open THEN" is not answerable and "is it open NOW" is,
                 which is sound here because a task still open cannot have closed
                 before the invoice.

   The inference below only runs when there is no explicit link, so the two never
   compete; `task_link_source` is what the read layer reads, never a re-derivation.

   ON WHICH BILLING GROUP (the inference only). The group the run CHARGED
   (card_billing_group_id, resolved
   from tblRecurringItems), NOT the order header. CRM rewrites tblOrders.BillingGroupID
   to whichever group later paid, so the header points at the wrong card for 736
   August/September invoices worth 376,075.37. Customer 122706 shows the damage: three
   AR tasks opened on 2026-08-01 against groups 78510, 98280 and 109639, and matching on
   the rewritten header handed invoice 1923909 — charged on 98280 — the 109639 task.
   Against the charged group it gets 1104608, its own. Correcting the key moves 40 links,
   adds 677 triggered and 107 covered ones, and drops 3 where the only task sits on a
   group the run never touched (two of those settled cleanly and should never have owned
   an AR task at all). There is deliberately no fallback to the header: an unprovable
   link is worse than an absent one.

   Ties are broken by closeness in time to the invoice and then by task_id, so a
   same-second pair is resolved deterministically rather than by scan order — customer
   128629's tasks 1112653 and 1112654 were both created at 2026-09-01 04:00:14 and are
   separated only by their billing group.

   EASTERN(t.created_on) IS NOT DECORATION. `created_on` is a UTC instant and
   `order_date` is an Eastern calendar day, so comparing them raw misreads anything
   logged in the last four hours of an Eastern day as belonging to the next one — which
   is precisely the boundary that decides TRIGGERED from COVERED. The expression is the
   SQL twin of easternInstant() in
   backend/src/services/insights/collections/easternTime.ts, which is where the
   reasoning and the DST rule live; it is spelled out here because this file is raw SQL
   run by the worker and cannot import it. Change one and change the other.

   The `tsk` CTE carries BOTH forms on purpose. Every comparison against order_date, a
   calendar day, uses created_et; the already-paid guard compares against paid_on, which
   is itself a UTC instant, so it uses created_on. Converting that one too would move
   both sides and reintroduce the error it is there to avoid.

   Validated on the June 2026 Declined CC (1st) cohort (2026-09-07). The recurring run
   writes the invoice and charges the card the same day, so a DECLINED invoice carries
   the task's own creation date: of the 164 candidates at offset 0, exactly ZERO were
   paid before the task existed (that is why the task exists) and 103 were recovered
   afterwards, average $113.80, typically within ~2 days of the agent making contact.
   The 201 candidates a month earlier (offset -31) are the PRIOR cycle's invoice, and
   168 of them were already paid the day they were issued — linking those produced a
   $13 "amount at risk" per task and a negative time-to-recovery. The
   `NOT (is_cash_paid = 1 AND paid_on < created_on)` guard is what excludes them.

   Choosing the EARLIEST qualifying task also keeps attribution single-owner: an
   invoice that stays unpaid across several cycles belongs to the campaign that first
   chased it, so it cannot be counted again by every later cohort. The 120-day window
   covers quarterly and annual billing groups, whose invoice is written well before the
   cycle on which the card declines; it now reaches backwards by the same 120 days for
   the COVERED arm, so the two are symmetric.

   CAMPAIGN. A RECURRING invoice derives its campaign from the RUN that produced it, not
   from whichever task happened to sit on the same billing group. Inheriting from the task
   meant an invoice had no campaign at all until a task existed — so every successfully
   collected cycle invoice, which never raises a task, fell out of the denominator and the
   cycle looked like nothing but declines.

   The run's payment type comes from tblRecurring (staged as recurring_payment_type) and
   is immutable. An earlier version of this read bg.PMType instead, which is the billing
   group's method TODAY: on 2026-08-01 that put 75 invoices from the check run and 5 from
   the ACH run into Declined CC (1st). A RecurringID does not distinguish the passes — 520
   wrote both 08-01 and 08-16 — so the invoice's own day still picks 1st vs 16th.
   RecurringID 520 on 2026-08-01 is then exactly the 7,942 invoices / $831,573.20 of the
   hand-built August review, which is what makes the page reconcilable to CRM.

   ACH RUNS TWO PASSES TOO, and it used to be reported as one. The ACH run has always
   billed on both the 1st and the 16th — the gateway log carries ACH order ids on both
   cycles (see collections_billing.extract.sql) — but every ACH invoice was filed under a
   single 'ACH' campaign whose cycle was recorded as 'NA'. That made ACH the only
   instrument whose two cycles could not be compared with each other, and it silently
   averaged two populations: the 16th pass is a different book of accounts from the 1st,
   not a continuation of it. The day rule is the same one card already uses, and it is
   exact here for the same reason — order_date IS the run date, by construction.

   Order types 1 (Order) and 6 (Reactivation) have no run, so recurring_payment_type is
   NULL and they fall through to pm_type and then to the task's campaign.

   CARD STATE. card_expire_ym / card_last4 arrive from the extract already resolved BOTH
   to the group the recurring run actually charged (tblRecurringItems, not the rewritten
   invoice header) and to the invoice's own date (tblBillingGroupsArchive), so nothing
   here re-reads the live billing group. This derives the bucket the Cycle page splits
   "Never attempted" on:

     EXPIRED — the card on file had already lapsed when the run charged it. This is the
               one actionable state and the only one the page separates out.
     VALID   — the card was in date, so the run had no reason not to try it. These are
               the real anomalies worth chasing.
     UNKNOWN — we cannot honestly say. Either we had to read the LIVE billing group and
               that group post-dates the invoice, or the expiry is a sentinel rather
               than a date.

   THE POST-DATES-THE-INVOICE GUARD ONLY APPLIES TO A LIVE READ. It used to fire on any
   group whose CreatedOn was later than the invoice, which was far too broad, because CRM
   REWRITES CreatedOn when a card is re-keyed in place. It therefore fired on precisely
   the customers who fixed their card: group 76262 reads CreatedOn 2026-08-03, the moment
   the customer extended the same card (last4 5032 before and after), while the archive
   plainly shows it expired 07/2026 — expired on the 08-01 run that skipped it. Three
   August invoices were buried in UNKNOWN that way. When tblBillingGroupsArchive gave us
   the card as of the invoice date, its provenance is not in doubt and CreatedOn is
   irrelevant; the guard is only meaningful for the live fallback, which card_from_archive
   identifies.

   There is deliberately NO "replaced" state any more. It only ever existed because the
   card was read off tblOrders.BillingGroupID, which CRM repoints at whichever group
   later paid — so "the group is newer than the invoice" was measuring our own bad join,
   not a customer action. Against the group the run really charged, 3 of the 5 invoices
   that carried it on 2026-09-01 were plain expired cards. Expired is expired.

   TWO SENTINELS, NOT A PAYMENT-TYPE GATE. The previous rule refused to classify unless
   the run's payment type was 1, which suppressed genuinely expired cards (invoice
   1944508, card expiring 202512, came out NULL), and it accepted any positive expiry,
   which let epoch junk like 197001 read as EXPIRED (invoice 1936253). Rejecting the two
   sentinel ranges directly is both stricter and wider: check groups carry 1/1970 and
   ACH groups default to 12/2100 in CRM, so both fall out as UNKNOWN on their own without
   a payment-type test that a real card can fail. */
DELETE FROM ie_fact_collections_invoice
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_invoice
  (date_key, order_id, billing_group_id, customer_id, task_id, task_link_source,
   campaign_key,
   order_type_id, recurring_id, recurring_payment_type, pm_type, card_billing_group_id,
   card_expire_ym, card_last4, card_state, pay_request_state, is_reactivation,
   order_date, due_date, invoice_amount, currency_code,
   cash_collected, credit_memo_amount, writeoff_amount, refund_amount, open_balance,
   outcome, is_cash_paid, paid_on, first_cash_on, credit_memo_on, load_batch_id)
WITH tsk AS (
  SELECT task_id, billing_group_id, campaign_key, outcome, created_on,
         DATE_SUB(created_on, INTERVAL IF(
           created_on >= TIMESTAMPADD(HOUR, 7, DATE_ADD(DATE_ADD(
                           DATE(CONCAT(YEAR(created_on), '-03-01')),
                           INTERVAL ((8 - DAYOFWEEK(DATE(CONCAT(YEAR(created_on), '-03-01')))) MOD 7) DAY),
                         INTERVAL 7 DAY))
       AND created_on <  TIMESTAMPADD(HOUR, 6, DATE_ADD(
                           DATE(CONCAT(YEAR(created_on), '-11-01')),
                           INTERVAL ((8 - DAYOFWEEK(DATE(CONCAT(YEAR(created_on), '-11-01')))) MOD 7) DAY)),
           4, 5) HOUR)                                AS created_et
    FROM ie_fact_collections_task
)
SELECT
  d.date_key,
  s.order_id,
  s.billing_group_id,
  s.customer_id,
  /* The explicit link wins outright; the inference is only consulted when CRM recorded
     nothing. `tk` guards against an explicit link pointing at a task outside this
     report's AR fact — the id is real in CRM but we hold no row for it, and attributing
     to a task we cannot describe would be worse than falling back. */
  COALESCE(tk.task_id, t.task_id)                              AS task_id,
  CASE
    WHEN tk.task_id IS NOT NULL AND s.crm_task_count > 1 THEN 'AMBIGUOUS'
    WHEN tk.task_id IS NOT NULL                          THEN 'EXPLICIT'
    WHEN t.task_id IS NULL                               THEN NULL
    WHEN t.created_et >= s.order_date                    THEN 'TRIGGERED'
    ELSE 'COVERED'
  END                                                          AS task_link_source,
  COALESCE(
    CASE WHEN s.order_type_id = 3 THEN
      CASE
        WHEN s.recurring_payment_type = 1 AND DAY(s.order_date) < 16  THEN 'CC_1_15'
        WHEN s.recurring_payment_type = 1 AND DAY(s.order_date) >= 16 THEN 'CC_16_31'
        WHEN s.recurring_payment_type = 3 AND DAY(s.order_date) < 16  THEN 'ACH_1_15'
        WHEN s.recurring_payment_type = 3 AND DAY(s.order_date) >= 16 THEN 'ACH_16_31'
        WHEN s.recurring_payment_type = 2                             THEN 'CHECK'
        WHEN s.recurring_payment_type IS NULL AND s.pm_type = 1
             AND DAY(s.order_date) < 16                               THEN 'CC_1_15'
        WHEN s.recurring_payment_type IS NULL AND s.pm_type = 1
             AND DAY(s.order_date) >= 16                              THEN 'CC_16_31'
        WHEN s.recurring_payment_type IS NULL AND s.pm_type = 3
             AND DAY(s.order_date) < 16                               THEN 'ACH_1_15'
        WHEN s.recurring_payment_type IS NULL AND s.pm_type = 3
             AND DAY(s.order_date) >= 16                              THEN 'ACH_16_31'
        WHEN s.recurring_payment_type IS NULL AND s.pm_type = 2        THEN 'CHECK'
      END
    END,
    COALESCE(tk.campaign_key, t.campaign_key))         AS campaign_key,
  s.order_type_id,
  s.recurring_id,
  s.recurring_payment_type,
  s.pm_type,
  s.card_billing_group_id,
  s.card_expire_ym,
  s.card_last4,
  CASE
    WHEN s.card_billing_group_id IS NULL                       THEN NULL
    WHEN IFNULL(s.card_from_archive, 0) = 0
     AND s.card_group_created_on > s.order_date                THEN 'UNKNOWN'
    WHEN IFNULL(s.card_expire_ym, 0) < 200001
      OR s.card_expire_ym >= 210001                            THEN 'UNKNOWN'
    WHEN s.card_expire_ym < (YEAR(s.order_date) * 100 + MONTH(s.order_date))
                                                               THEN 'EXPIRED'
    ELSE 'VALID'
  END                                                          AS card_state,
  s.pay_request_state,
  IFNULL(s.is_reactivation, 0),
  s.order_date,
  s.due_date,
  IFNULL(s.invoice_amount, 0),
  s.currency_code,
  IFNULL(s.cash_collected, 0),
  IFNULL(s.credit_memo_amount, 0),
  IFNULL(s.writeoff_amount, 0),
  IFNULL(s.refund_amount, 0),
  IFNULL(s.open_balance, 0),
  IFNULL(s.outcome, 'OPEN'),
  IFNULL(s.is_cash_paid, 0),
  s.paid_on,
  s.first_cash_on,
  s.credit_memo_on,
  CONCAT('collections_invoice:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_invoice s
JOIN ie_dim_date d
  ON d.full_date = s.order_date
LEFT JOIN tsk tk
  ON tk.task_id = s.crm_task_id
LEFT JOIN tsk t
  ON tk.task_id IS NULL
 AND t.billing_group_id = COALESCE(s.card_billing_group_id, s.billing_group_id)
 AND ( (t.created_et >= s.order_date
        AND t.created_et <= DATE_ADD(s.order_date, INTERVAL 120 DAY))
    OR (t.created_et <  s.order_date
        AND t.created_et >= DATE_SUB(s.order_date, INTERVAL 120 DAY)
        AND t.outcome LIKE 'OPEN%') )
 AND NOT (s.is_cash_paid = 1 AND s.paid_on < t.created_on)
 AND NOT EXISTS (
   SELECT 1 FROM tsk t2
   WHERE t2.billing_group_id = COALESCE(s.card_billing_group_id, s.billing_group_id)
     AND ( (t2.created_et >= s.order_date
            AND t2.created_et <= DATE_ADD(s.order_date, INTERVAL 120 DAY))
        OR (t2.created_et <  s.order_date
            AND t2.created_et >= DATE_SUB(s.order_date, INTERVAL 120 DAY)
            AND t2.outcome LIKE 'OPEN%') )
     AND NOT (s.is_cash_paid = 1 AND s.paid_on < t2.created_on)
     AND (IF(t2.created_et >= s.order_date, 1, 2),
          ABS(TIMESTAMPDIFF(SECOND, s.order_date, t2.created_et)), t2.task_id)
       < (IF(t.created_et  >= s.order_date, 1, 2),
          ABS(TIMESTAMPDIFF(SECOND, s.order_date, t.created_et)),  t.task_id)
 );
