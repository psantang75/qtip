-- collections_subscription TRANSFORM (warehouse)
-- FULL_RELOAD_WINDOW: rebuild the window (delete by date_key, re-insert) so status
-- and termination changes on open subscriptions are recaptured nightly. date_key is
-- the INVOICE's date, matching the extract's OrderDate window, so the delete and the
-- insert cover exactly the same rows.
--
-- THE INVOICE CARRIES THE TASK AND THE CAMPAIGN — nothing here re-derives either.
-- The extract now returns (recurring invoice, service billed on it) and knows
-- nothing about tasks, so this joins ie_fact_collections_invoice on order_id to
-- inherit the task link collections_invoice.transform.sql already resolved
-- (EXPLICIT > AMBIGUOUS > TRIGGERED > COVERED) and the campaign it derived from the
-- run. A second task-matching rule here is precisely the drift this codebase keeps
-- paying for: the ACH 1st/16th split depends on the run behind the invoice, which
-- a task's created date cannot see.
--
-- The join cannot fan out: order_id is UNIQUE on the invoice fact (uq_fci_order).
--
-- INNER JOIN, AND task_id IS NOT NULL, ON PURPOSE. The fact's grain is the
-- collections cohort — services billed by an invoice that an AR task chased. A
-- recurring invoice that collected cleanly never raises a task and has no place
-- here; it is already the denominator on the invoice fact, which deliberately
-- covers the whole billing run.
--
-- DEPENDS ON ie_fact_collections_invoice BEING LOADED FOR THE SAME WINDOW. Both are
-- FULL_RELOAD_WINDOW on the invoice's own date, so a backfill or dispatch that runs
-- the invoice report first leaves them consistent; running this against a stale
-- invoice window yields rows whose task link predates the current attribution.
DELETE FROM ie_fact_collections_subscription
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_subscription
  (date_key, service_id, billing_group_id, customer_id, task_id, campaign_key,
   order_part_id, order_id, service_status, outcome, term_reason_id, term_reason_text,
   is_ar_reason, term_recorded_on, term_effective_on, terminated_by_crm_id,
   status_at_outcome, reactivated_on, mrr_amount, load_batch_id)
-- STRAIGHT_JOIN because staging carries no indexes. Left to its own devices the
-- optimizer drove this from ie_fact_collections_invoice and re-scanned the staging
-- table for every invoice row, which took one 15-day chunk past 25 minutes without
-- finishing. Staging must drive: it is the small side, and each probe into the
-- invoice fact is a unique-key lookup on uq_fci_order.
SELECT STRAIGHT_JOIN
  d.date_key,
  s.service_id,
  s.billing_group_id,
  s.customer_id,
  inv.task_id,
  inv.campaign_key,
  s.order_part_id,
  s.order_id,
  s.service_status,
  IFNULL(s.outcome, 'RETAINED'),
  s.term_reason_id,
  s.term_reason_text,
  IFNULL(s.is_ar_reason, 0),
  s.term_recorded_on,
  s.term_effective_on,
  s.terminated_by_crm_id,
  -- The chasing task's status, from the task fact rather than a second CRM lookup.
  tk.final_status_label,
  s.reactivated_on,
  IFNULL(s.mrr_amount, 0),
  CONCAT('collections_subscription:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_subscription s
JOIN ie_dim_date d
  ON d.full_date = s.cohort_date
JOIN ie_fact_collections_invoice inv
  ON inv.order_id = s.order_id
LEFT JOIN ie_fact_collections_task tk
  ON tk.task_id = inv.task_id
WHERE s.service_id IS NOT NULL
  AND inv.task_id IS NOT NULL
  AND inv.campaign_key IS NOT NULL;
