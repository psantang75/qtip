/* Collections Billing Attempts transform (primary pool): ie_stg_collections_billing
   -> ie_fact_collections_billing. FULL_RELOAD_WINDOW: delete the re-extracted
   date_key window, then re-insert. date -> ie_dim_date. NOTE: block comments only.

   TASK LINK: a declined CARD raises its AR task within seconds (billing group 9961
   declined at 07:31:06 and the task appeared at 07:31:07). ACH does NOT behave that
   way — a return posts against the cycle date but the task is raised 3-21 days later
   (median ~6), so a same-day match left task_id NULL on all but 1 of July 2026's 39
   ACH tasks. The link is therefore "earliest task on the same billing group and the
   same campaign, created on or after the attempt, within 30 days".

   Two guards keep that window from mis-claiming: the campaign must match, so a 1st-of
   -month decline cannot pick up a 16th-of-month task; and if a LATER decline on the
   same group and campaign falls between this attempt and the task, that decline owns
   the task instead (ACH groups do re-present, e.g. 112688 on both 07-20 and 07-21).

   Only DECLINED rows are matched — a settled charge has no campaign to join to, and
   matching it would let an unrelated task on the same group make a successful billing
   look chased.

   order_id / charge_last4 come straight from the gateway's PaymentOrderId and Last4 on
   the FIRST answered row of the day, so they describe the same attempt as first_result.
   order_id is what lets Cycle Performance and the funnel count by invoice instead of by
   billing group; charge_last4 separates "moved to a new billing group" from "same group,
   card re-keyed" on the recovery-path report. The grain is unchanged — 99.92% of
   cycle-day billing-group-days charge exactly one invoice, so uq_fcb_bg still holds. */
DELETE FROM ie_fact_collections_billing
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_billing
  (date_key, billing_group_id, customer_id, order_id, pm_type, charge_last4,
   campaign_key, attempted_amount, attempts, first_result, decline_reason,
   result_message, transaction_type, settled_amount, settled_on, task_id, load_batch_id)
SELECT
  d.date_key,
  s.billing_group_id,
  s.customer_id,
  s.order_id,
  s.pm_type,
  s.charge_last4,
  s.campaign_key,
  IFNULL(s.attempted_amount, 0),
  IFNULL(s.attempts, 0),
  IFNULL(s.first_result, 'OK'),
  s.decline_reason,
  s.result_message,
  s.transaction_type,
  IFNULL(s.settled_amount, 0),
  s.settled_on,
  t.task_id,
  CONCAT('collections_billing:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_billing s
JOIN ie_dim_date d
  ON d.full_date = s.attempt_date
LEFT JOIN ie_fact_collections_task t
  ON s.first_result = 'DECLINED'
 AND t.billing_group_id = s.billing_group_id
 AND t.campaign_key = s.campaign_key
 AND t.created_on >= s.attempt_date
 AND t.created_on < DATE_ADD(s.attempt_date, INTERVAL 30 DAY)
 AND NOT EXISTS (
   SELECT 1 FROM ie_fact_collections_task t2
   WHERE t2.billing_group_id = s.billing_group_id
     AND t2.campaign_key = s.campaign_key
     AND t2.created_on >= s.attempt_date
     AND t2.created_on < t.created_on
 )
 AND NOT EXISTS (
   SELECT 1 FROM ie_stg_collections_billing s2
   WHERE s2.billing_group_id = s.billing_group_id
     AND s2.campaign_key = s.campaign_key
     AND s2.first_result = 'DECLINED'
     AND s2.attempt_date > s.attempt_date
     AND s2.attempt_date <= DATE(t.created_on)
 )
WHERE s.billing_group_id IS NOT NULL;
