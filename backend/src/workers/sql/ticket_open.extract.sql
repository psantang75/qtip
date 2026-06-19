-- Tickets extract (source pool: crm) — Ticket half of
-- PeteReportTaskandTicketOpenByUser_v2, as a checked-in, parameterized SELECT.
--
-- The legacy proc UNIONed tickets + tasks in one statement (~22s on the source,
-- against the 25s per-session cap). It is split into two source reports
-- (ticket_open + task_open) that both load ie_fact_ticket_task, so each extract
-- runs well under the cap. This is the Ticket half (~8s).
--
-- SNAPSHOT: current OPEN tickets only (StatusID 5 = Closed). The legacy
-- "Open Tickets and Tasks" report excludes closed tickets entirely; keeping a
-- recently-closed tail inflated the Past Due buckets (closed tickets carry an
-- old DueOn), so we match the report and the open-only task side (ts.Closed=0).
-- One row per ticket.
--
-- Identity: assignee email = tblSalesPeople.email (my_aspnet_users has no email
-- column). UserID 12 = system/house account, excluded (matches the proc).
-- '1-1-1'/year-0001 "not set" sentinels are converted to real NULL; dates stay
-- real DATETIMEs (formatted in the frontend per the date-handling convention).
SELECT
  'Ticket'                                                              AS process_type,
  c.CustomerID                                                          AS customer_id,
  c.Name                                                                AS customer_name,
  t.TaskID                                                              AS task_id,
  t.TicketID                                                            AS ticket_id,
  tc1.ClassificationName                                                AS classification,
  tc2.ClassificationName                                                AS sub_classification,
  sp.email                                                              AS email,
  sp.SalesPersonName                                                    AS assigned_to,
  IFNULL(dm.DeptName, 'Unknown')                                        AS dept,
  ts.StatusText                                                         AS status,
  CASE WHEN t.CreatedOn  > '1900-01-01' THEN t.CreatedOn  ELSE NULL END AS created_on,
  CASE WHEN tk.DueOn     > '1900-01-01' THEN tk.DueOn     ELSE NULL END AS next_contact,
  CASE WHEN IFNULL(lnote.LastTouchedOn, t.CreatedOn) > '1900-01-01'
       THEN IFNULL(lnote.LastTouchedOn, t.CreatedOn) ELSE NULL END      AS last_touched_on,
  tnsp.SalesPersonName                                                  AS last_touched_by,
  CASE WHEN tk.CompletedOn > '1900-01-01' THEN tk.CompletedOn ELSE NULL END AS closed_on,
  clsp.SalesPersonName                                                  AS closed_by,
  -- CHAR(63) is the question-mark char. A literal one would be read as a bind
  -- placeholder by the mysql2 named-placeholder tokenizer, so we build it here.
  CONCAT('http://crm.dm-us.com/Tickets/Edit', CHAR(63), 'CustomerID=0&JobID=0&TicketID=', t.TicketID) AS crm_url
FROM tblTicket t
INNER JOIN tblTicketClassification tc2 ON t.ClassificationID = tc2.ClassificationID
INNER JOIN tblTicketClassification tc1 ON tc1.ClassificationID = tc2.ParentID
INNER JOIN (SELECT TicketID, MAX(TicketStatusHistoryID) AS TicketStatusHistoryID
            FROM tblTicketStatusHistory GROUP BY TicketID) tsht ON tsht.TicketID = t.TicketID
INNER JOIN tblTicketStatusHistory tsh ON tsh.TicketStatusHistoryID = tsht.TicketStatusHistoryID
INNER JOIN tblTicketStatus ts ON ts.StatusID = tsh.StatusID
LEFT JOIN my_aspnet_users u  ON t.AssignedToUserID = u.id
LEFT JOIN tblSalesPeople sp  ON u.id = sp.UserID AND sp.UserID NOT IN (12)
LEFT JOIN dmDepartments dm   ON IFNULL(sp.DeptID, 0) = dm.DeptID
INNER JOIN tblTask tk        ON t.TaskID = tk.TaskID
LEFT JOIN my_aspnet_users tku ON tk.CompletedBy = tku.id
LEFT JOIN tblSalesPeople clsp ON tku.id = clsp.UserID AND clsp.UserID NOT IN (12)
INNER JOIN tblCustomers c    ON t.CustomerID = c.CustomerID
LEFT JOIN (SELECT tn.TicketID, MAX(tn.TicketNoteID) TicketNoteID, MAX(tn.CreatedOn) AS LastTouchedOn
           FROM tblTicketNote tn GROUP BY tn.TicketID) AS lnote ON t.TicketID = lnote.TicketID
LEFT JOIN tblTicketNote tn   ON lnote.TicketNoteID = tn.TicketNoteID
LEFT JOIN my_aspnet_users tnu ON tn.CreatedBy = tnu.id
LEFT JOIN tblSalesPeople tnsp ON tnu.id = tnsp.UserID AND tnsp.UserID NOT IN (12)
WHERE ts.StatusID != 5;
