/* Call Activity transform (primary pool): ie_stg_call_activity -> ie_fact_call_activity.
   Load mode INCREMENTAL_WINDOW: delete the re-extracted day range, then re-insert
   conformed rows. Idempotent for the window so re-runs never double-count.
   Identity conform: email -> ie_dim_employee (current row); date -> ie_dim_date.
   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_call_activity
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_call_activity
  (date_key, employee_key, agent_email, agent_name,
   call_direction, call_count, calls_over_3min, call_mins, hold_mins, line_mins, load_batch_id)
SELECT
  d.date_key,
  e.employee_key,
  s.email,
  MAX(s.agent_name),
  s.call_direction,
  SUM(s.call_count),
  SUM(s.calls_over_3min),
  SUM(s.call_mins),
  SUM(s.hold_mins),
  SUM(s.line_mins),
  CONCAT('call:', :pFromDate, '..', :pToDate)
FROM ie_stg_call_activity s
JOIN ie_dim_date d
  ON d.full_date = s.call_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email))
GROUP BY d.date_key, e.employee_key, s.email, s.call_direction;
