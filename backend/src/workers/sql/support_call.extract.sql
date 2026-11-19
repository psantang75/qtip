/* Support Call extract (source pool: phone). Grain: one conversation per agent
   leg, window-bound by :pFromDate / :pToDate on the ET conversation start.
   The final SELECT's aliases match ie_stg_support_call exactly.

   WHY THIS EXISTS: ie_fact_call_activity is a daily (agent x direction) roll-up,
   so it cannot answer "how many calls ran past 10 minutes". This lands the
   per-call handle-time components the Call Length distribution buckets on.

   CALL COMPONENTS come from tblSegments durations, the same basis the
   Productivity day drill-down uses (insightsProductivityDay.service.ts), NOT
   from tblMetrics. The metric route was rejected: call_activity reads tHandle /
   tTalkComplete / tHeldComplete through `ROUND(value / (1000*60) % 60, 2)`,
   whose `% 60` silently wraps any call over an hour back to the start of the
   hour. Segment arithmetic has no such ceiling, which matters here precisely
   because the long tail is the point of the report.
     Interact -> talk, Hold -> hold, Wrapup -> wrap.

   AFTER-CALL STATUSES. Two kinds of after-call work live on the agent's
   presence (tblPrimaryPresence), not on the call: 'Follow-Up Extended' (set by
   hand when the old 90s wrap was not enough) and 'Wrap Pending' (the status that
   replaced it in Nov 2026). A presence period has an agent and start/end but no
   conversation id, so it is tied to a call by agent and time:
     1. It belongs to the agent's call whose talk had started and that ended
        (call end or wrap end, whichever is later) no more than 2 minutes before
        the status started. If several calls qualify, the most recent call wins.
     2. Wrap Pending counts from the end of the call. Genesys keeps a Wrapup
        segment running alongside it (91-94% of its minutes on 2026-11-18/19),
        so where they overlap the seconds count once, as Wrap Pending: wrap_secs
        is the Wrapup time NOT covered by Wrap Pending. Before the status existed
        nothing overlaps and wrap_secs is the whole Wrapup segment.
     3. Follow-Up Extended counts only after the wrap ends.
     4. Counting stops when the agent's next call starts.
   handle_secs = talk + hold + wrap + wrap_extended + wrap_pending, so it never
   exceeds the time that actually elapsed. Statuses are matched by LabelName,
   never by presence id, the same way insightsProductivityDesk.service.ts
   finds 'In Warehouse'.

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

   WRAP-UP CODE is carried so the report can count 'ININ-WRAP-UP-TIMEOUT' calls
   (the old 90s wrap running out). Genesys writes the code on one segment of the
   leg and leaves it NULL on the rest, so it must be MAX(NULLIF(...)) —
   ANY_VALUE picks an arbitrary segment and returns NULL almost every time.

   MySQL 5.7 on the phone side: no CTEs, no window functions, and a TEMPORARY
   table cannot be opened twice in one statement — hence one temp table per step. */
SET SESSION max_execution_time = 200000;
SET @pFrom := :pFromDate, @pTo := DATE_ADD(:pToDate, INTERVAL 1 DAY);

/* One row per answered agent leg, plus the times the status matching needs. */
DROP TEMPORARY TABLE IF EXISTS tmpSupportLeg;
CREATE TEMPORARY TABLE tmpSupportLeg(
  conversation_id VARCHAR(100) NOT NULL,
  phone_user_id VARCHAR(100) NOT NULL,
  agent_email VARCHAR(100) NULL,
  agent_name VARCHAR(100) NULL,
  call_date DATE NULL,
  started_on DATETIME NULL,
  direction VARCHAR(200) NULL,
  talk_secs INT NOT NULL,
  hold_secs INT NOT NULL,
  wrap_secs INT NOT NULL,
  wrap_up_code VARCHAR(200) NULL,
  transferred TINYINT NOT NULL,
  talk_start DATETIME NOT NULL,
  call_end DATETIME NOT NULL,
  wrap_start DATETIME NULL,
  wrap_end DATETIME NULL,
  after_start DATETIME NOT NULL,
  PRIMARY KEY (conversation_id, phone_user_id),
  KEY k_user_talk (phone_user_id, talk_start));

