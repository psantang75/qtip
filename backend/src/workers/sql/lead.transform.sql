/* Leads transform (primary pool): ie_stg_lead -> ie_fact_lead.
   Load mode FULL_RELOAD_WINDOW: delete the re-extracted created-date window, then
   re-insert conformed rows. Idempotent for the window so re-runs never double-count
   and a lead's mutable conversion/paid flags refresh.
   Identity conform: email -> ie_dim_employee (current row); created_on -> ie_dim_date.
   Grain is preserved 1:1 from staging (one row per qualifying lead-task).
   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_lead
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_lead
  (date_key, employee_key, salesperson_email, salesperson_name, customer_lead_id,
   order_id, lead_source_category, lead_source, task_status,
   lead_total, lead_converted_total, lead_total_paid, load_batch_id)
SELECT
  d.date_key,
  e.employee_key,
  s.email,
  s.salesperson_name,
  s.customer_lead_id,
  s.order_id,
  s.lead_source_category,
  s.lead_source,
  s.task_status,
  s.lead_total,
  s.lead_converted_total,
  s.lead_total_paid,
  CONCAT('lead:', :pFromDate, '..', :pToDate)
FROM ie_stg_lead s
JOIN ie_dim_date d
  ON d.full_date = DATE(s.created_on)
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email));
