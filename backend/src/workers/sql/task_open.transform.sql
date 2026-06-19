/* Tasks transform (primary pool): ie_stg_ticket_task -> ie_fact_ticket_task.
   SNAPSHOT load: replace only the 'Task' slice of the fact (the ticket_open
   report owns the 'Ticket' slice independently), then re-insert the conformed
   current snapshot. Runs inside the worker's transaction.
   date_key = the snapshot day (YYYYMMDD). Identity conform: assignee email ->
   ie_dim_employee (current row).
   NOTE: block comments only — the splitter discards line-comment-led statements. */
DELETE FROM ie_fact_ticket_task WHERE process_type = 'Task';

INSERT INTO ie_fact_ticket_task
  (date_key, employee_key, agent_email, agent_name, process_type, task_id, ticket_id,
   customer_id, customer_name, classification, sub_classification, dept, status,
   created_on, next_contact, last_touched_on, last_touched_by, closed_on, closed_by,
   crm_url, load_batch_id)
SELECT
  CAST(DATE_FORMAT(NOW(), '%Y%m%d') AS UNSIGNED),
  e.employee_key,
  s.email,
  s.assigned_to,
  s.process_type,
  s.task_id,
  s.ticket_id,
  s.customer_id,
  s.customer_name,
  s.classification,
  s.sub_classification,
  s.dept,
  s.status,
  s.created_on,
  s.next_contact,
  s.last_touched_on,
  s.last_touched_by,
  s.closed_on,
  s.closed_by,
  s.crm_url,
  CONCAT('task_open:', :pToDate)
FROM ie_stg_ticket_task s
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email))
WHERE s.process_type = 'Task';
