/* Order margin transform (primary pool): ie_stg_order_margin -> ie_fact_order_margin.
   Load mode FULL_RELOAD_WINDOW: delete the re-extracted margin-eligibility window,
   then re-insert conformed rows. Idempotent for the window so re-runs never
   double-count and an order's mutable margin/refund rows refresh.
   Identity conform: email -> ie_dim_employee (current row); margin_eligible_date ->
   ie_dim_date. Grain is preserved 1:1 from staging (one row per order/refund).
   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_order_margin
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_order_margin
  (date_key, employee_key, salesperson_email, salesperson_name, order_id, refund_id,
   order_type, customer_id, customer_name, lead_source,
   product_margin, install_margin, shipping_margin, warranty_margin, total_margin,
   order_sub_count, order_sub_count_sub_only, sub_only, with_labor, with_radio, load_batch_id)
SELECT
  d.date_key,
  e.employee_key,
  s.email,
  s.salesperson_name,
  s.order_id,
  IFNULL(s.refund_id, 0),
  s.order_type,
  s.customer_id,
  s.customer_name,
  s.lead_source,
  IFNULL(s.product_margin, 0),
  IFNULL(s.install_margin, 0),
  IFNULL(s.shipping_margin, 0),
  IFNULL(s.warranty_margin, 0),
  IFNULL(s.total_margin, 0),
  IFNULL(s.order_sub_count, 0),
  IFNULL(s.order_sub_count_sub_only, 0),
  IFNULL(s.sub_only, 0),
  IFNULL(s.with_labor, 0),
  IFNULL(s.with_radio, 0),
  CONCAT('order_margin:', :pFromDate, '..', :pToDate)
FROM ie_stg_order_margin s
JOIN ie_dim_date d
  ON d.full_date = DATE(s.margin_eligible_date)
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email));
