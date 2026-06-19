/* Email Activity transform (primary pool): ie_stg_email_activity -> ie_fact_email_activity.
   Load mode INCREMENTAL_WINDOW: delete the re-extracted day range, then re-insert
   conformed rows. Idempotent for the window so re-runs never double-count.
   Identity conform: email -> ie_dim_employee (current row); date -> ie_dim_date.
   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_email_activity
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_email_activity
  (date_key, employee_key, mailbox_email, mailbox_name,
   email_direction, email_parties, crm_contact, email_count, load_batch_id)
SELECT
  d.date_key,
  e.employee_key,
  s.email,
  MAX(s.mailbox_name),
  s.email_direction,
  s.email_parties,
  s.crm_contact,
  SUM(s.email_count),
  CONCAT('email:', :pFromDate, '..', :pToDate)
FROM ie_stg_email_activity s
JOIN ie_dim_date d
  ON d.full_date = s.email_date
LEFT JOIN ie_dim_employee e
  ON e.is_current = 1
 AND LOWER(TRIM(e.email)) = LOWER(TRIM(s.email))
GROUP BY d.date_key, e.employee_key, s.email,
         s.email_direction, s.email_parties, s.crm_contact;
