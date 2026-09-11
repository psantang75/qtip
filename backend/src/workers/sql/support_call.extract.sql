/* Support Call extract (source pool: phone). Grain: one conversation per agent
   leg, window-bound by :pFromDate / :pToDate on the ET conversation start.
   Aliases match ie_stg_support_call exactly.

   WHY THIS EXISTS: ie_fact_call_activity is a daily (agent x direction) roll-up,
   so it cannot answer "how many calls ran past 10 minutes". This lands the
   per-call handle-time components the Call Length distribution buckets on.

   HANDLE-TIME COMPONENTS come from tblSegments durations, the same basis the
   Productivity day drill-down uses (insightsProductivityDay.service.ts), NOT
   from tblMetrics. The metric route was rejected: call_activity reads tHandle /
   tTalkComplete / tHeldComplete through `ROUND(value / (1000*60) % 60, 2)`,
   whose `% 60` silently wraps any call over an hour back to the start of the
   hour. Segment arithmetic has no such ceiling, which matters here precisely
   because the long tail is the point of the report.
     Interact -> talk, Hold -> hold, Wrapup -> after-call work.

   ANSWERED CALLS ONLY (talk_secs > 0). An agent leg with no Interact segment is
   a ring-no-answer or a leg the agent never picked up; it has no handle time to
   bucket and would land in the "under 1 min" band as a false short call. On 60
   days of support traffic this drops 1,309 of 17,481 legs. Unanswered-call
   reporting already lives on the Productivity report's missed-call measure.

   NO DeptID FILTER, deliberately. call_activity's extract filters
   `u.DeptID IN ('Sales','Billing/CS')`, which would drop Tech Support: on the
   phone side DeptID is free text and reads 'Billing/CS' for 22 users,
   'Tech Support' for 2, 'CS/Billing' for 1, and NULL for 12. Department
   scoping is applied at the READ layer via ie_dim_employee (email -> conformed
   employee -> ie_dim_department), which is how collections_task handles the
   same problem.

   WRAP-UP CODE is carried because it explains a large share of handle time:
   ~half of support calls end 'ININ-WRAP-UP-TIMEOUT' with ~90s of wrap against
   ~17s on dispositioned calls. Genesys writes the code on one segment of the
   leg and leaves it NULL on the rest, so it must be MAX(NULLIF(...)) —
   ANY_VALUE picks an arbitrary segment and returns NULL almost every time.

   MySQL 5.7 on the phone side: no CTEs, no window functions. */
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
  IFNULL(SUM(CASE WHEN seg.SegmentType = 'Wrapup'
             THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) END), 0) AS wrap_secs,
  IFNULL(SUM(CASE WHEN seg.SegmentType IN ('Interact', 'Hold', 'Wrapup')
             THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) END), 0) AS handle_secs,
  MAX(NULLIF(TRIM(seg.WrapUpCode), ''))     AS wrap_up_code,
  MAX(CASE WHEN seg.DisconnectType = 'Transfer' THEN 1 ELSE 0 END) AS transferred
FROM tblConversations c
JOIN tblParticipants pt
  ON pt.ConversationID = c.ConversationID
 AND pt.purpose IN ('Agent', 'User')
JOIN tblPhoneUser u
  ON u.PhoneUserID = pt.UserID
JOIN tblSessions s
  ON s.ParticipantID = pt.ParticipantID
 AND s.ConversationID = c.ConversationID
LEFT JOIN tblSegments seg
  ON seg.SessionId = s.SessionId
WHERE c.ConversationStart_ET >= :pFromDate
  AND c.ConversationStart_ET < DATE_ADD(:pToDate, INTERVAL 1 DAY)
GROUP BY c.ConversationID, pt.UserID
HAVING talk_secs > 0;
