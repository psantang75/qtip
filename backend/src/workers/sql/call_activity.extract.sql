-- Call Activity extract (source pool: phone). Rewrite of GapReport_Summary_v2.
--
-- The legacy proc used a row-by-row CURSOR loop purely to compute a per-call
-- "GapMins" (idle time between consecutive calls). The v2 proc's FINAL SELECT
-- dropped GapMins entirely, so the gap loop is dead code: the actual report
-- output is just per (agent, date, direction) -> call count + call/hold/line
-- minutes. This rewrite is a set-based two-level aggregation (no cursor, no
-- window functions — the phone engine is an older MySQL/MariaDB), producing
-- the same output the proc's tail SELECT did, plus the agent email.
--
-- Window-bound by named params :pFromDate / :pToDate (inclusive day range, ET).
-- Aliases are snake_case to match ie_stg_call_activity exactly.
--
-- Level 1 (inner): one row per conversation/agent — MAX each metric, decide
--   direction (Internal when the agent leg has >1 distinct direction).
-- Level 2 (outer): roll up to agent/date/direction — distinct-call count + sums.
--
-- NOTE: the legacy proc's "customer participant" (purpose='Customer') INNER JOIN
-- is intentionally OMITTED. Outbound sales dials to prospects have no Customer
-- participant, so that join silently dropped ~all outbound calls; removing it
-- reconciles exactly with the live report (validated day-by-day per agent).
SELECT
  conv.agent_name                              AS agent_name,
  conv.email                                   AS email,
  conv.call_date                               AS call_date,
  ANY_VALUE(conv.source_dept)                  AS source_dept,
  conv.call_direction                          AS call_direction,
  COUNT(DISTINCT conv.conversation_id)         AS call_count,
  -- Count of calls with 3+ minutes of actual talk time (same basis as call_mins).
  SUM(CASE WHEN conv.call_mins >= 3 THEN 1 ELSE 0 END) AS calls_over_3min,
  CAST(SUM(conv.call_mins) AS DECIMAL(10,2))   AS call_mins,
  CAST(SUM(conv.hold_mins) AS DECIMAL(10,2))   AS hold_mins,
  CAST(SUM(conv.line_mins) AS DECIMAL(10,2))   AS line_mins
FROM (
  SELECT
    c.ConversationID                                       AS conversation_id,
    u.Name                                                 AS agent_name,
    ANY_VALUE(u.Email)                                     AS email,
    DATE(c.ConversationStart_ET)                           AS call_date,
    ANY_VALUE(u.DeptID)                                    AS source_dept,
    ANY_VALUE(CASE WHEN dir.DirectionCount > 1 THEN 'Internal' ELSE s.Direction END) AS call_direction,
    -- call_mins = actual talk time only (tTalkComplete). After-call-work (tAcw)
    -- is deliberately excluded: we measure real time talking to customers.
    MAX(CASE WHEN m.Name = 'tTalkComplete' THEN ROUND(COALESCE(m.Value, 0.0) / (1000 * 60) % 60, 2) ELSE 0.00 END) AS call_mins,
    MAX(CASE WHEN m.Name = 'tHeldComplete'      THEN ROUND(COALESCE(m.Value, 0.0) / (1000 * 60) % 60, 2) ELSE 0.00 END) AS hold_mins,
    MAX(CASE WHEN m.Name = 'tHandle'            THEN ROUND(COALESCE(m.Value, 0.0) / (1000 * 60) % 60, 2) ELSE 0.00 END) AS line_mins
  FROM tblParticipants p
  INNER JOIN tblConversations c ON c.ConversationID = p.ConversationID
  INNER JOIN tblPhoneUser u ON u.PhoneUserID = p.UserID
  INNER JOIN tblSessions s ON s.ParticipantID = p.ParticipantID AND s.ConversationID = p.ConversationID
  INNER JOIN tblMetrics m ON m.SessionID = s.SessionID
  INNER JOIN tblSegments seg ON seg.SessionID = s.SessionID
  LEFT JOIN (
    SELECT c.ConversationID, COUNT(DISTINCT s.Direction) AS DirectionCount
    FROM tblParticipants p
    INNER JOIN tblConversations c ON c.ConversationID = p.ConversationID
    INNER JOIN tblSessions s ON s.ParticipantID = p.ParticipantID AND s.ConversationID = p.ConversationID
    WHERE p.purpose IN ('Agent', 'User')
      AND DATE_FORMAT(c.ConversationStart_ET, '%H%i') >= 800
      AND DATE_FORMAT(c.ConversationStart_ET, '%H%i') <= 1900
      AND DATE(c.ConversationStart_ET) >= :pFromDate
      AND DATE(c.ConversationStart_ET) <= :pToDate
    GROUP BY c.ConversationID
  ) dir ON c.ConversationID = dir.ConversationID
  WHERE p.purpose IN ('Agent', 'User')
    AND m.Name IN ('tHandle', 'tHeldComplete', 'tTalkComplete', 'tAcw')
    AND seg.SegmentType IN ('Interact', 'Wrapup', 'Contacting')
    AND DATE_FORMAT(c.ConversationStart_ET, '%H%i') >= 800
    AND DATE_FORMAT(c.ConversationStart_ET, '%H%i') <= 1900
    AND DATE(c.ConversationStart_ET) >= :pFromDate
    AND DATE(c.ConversationStart_ET) <= :pToDate
    AND u.DeptID IN ('Sales', 'Billing/CS')
  GROUP BY c.ConversationID, u.Name
) conv
GROUP BY conv.agent_name, conv.email, conv.call_date, conv.call_direction;
