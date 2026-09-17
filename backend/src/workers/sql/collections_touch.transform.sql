/* Collections Touch transform (primary pool): ie_stg_collections_touch ->
   ie_fact_collections_touch. Load mode INCREMENTAL_WINDOW: delete the re-extracted
   day range from the fact, then re-insert conformed rows so re-runs never
   double-count. Identity conform: date -> ie_dim_date (full_date),
   agent email -> ie_dim_employee (current row).
   NOTE: block comments only — the worker's splitter discards any statement that
   begins with a line comment.

   CAMPAIGN IS INHERITED FROM THE TASK, never re-derived. A touch belongs to whatever
   campaign its task belongs to, by definition, so deriving it a second time from
   TaskTypeID only creates a rule that can disagree with the task fact — which is
   exactly what happened to ACH: the 1st/16th split depends on the RUN behind the task,
   and the task's created date cannot see it (a return trails its run by 3-21 days).
   ie_fact_collections_task resolves that once, and task_id is unique there, so this
   cannot fan out. The staging value survives only as a fallback for a touch on a task
   older than the task fact's window; this load mode re-runs its window, so an inherited
   value replaces a fallback one as soon as the task row exists. */
DELETE FROM ie_fact_collections_touch
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_collections_touch
  (date_key, action_id, task_id, campaign_key, status_id_after, status_label,
   touch_seq, touch_label, phase, is_2nd_call, agent_email, employee_key,
   created_on, load_batch_id)
SELECT
  d.date_key,
  s.action_id,
  s.task_id,
  COALESCE(tk.campaign_key, s.campaign_key),
  s.status_id_after,
  s.status_label,
  s.touch_seq,
  s.touch_label,
  s.phase,
  IFNULL(s.is_2nd_call, 0),
  s.agent_email,
  e.employee_key,
  s.created_on,
  CONCAT('collections_touch:', :pFromDate, '..', :pToDate)
FROM ie_stg_collections_touch s
JOIN ie_dim_date d
  ON d.full_date = s.created_date
LEFT JOIN ie_fact_collections_task tk
  ON tk.task_id = s.task_id
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.agent_email));
