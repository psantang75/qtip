/* Collections Billing Attempts extract (source pool: crm). Grain: one billing group
   per attempt DAY, window-bound by :pFromDate / :pToDate on the gateway timestamp.

   This is the top of the Channel Effectiveness funnel — what we tried to bill, what
   went through, and what fell into a dunning campaign. It reads the gateway's own
   log because that is the only record of an attempt's OUTCOME.

   CORRECTION (2026-09-10). This file used to say a declined card leaves no invoice
   behind and that invoices undercount declines by roughly half. That was wrong — an
   artifact of joining decline -> invoice on BillingGroupID. Recurring charges the
   site / tblRecurringItems group, while the invoice header is frequently overwritten
   by whichever group later paid it, so a billing-group join loses the invoice that
   does exist. PaymentOrderId is the reliable key: it is on both the request and the
   response, and over the trailing 13 months it is populated on 99.5% of answered card
   rows and 99.9% of ACH rows (100% on the 1st cycle, 99.9% on the 16th), resolving to
   a same-day Recurring invoice for 95-100% of cycle-day declines. It is emitted below
   as order_id so the funnel can be counted by invoice.

   REQUEST/RESPONSE PAIRING. Every charge writes two rows: a request row with a NULL
   ProcessorResponseMessage, then the processor's answer. Only answered rows are
   counted here, otherwise every attempt doubles.

   FIRST RESULT WINS. A billing group can have several rows on one day (the run, then
   an agent taking a card over the phone). The funnel cares whether the RUN succeeded,
   so first_result is the earliest answer of the day via the GROUP_CONCAT/ORDER BY
   ordering idiom — MySQL 5.7 has no window functions. The separator is '||' and NOT
   a comma, because processor messages contain commas ("Suspected Card (Pick UP,
   Hot-Card)") and a comma split truncates the reason mid-string.
   settled_amount looks across the whole day so a same-day recovery is still visible
   on the row.

   KEEP THE GATEWAY'S OWN WORDS FOR EVERY RESULT. `decline_reason` is deliberately
   still NULL outside DECLINED so the decline report and its index are unchanged, but
   the raw message is now also emitted as `result_message` regardless of outcome.
   Discarding it for ERROR made "Submission error" unexplainable: all 15 ERROR rows on
   2026-09-01 carried a NULL reason, so a Validation Error could not be told apart from
   an Invalid Amount — the exact detail needed to separate an over-sized request from a
   malformed one. Longest observed message in the trailing quarter is 45 characters.

   AN UNSETTLED ANSWER IS NOT A REFUSAL. The final arm is `ELSE 'DECLINED'`, which is
   the right default for an unrecognised REFUSAL message — there are two dozen of them
   and the gateway adds more — but it also swept up the two states that mean "accepted,
   result not final yet":
     CAPTURED   a card authorisation that has been captured and is waiting on the
                batch to settle, at which point the message becomes SETTLED.
     INITIATED  an ACH debit handed to the network, which clears or returns over the
                following business days.
   Neither had been billed against the customer in error, and neither is a decline.
   Counting them as one put 6,483 rows and $372,614 into September's declines — 90% of
   the month — the morning after the 16th run, and the same spike would have appeared
   on every run day. It was invisible in closed months precisely because it resolves:
   across 15 months every CAPTURED row on file is from the last week, and all but four
   INITIATED rows. They are now IN_FLIGHT, which is neither intake nor success, so no
   report has to guess which.

   RETURNED and FAILED stay DECLINED — an ACH return IS the failure, arriving late.

   CREATED stays ERROR. It looks transient but does not behave like one: 562 rows
   spread evenly across the whole 15-month window, so it is a request that was never
   answered rather than one still in flight.

   THREE OUTCOMES, NOT TWO. A response is OK, a real customer DECLINE, or one of OUR
   OWN submission failures — and the third is not a collections event. On 2026-08-01
   billing group 112016 was submitted for $53,540.93 and came back "Validation Error";
   that account bills $30.95 a month, and the malformed request alone was 54% of the
   day's declined dollars. August carried 61 Validation Errors ($56,145, of which that
   single row is 95%), 155 System Errors, plus Error on Host, Invalid Amount and
   "Merchant (Account) configuration missing". None of them is a customer failing to
   pay, so they are classified ERROR and dropped from the funnel rather than counted
   as intake. 'CREATED' and 'VOIDED' are likewise not a charge outcome.

   AMOUNT lives in the varchar `Amount` column, not DMAmount (which is near-zero on
   almost every row). BillingGroupID is also varchar in this table, hence the CAST.

   CAMPAIGN comes from the billing group's payment method plus the cycle day: the 1st-15th
   and the 16th-31st are two separate campaigns, for ACH exactly as for card. ACH used to
   collapse into one campaign regardless of day, which contradicted this file's own
   measurement — the PaymentOrderId coverage note above reports ACH separately for the 1st
   and the 16th cycle precisely because both exist. attempt_date is the gateway's own
   timestamp, and an ACH return posts against the cycle it belongs to, so the day is the
   run's day and not the day the answer arrived. Check accounts are never card-charged and
   so never appear here at all; their billings come from ie_fact_collections_invoice.
   Aliases match ie_stg_collections_billing. */
