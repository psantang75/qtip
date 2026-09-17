/* Collections Call transform (primary pool): ie_stg_collections_call ->
   ie_fact_collections_call. INCREMENTAL_WINDOW: delete the re-extracted date_key
   window, then re-insert. date -> ie_dim_date; agent email -> ie_dim_employee.
   NOTE: block comments only.

   CAMPAIGN LINK: the extract resolved the far-end number to a CRM customer; this
   step decides which dunning task that call belongs to — the LATEST AR task for the
   same customer that already existed when the call was placed, bounded to 60 days so
   a call cannot attach itself to a long-dead cohort. The task fact carries no closed
   date, so "already existed and is the most recent" is the closest available stand-in
   for "the task the agent had open"; a customer worked by two overlapping campaigns
   will credit the newer one.

   Calls with no customer match keep task_id NULL. They are still real effort and are
   counted as such — only the per-campaign attribution is withheld. */
DELETE FROM ie_fact_collections_call
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_call
  (date_key, conversation_id, phone_user_id, employee_key, agent_email, agent_name,
   started_on, direction, talk_secs, hold_secs, customer_phone, customer_id,
   match_kind, billing_group_id, task_id, campaign_key, load_batch_id)
SELECT
  d.date_key,
  s.conversation_id,
  s.phone_user_id,
  e.employee_key,
  s.agent_email,
  s.agent_name,
  s.started_on,
  IFNULL(s.direction, 'Outbound'),
  IFNULL(s.talk_secs, 0),
  IFNULL(s.hold_secs, 0),
  s.customer_phone,
  s.customer_id,
  IFNULL(s.match_kind, 'NONE'),
  t.billing_group_id,
  t.task_id,
  t.campaign_key,
  CONCAT('collections_call:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_call s
JOIN ie_dim_date d
  ON d.full_date = s.call_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.agent_email))
LEFT JOIN ie_fact_collections_task t
  ON t.customer_id = s.customer_id
 AND s.customer_id IS NOT NULL
 AND t.created_on <= s.started_on
 AND t.created_on >= DATE_SUB(s.started_on, INTERVAL 60 DAY)
 AND NOT EXISTS (
   SELECT 1 FROM ie_fact_collections_task t2
   WHERE t2.customer_id = s.customer_id
     AND t2.created_on <= s.started_on
     AND t2.created_on >= DATE_SUB(s.started_on, INTERVAL 60 DAY)
     AND (t2.created_on > t.created_on
          OR (t2.created_on = t.created_on AND t2.task_id > t.task_id))
 )
WHERE s.conversation_id IS NOT NULL
  AND s.phone_user_id IS NOT NULL;