INSERT INTO tmpSupportLeg(conversation_id, phone_user_id, agent_email, agent_name,
                          call_date, started_on, direction, talk_secs, hold_secs, wrap_secs,
                          wrap_up_code, transferred, talk_start, call_end, wrap_start, wrap_end,
                          after_start)
SELECT x.conversation_id, x.phone_user_id, x.agent_email, x.agent_name,
       x.call_date, x.started_on, x.direction, x.talk_secs, x.hold_secs, x.wrap_secs,
       x.wrap_up_code, x.transferred, x.talk_start, x.call_end, x.wrap_start, x.wrap_end,
       GREATEST(x.call_end, IFNULL(x.wrap_end, x.call_end))
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
    IFNULL(SUM(CASE WHEN seg.SegmentType = 'Wrapup'
               THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) END), 0) AS wrap_secs,
    MAX(NULLIF(TRIM(seg.WrapUpCode), ''))     AS wrap_up_code,
    MAX(CASE WHEN seg.DisconnectType = 'Transfer' THEN 1 ELSE 0 END) AS transferred,
    MIN(CASE WHEN seg.SegmentType = 'Interact' AND seg.SegmentEnd_ET IS NOT NULL
             THEN seg.SegmentStart_ET END)    AS talk_start,
    MAX(CASE WHEN seg.SegmentType IN ('Interact', 'Hold') THEN seg.SegmentEnd_ET END) AS call_end,
    MIN(CASE WHEN seg.SegmentType = 'Wrapup' AND seg.SegmentEnd_ET IS NOT NULL
             THEN seg.SegmentStart_ET END)    AS wrap_start,
    MAX(CASE WHEN seg.SegmentType = 'Wrapup' THEN seg.SegmentEnd_ET END) AS wrap_end
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
  WHERE c.ConversationStart_ET >= @pFrom
    AND c.ConversationStart_ET < @pTo
  GROUP BY c.ConversationID, pt.UserID
  HAVING talk_secs > 0
) x;

/* Finished after-call status periods. The extra day reaches a status that
   started after midnight for a call late on the last day of the window. */
DROP TEMPORARY TABLE IF EXISTS tmpAfterStatus;
CREATE TEMPORARY TABLE tmpAfterStatus(
  PresenceID VARCHAR(100) NOT NULL,
  UserID VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  StartTime_ET DATETIME NOT NULL,
  EndTime_ET DATETIME NOT NULL,
  PRIMARY KEY (PresenceID),
  KEY k_user_start (UserID, StartTime_ET));

INSERT IGNORE INTO tmpAfterStatus(PresenceID, UserID, label, StartTime_ET, EndTime_ET)
SELECT p.PresenceID, p.UserID, sp.LabelName, p.StartTime_ET, p.EndTime_ET
FROM tblPrimaryPresence p
JOIN tblSystemPresence sp
  ON sp.OrgPresenceID = p.OrgPresenceID
WHERE sp.LabelName IN ('Wrap Pending', 'Follow-Up Extended')
  AND p.UserID IS NOT NULL
  AND p.StartTime_ET >= @pFrom
  AND p.StartTime_ET < DATE_ADD(@pTo, INTERVAL 1 DAY)
  AND p.EndTime_ET > p.StartTime_ET;

/* Rule 1: the call each status belongs to, identified by its talk start. */
DROP TEMPORARY TABLE IF EXISTS tmpStatusAnchor;
CREATE TEMPORARY TABLE tmpStatusAnchor(
  PresenceID VARCHAR(100) NOT NULL,
  phone_user_id VARCHAR(100) NOT NULL,
  talk_start DATETIME NOT NULL,
  PRIMARY KEY (PresenceID));

INSERT INTO tmpStatusAnchor(PresenceID, phone_user_id, talk_start)
SELECT st.PresenceID, st.UserID, MAX(l.talk_start)
FROM tmpAfterStatus st
JOIN tmpSupportLeg l
  ON l.phone_user_id = st.UserID
 AND st.StartTime_ET >= l.talk_start
 AND st.StartTime_ET <= l.after_start + INTERVAL 120 SECOND
GROUP BY st.PresenceID, st.UserID;

