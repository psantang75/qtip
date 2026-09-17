/* Collections Call extract (source pool: phone). Grain: one conversation per agent
   leg, window-bound by :pFromDate / :pToDate on the ET conversation start.

   WHY THIS EXISTS: ie_fact_call_activity is a daily (agent x direction) aggregate,
   which can say an agent made 40 outbound calls but not whether the payment they
   took came off an inbound or an outbound one. Channel Effectiveness needs the
   latter, so this lands one row per call and carries the far-end phone number.

   FAR-END NUMBER. Genesys stores the caller in ANI and the dialed party in Dnis, so
   which one is the CUSTOMER depends on direction: inbound -> ANI, outbound -> Dnis
   (on outbound, ANI is our own sip: URI). Both arrive prefixed - 'tel:+15551234567'
   - and RIGHT(...,10) after stripping separators lands on the 10-digit number
   regardless of the prefix, which is why no regex is needed (this is MySQL 5.7:
   no CTEs, no REGEXP_REPLACE).

   CUSTOMER RESOLUTION. The phone DB and the CRM share a MySQL instance, so the
   number is resolved against dmcms_prod in the same pass, over customer Phone1/2 and
   contact Phone1/CellPhone. A number shared by more than one customer is recorded as
   AMBIGUOUS with a NULL customer_id rather than guessed - measured on July 2026
   Billing/CS traffic, 77% of outbound and 71% of inbound calls resolve uniquely and
   ~10% are ambiguous. Downstream must treat NULL customer_id as unattributed, not as
   "no call". Aliases match ie_stg_collections_call. */
SELECT /*+ MAX_EXECUTION_TIME(240000) */
  cl.conversation_id,
  cl.phone_user_id,
  cl.agent_email,
  cl.agent_name,
  cl.call_date,
  cl.started_on,
  cl.direction,
  cl.talk_secs,
  cl.hold_secs,
  cl.customer_phone,
  CASE WHEN idx.ncust = 1 THEN idx.cust END AS customer_id,
  CASE WHEN cl.customer_phone IS NULL OR idx.d IS NULL THEN 'NONE'
       WHEN idx.ncust > 1 THEN 'AMBIGUOUS'
       ELSE 'UNIQUE' END                     AS match_kind
FROM (
  SELECT
    c.ConversationID                          AS conversation_id,
    pt.UserID                                 AS phone_user_id,
    ANY_VALUE(u.Email)                        AS agent_email,
    ANY_VALUE(u.Name)                         AS agent_name,
    DATE(MIN(c.ConversationStart_ET))         AS call_date,
    MIN(c.ConversationStart_ET)               AS started_on,
    CASE WHEN COUNT(DISTINCT s.Direction) > 1 THEN 'Internal'
         ELSE MIN(s.Direction) END            AS direction,
    IFNULL(SUM(CASE WHEN seg.SegmentType = 'Interact'
               THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) END), 0) AS talk_secs,
    IFNULL(SUM(CASE WHEN seg.SegmentType = 'Hold'
               THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) END), 0) AS hold_secs,
    CASE WHEN RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
           COALESCE(
             NULLIF(MIN(CASE WHEN s.Direction = 'Inbound'  THEN s.ANI  END), ''),
             NULLIF(MIN(CASE WHEN s.Direction = 'Outbound' THEN s.Dnis END), ''),
             NULLIF(MIN(s.Dnis), ''),
             MIN(s.ANI)
           ), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)
           REGEXP '^[0-9]{10}$'
         THEN RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
           COALESCE(
             NULLIF(MIN(CASE WHEN s.Direction = 'Inbound'  THEN s.ANI  END), ''),
             NULLIF(MIN(CASE WHEN s.Direction = 'Outbound' THEN s.Dnis END), ''),
             NULLIF(MIN(s.Dnis), ''),
             MIN(s.ANI)
           ), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)
    END                                       AS customer_phone
  FROM tblConversations c
  JOIN tblParticipants pt
    ON pt.ConversationID = c.ConversationID
   AND pt.purpose IN ('Agent', 'User')
  JOIN tblPhoneUser u
    ON u.PhoneUserID = pt.UserID
   AND u.DeptID IN ('Sales', 'Billing/CS')
  JOIN tblSessions s
    ON s.ParticipantID = pt.ParticipantID
   AND s.ConversationID = c.ConversationID
  LEFT JOIN tblSegments seg
    ON seg.SessionId = s.SessionId
  WHERE c.ConversationStart_ET >= :pFromDate
    AND c.ConversationStart_ET < DATE_ADD(:pToDate, INTERVAL 1 DAY)
  GROUP BY c.ConversationID, pt.UserID
) cl
LEFT JOIN (
  SELECT ph.d, MIN(ph.CustomerID) AS cust, COUNT(DISTINCT ph.CustomerID) AS ncust
  FROM (
    SELECT CustomerID, RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             Phone1, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10) AS d
      FROM dmcms_prod.tblCustomers WHERE Phone1 <> ''
    UNION
    SELECT CustomerID, RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             Phone2, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)
      FROM dmcms_prod.tblCustomers WHERE Phone2 <> ''
    UNION
    SELECT CustomerID, RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             Phone1, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)
      FROM dmcms_prod.tblContacts WHERE Phone1 <> ''
    UNION
    SELECT CustomerID, RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             CellPhone, '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)
      FROM dmcms_prod.tblContacts WHERE CellPhone <> ''
  ) ph
  WHERE ph.d REGEXP '^[0-9]{10}$'
  GROUP BY ph.d
) idx ON idx.d = cl.customer_phone;
