/* Collections Recovery transform (primary pool): ie_stg_collections_recovery ->
   ie_fact_collections_recovery. INCREMENTAL_WINDOW: delete the re-extracted date_key
   window, then re-insert. date -> ie_dim_date; agent email -> ie_dim_employee.
   NOTE: block comments only.

   TASK ATTRIBUTION is invoice-level: the cash was applied to a specific order, and
   ie_fact_collections_invoice already knows which task that order triggered, so the
   payment inherits the task from its own invoice. This is what lets one task keep
   collecting across several invoices (a task stays open while another invoice on the
   group still carries a balance) without guessing from dates.

   The billing-group join is only a fallback for cash applied to an order outside the
   collectible invoice set, and it is bounded to tasks that already existed when the
   payment landed (`created_on <= applied_date`) — the previous rule allowed a task
   created up to 45 days LATER to claim the payment, which handed June's cash to the
   July cohort. Requires the collections_invoice transform to have run first (the
   nightly full-reload rebuilds the trailing window before this hourly job).

   FALLBACK GATE (added 2026-09-10). The fallback now fires ONLY when the payment's own
   order is not a known invoice (`iv.order_id IS NULL`). It previously fired whenever the
   invoice had no task, which is the normal state of a cycle invoice that paid on time —
   so the NEXT cycle's successful auto-payment fell through to the billing group and was
   claimed by the PREVIOUS cycle's still-open task. That is how September money was being
   reported as August recovery. If cash lands on a known invoice, that invoice owns the
   attribution outright; an invoice nobody chased contributes no task, which is correct. */
DELETE FROM ie_fact_collections_recovery
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_recovery
  (date_key, payments_credits_order_id, payment_credit_id, order_id, billing_group_id,
   payment_last4,
   task_id, campaign_key, payment_type, processor_crm_id, processor_kind, agent_email,
   processor_name, employee_key, amount, applied_on, attributed_touch_seq, is_reversed,
   load_batch_id)
SELECT
  d.date_key,
  s.payments_credits_order_id,
  s.payment_credit_id,
  s.order_id,
  s.billing_group_id,
  s.payment_last4,
  COALESCE(iv.task_id, t.task_id),
  COALESCE(iv.campaign_key, t.campaign_key),
  s.payment_type,
  s.processor_crm_id,
  IFNULL(s.processor_kind, 'NO_AGENT'),
  s.agent_email,
  s.processor_name,
  e.employee_key,
  IFNULL(s.amount, 0),
  s.applied_on,
  (SELECT MAX(tc.touch_seq)
     FROM ie_fact_collections_touch tc
    WHERE tc.task_id = COALESCE(iv.task_id, t.task_id)
      AND tc.touch_seq IS NOT NULL
      AND tc.created_on <= s.applied_on),
  IFNULL(s.is_reversed, 0),
  CONCAT('collections_recovery:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_recovery s
JOIN ie_dim_date d
  ON d.full_date = s.applied_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.agent_email))
LEFT JOIN ie_fact_collections_invoice iv
  ON iv.order_id = s.order_id
LEFT JOIN ie_fact_collections_task t
  ON iv.order_id IS NULL
 AND t.billing_group_id = s.billing_group_id
 AND t.created_on <= s.applied_date
 AND t.created_on >= DATE_SUB(s.applied_date, INTERVAL 60 DAY)
 AND NOT EXISTS (
   SELECT 1 FROM ie_fact_collections_task t2
   WHERE t2.billing_group_id = s.billing_group_id
     AND t2.created_on <= s.applied_date
     AND t2.created_on >= DATE_SUB(s.applied_date, INTERVAL 60 DAY)
     AND (t2.created_on > t.created_on
          OR (t2.created_on = t.created_on AND t2.task_id > t.task_id))
 );