SELECT /*+ MAX_EXECUTION_TIME(240000) */
  l.bg                                         AS billing_group_id,
  bg.CustomerID                                AS customer_id,
  CASE WHEN l.first_order_raw REGEXP '^[0-9]+$'
       THEN CAST(l.first_order_raw AS UNSIGNED) END AS order_id,
  l.attempt_date,
  bg.PMType                                    AS pm_type,
  NULLIF(l.first_last4, '')                    AS charge_last4,
  CASE
    WHEN bg.PMType = 1 AND DAY(l.attempt_date) < 16  THEN 'CC_1_15'
    WHEN bg.PMType = 1 AND DAY(l.attempt_date) >= 16 THEN 'CC_16_31'
    WHEN bg.PMType = 3 AND DAY(l.attempt_date) < 16  THEN 'ACH_1_15'
    WHEN bg.PMType = 3 AND DAY(l.attempt_date) >= 16 THEN 'ACH_16_31'
    WHEN bg.PMType = 2                               THEN 'CHECK'
  END                                          AS campaign_key,
  l.attempted_amount,
  l.attempts,
  l.first_result,
  CASE WHEN l.first_result = 'DECLINED' THEN l.first_message END AS decline_reason,
  l.first_message                              AS result_message,
  l.first_txn_type                             AS transaction_type,
  l.settled_amount,
  l.settled_on
FROM (
  SELECT
    CAST(p.BillingGroupID AS UNSIGNED)          AS bg,
    DATE(p.CreatedOn)                           AS attempt_date,
    COUNT(*)                                    AS attempts,
    CAST(SUBSTRING_INDEX(GROUP_CONCAT(
      IFNULL(NULLIF(p.Amount, ''), '0') ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1)
      AS DECIMAL(12,2))                         AS attempted_amount,
    /* VOIDED IS NOT A SUBMISSION ERROR (2026-09-14). It used to sit in the ERROR list,
       which made every reversed sale read as a malformed request of ours. Invoice
       1936494 shows why that is wrong: its 09-01 04:25:01 SALE answers VOIDED, a VOID
       at 15:13:35 answers Approved, two corrected SALEs follow and the invoice settles
       next morning at 3,182.75 against an original 3,248.60. The gateway accepted the
       sale; someone then reversed it to re-bill a corrected amount. Nine September
       invoices worth 12,618.35 were reported as our defect on that basis. A VOID
       transaction answering Approved is the reversal succeeding, not a charge, so it
       lands in the same bucket. Neither is a success either — no money stuck from that
       sale — so VOIDED is its own outcome rather than being folded into OK. */
    SUBSTRING_INDEX(GROUP_CONCAT(
      CASE WHEN p.ProcessorResponseMessage = 'VOIDED'
             OR UPPER(IFNULL(p.TransactionType, '')) = 'VOID'          THEN 'VOIDED'
           WHEN p.ProcessorResponseMessage IN ('SETTLED', 'Approved')  THEN 'OK'
           WHEN p.ProcessorResponseMessage IN ('CAPTURED', 'INITIATED')
             THEN 'IN_FLIGHT'
           WHEN p.ProcessorResponseMessage IN (
                'Validation Error', 'System Error', 'Error on Host', 'Invalid Amount',
                'Merchant (Account) configuration missing', 'CREATED')
             THEN 'ERROR'
           ELSE 'DECLINED' END ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1)
                                                AS first_result,
    SUBSTRING_INDEX(GROUP_CONCAT(
      p.ProcessorResponseMessage ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1)
                                                AS first_message,
    NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(
      IFNULL(p.TransactionType, '') ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1), '')
                                                AS first_txn_type,
    SUBSTRING_INDEX(GROUP_CONCAT(
      IFNULL(p.PaymentOrderId, '') ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1)
                                                AS first_order_raw,
    SUBSTRING_INDEX(GROUP_CONCAT(
      IFNULL(p.Last4, '') ORDER BY p.CreatedOn SEPARATOR '||'), '||', 1)
                                                AS first_last4,
    IFNULL(MAX(CASE WHEN p.ProcessorResponseMessage IN ('SETTLED', 'Approved')
                    THEN CAST(NULLIF(p.Amount, '') AS DECIMAL(12,2)) END), 0)
                                                AS settled_amount,
    MIN(CASE WHEN p.ProcessorResponseMessage IN ('SETTLED', 'Approved')
             THEN p.CreatedOn END)              AS settled_on
  FROM tblPaymentResponseLog p
  WHERE p.CreatedOn >= :pFromDate
    AND p.CreatedOn < DATE_ADD(:pToDate, INTERVAL 1 DAY)
    AND p.ProcessorResponseMessage IS NOT NULL
    AND p.BillingGroupID REGEXP '^[0-9]+$'
  GROUP BY CAST(p.BillingGroupID AS UNSIGNED), DATE(p.CreatedOn)
) l
JOIN tblBillingGroups bg
  ON bg.BillingGroupID = l.bg;
