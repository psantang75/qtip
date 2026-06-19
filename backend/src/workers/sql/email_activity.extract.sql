-- Email Activity extract (source pool: phone).
-- Runs on the phone-system DB; cross-references dmcms_prod.tblContacts (CRM)
-- on the same MySQL instance, exactly as the legacy EmailStats_Summary proc did.
--
-- Window-bound by named params :pFromDate / :pToDate (inclusive day range).
-- One row per mailbox / day / direction / parties / crm-contact flag. The
-- `email` column is the identity key conformed to ie_dim_employee downstream,
-- so column aliases are snake_case to match ie_stg_email_activity exactly.
--
-- Kept as two derived-table subqueries (not a CTE): the phone-system engine is
-- an older MySQL/MariaDB without CTE support, which is why the original proc was
-- written this way. The only change vs. the proc is snake_case output aliases.
SELECT
  pu.Name                                       AS mailbox_name,
  MAX(pu.Email)                                 AS email,
  DATE_FORMAT(es.EmailDate, '%Y-%m-%d')         AS email_date,
  es.EmailDirection                             AS email_direction,
  es.EmailParties                               AS email_parties,
  CASE WHEN cf.email IS NOT NULL OR ct.email IS NOT NULL THEN 'Y' ELSE 'N' END AS crm_contact,
  COUNT(DISTINCT es.ConversationID)             AS email_count
FROM tblEmailStats es
INNER JOIN tblPhoneUser pu ON es.MailBoxName = pu.Email
LEFT JOIN (
  SELECT DISTINCT c.EMail AS email
  FROM dmcms_prod.tblContacts c
  WHERE c.EMail NOT LIKE '%@dm-us.com%'
) cf ON es.FromEmail = cf.email
LEFT JOIN (
  SELECT DISTINCT c.EMail AS email
  FROM dmcms_prod.tblContacts c
  WHERE c.EMail NOT LIKE '%@dm-us.com%'
) ct ON es.ToEmail = ct.email
WHERE es.SubjectLine NOT LIKE '%Automatic reply%'
  AND es.EmailDate >= :pFromDate
  AND es.EmailDate <  (:pToDate + INTERVAL 1 DAY)
GROUP BY pu.Name,
         DATE_FORMAT(es.EmailDate, '%Y-%m-%d'),
         es.EmailDirection,
         es.EmailParties,
         crm_contact;
