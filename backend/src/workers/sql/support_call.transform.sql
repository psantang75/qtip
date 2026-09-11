/* Support Call transform (primary pool): ie_stg_support_call ->
   ie_fact_support_call. Load mode INCREMENTAL_WINDOW: delete the re-extracted
   date_key window, then re-insert conformed rows, so re-runs never double-count.
   Identity conform: date -> ie_dim_date; agent email -> ie_dim_employee.

   employee_key is a LEFT JOIN and may be NULL for a phone user with no
   conformed employee row (a shared/queue login, or an agent not yet synced).
   Those rows are still loaded — they are real calls — but every read joins
   ie_dim_employee to resolve the department, so they fall out of the report
   rather than landing in a wrong department. Keeping them makes the gap
   visible in the fact instead of hiding it at extract time.

   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_support_call
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_support_call
  (date_key, conversation_id, phone_user_id, employee_key, agent_email, agent_name,
   started_on, direction, talk_secs, hold_secs, wrap_secs, handle_secs,
   wrap_up_code, transferred, load_batch_id)
SELECT
  d.date_key,
  s.conversation_id,
  s.phone_user_id,
  e.employee_key,
  s.agent_email,
  s.agent_name,
  s.started_on,
  IFNULL(s.direction, 'Inbound'),
  IFNULL(s.talk_secs, 0),
  IFNULL(s.hold_secs, 0),
  IFNULL(s.wrap_secs, 0),
  IFNULL(s.handle_secs, 0),
  s.wrap_up_code,
  IFNULL(s.transferred, 0),
  CONCAT('support_call:', :pFromDate, '..', :pToDate)
FROM ie_stg_support_call s
JOIN ie_dim_date d
  ON d.full_date = s.call_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.agent_email))
WHERE s.conversation_id IS NOT NULL
  AND s.phone_user_id IS NOT NULL;