/* Rule 4: the agent's next call after the one the status belongs to. */
DROP TEMPORARY TABLE IF EXISTS tmpStatusNext;
CREATE TEMPORARY TABLE tmpStatusNext(
  PresenceID VARCHAR(100) NOT NULL,
  next_start DATETIME NOT NULL,
  PRIMARY KEY (PresenceID));

INSERT INTO tmpStatusNext(PresenceID, next_start)
SELECT a.PresenceID, MIN(n.talk_start)
FROM tmpStatusAnchor a
JOIN tmpSupportLeg n
  ON n.phone_user_id = a.phone_user_id
 AND n.talk_start > a.talk_start
GROUP BY a.PresenceID;

/* Rules 2-3: counted seconds per call, plus the Wrapup seconds Wrap Pending covers. */
DROP TEMPORARY TABLE IF EXISTS tmpLegAfter;
CREATE TEMPORARY TABLE tmpLegAfter(
  conversation_id VARCHAR(100) NOT NULL,
  phone_user_id VARCHAR(100) NOT NULL,
  wrap_extended_secs INT NOT NULL,
  wrap_pending_secs INT NOT NULL,
  wrap_covered_secs INT NOT NULL,
  PRIMARY KEY (conversation_id, phone_user_id));

INSERT INTO tmpLegAfter(conversation_id, phone_user_id,
                        wrap_extended_secs, wrap_pending_secs, wrap_covered_secs)
SELECT
  y.conversation_id,
  y.phone_user_id,
  SUM(CASE WHEN y.label = 'Follow-Up Extended'
           THEN GREATEST(0, TIMESTAMPDIFF(SECOND, y.count_from, y.count_to)) ELSE 0 END),
  SUM(CASE WHEN y.label = 'Wrap Pending'
           THEN GREATEST(0, TIMESTAMPDIFF(SECOND, y.count_from, y.count_to)) ELSE 0 END),
  SUM(CASE WHEN y.label = 'Wrap Pending' AND y.wrap_start IS NOT NULL
           THEN GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(y.count_from, y.wrap_start),
                                                  LEAST(y.count_to, y.wrap_end)))
           ELSE 0 END)
FROM (
  SELECT
    l.conversation_id,
    l.phone_user_id,
    st.label,
    l.wrap_start,
    l.wrap_end,
    CASE WHEN st.label = 'Wrap Pending' THEN GREATEST(st.StartTime_ET, l.call_end)
         ELSE GREATEST(st.StartTime_ET, l.after_start) END       AS count_from,
    LEAST(st.EndTime_ET, IFNULL(nx.next_start, st.EndTime_ET))   AS count_to
  FROM tmpStatusAnchor a
  JOIN tmpSupportLeg l
    ON l.phone_user_id = a.phone_user_id
   AND l.talk_start = a.talk_start
  JOIN tmpAfterStatus st
    ON st.PresenceID = a.PresenceID
  LEFT JOIN tmpStatusNext nx
    ON nx.PresenceID = a.PresenceID
) y
GROUP BY y.conversation_id, y.phone_user_id;

SELECT /*+ MAX_EXECUTION_TIME(120000) */
  l.conversation_id,
  l.phone_user_id,
  l.agent_email,
  l.agent_name,
  l.call_date,
  l.started_on,
  l.direction,
  l.talk_secs,
  l.hold_secs,
  GREATEST(0, l.wrap_secs - IFNULL(a.wrap_covered_secs, 0))    AS wrap_secs,
  IFNULL(a.wrap_extended_secs, 0)                              AS wrap_extended_secs,
  IFNULL(a.wrap_pending_secs, 0)                               AS wrap_pending_secs,
  l.talk_secs + l.hold_secs
    + GREATEST(0, l.wrap_secs - IFNULL(a.wrap_covered_secs, 0))
    + IFNULL(a.wrap_extended_secs, 0)
    + IFNULL(a.wrap_pending_secs, 0)                           AS handle_secs,
  l.wrap_up_code,
  l.transferred
FROM tmpSupportLeg l
LEFT JOIN tmpLegAfter a
  ON a.conversation_id = l.conversation_id
 AND a.phone_user_id = l.phone_user_id;
