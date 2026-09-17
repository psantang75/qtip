/* Collections Task transform (primary pool): ie_stg_collections_task ->
   ie_fact_collections_task. FULL_RELOAD_WINDOW: delete the re-extracted date_key
   window, then re-insert. date -> ie_dim_date; agent email -> ie_dim_employee.
   NOTE: block comments only — the splitter drops line-comment-led statements. */
DELETE FROM ie_fact_collections_task
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_task
  (date_key, task_id, task_type_id, campaign_key, billing_group_id, customer_id,
   agent_email, employee_key, created_on, final_status_id, final_status_label,
   outcome, is_success, terminated_flag, load_batch_id)
SELECT
  d.date_key,
  s.task_id,
  s.task_type_id,
  s.campaign_key,
  s.billing_group_id,
  s.customer_id,
  s.agent_email,
  e.employee_key,
  s.created_on,
  s.final_status_id,
  s.final_status_label,
  IFNULL(s.outcome, 'OPEN'),
  IFNULL(s.is_success, 0),
  IFNULL(s.terminated_flag, 0),
  CONCAT('collections_task:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_task s
JOIN ie_dim_date d
  ON d.full_date = s.created_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.agent_email))
WHERE s.campaign_key IS NOT NULL;
