-- Tasks extract (source pool: crm) — Task half of
-- PeteReportTaskandTicketOpenByUser_v2, as a checked-in, parameterized SELECT.
--
-- Split from the legacy combined proc (see ticket_open.extract.sql). This is the
-- Task half (~13s) — heavier because it scans tblAction for the last-touched
-- action; isolating it keeps each report under the 25s per-session cap.
--
-- SNAPSHOT: open tasks (CompletedOn '1-1-1' = not completed; recently-completed
-- within 2 months kept briefly). Restricted to ops + sales task depts (tt.DeptID
-- 1/2) and excludes TaskTypeID 19, matching the proc. One row per task; ticket_id
-- is 0 (tasks have no ticket).
--
-- Identity: assignee email = tblSalesPeople.email via my_aspnet_users.id =
-- tblSalesPeople.UserID (UserID 12 = system account, excluded). Sentinels -> NULL.
--
-- Returns ~79k rows in ~30s on the source (the tblAction last-touched scan is
-- the cost). The MAX_EXECUTION_TIME hint lifts this one read-only SELECT above
-- the crm pool's 25s session cap (database.ts) so the snapshot completes; it is
-- the only report that needs it. Runs every 2h, so the source cost is bounded.
SELECT /*+ MAX_EXECUTION_TIME(120000) */
  'Task'                                                                AS process_type,
  c.CustomerID                                                          AS customer_id,
  c.Name                                                                AS customer_name,
  t.TaskID                                                              AS task_id,
  0                                                                     AS ticket_id,
  tt.Title                                                              AS classification,
  'Task'                                                                AS sub_classification,
  sp.email                                                              AS email,
  sp.SalesPersonName                                                    AS assigned_to,
  IFNULL(dm.DeptName, 'Unknown')                                        AS dept,
  ts.Title                                                              AS status,
  CASE WHEN t.CreatedOn   > '1900-01-01' THEN t.CreatedOn   ELSE NULL END AS created_on,
  CASE WHEN t.DueOn       > '1900-01-01' THEN t.DueOn       ELSE NULL END AS next_contact,
  CASE WHEN a.CompletedOn > '1900-01-01' THEN a.CompletedOn ELSE NULL END AS last_touched_on,
  tnsp.SalesPersonName                                                  AS last_touched_by,
  CASE WHEN t.CompletedOn > '1900-01-01' THEN t.CompletedOn ELSE NULL END AS closed_on,
  clsp.SalesPersonName                                                  AS closed_by,
  -- CHAR(63) is the question-mark char. A literal one would be read as a bind
  -- placeholder by the mysql2 named-placeholder tokenizer, so we build it here.
  CASE
    WHEN t.TaskTypeID IN (14, 42, 46)
      THEN CONCAT('http://crm.dm-us.com/Jobs/', tt.NewScreen, CHAR(63), 'JobID=', j.JobID)
    ELSE CONCAT('http://crm.dm-us.com/TaskManager/', tt.NewScreen, CHAR(63), 'TaskID=', t.TaskID)
  END                                                                   AS crm_url
FROM tblTask t
INNER JOIN tblCustomers c    ON t.CustomerID = c.CustomerID
INNER JOIN tblTaskType tt    ON t.TaskTypeID = tt.TaskTypeID
INNER JOIN tblTaskStatus ts  ON t.TaskTypeID = ts.TaskTypeID AND t.TaskStatusID = ts.TaskStatusID
INNER JOIN (SELECT TaskID, MAX(ActionID) AS ActionID FROM tblAction WHERE Note <> '' GROUP BY TaskID) ta
        ON ta.TaskID = t.TaskID
INNER JOIN tblAction a       ON ta.ActionID = a.ActionID
LEFT JOIN my_aspnet_users au ON a.CompletedBy = au.id
LEFT JOIN tblSalesPeople tnsp ON au.id = tnsp.UserID AND tnsp.UserID NOT IN (12)
LEFT JOIN my_aspnet_users u  ON t.AssignedTo = u.id
LEFT JOIN my_aspnet_users tu ON t.CompletedBy = tu.id
LEFT JOIN tblSalesPeople clsp ON tu.id = clsp.UserID AND clsp.UserID NOT IN (12)
LEFT JOIN tblJobs j          ON t.TaskID = j.TaskID
LEFT JOIN tblSalesPeople sp  ON u.id = sp.UserID AND sp.UserID NOT IN (12)
LEFT JOIN dmDepartments dm   ON IFNULL(sp.DeptID, 0) = dm.DeptID
-- Recently-completed tail is inlined as 2 months (must match this report's
-- ie_source_report.window_months). It is a literal rather than a :param because
-- the MAX_EXECUTION_TIME block-comment hint above and mysql2 named placeholders
-- cannot coexist in one statement; with no :params the hint passes through clean.
WHERE (t.CompletedOn = '1-1-1' OR t.CompletedOn >= DATE_SUB(NOW(), INTERVAL 2 MONTH))
  AND (tt.DeptID = 2 OR tt.DeptID = 1)
  AND t.TaskTypeID NOT IN (19)
  -- Open-status tasks only. Terminal statuses (Paid, Order Released, Lost-*,
  -- No Active Services, ...) are marked tblTaskStatus.Closed = 1. Due to a source
  -- bug these "done" tasks often never get a CompletedOn, so the ClosedOn rule
  -- above can't drop them; the status-definition Closed flag is what the legacy
  -- report uses (it is the commented-out `ts.Closed = 0` line in the proc).
  -- Exception: 'Contact Past Due' is flagged Closed = 1 but is an actionable
  -- overdue contact the report still shows; it is the only such status (a
  -- Closed = 1 "Past Due" status) across the sales/ops task types.
  AND (ts.Closed = 0 OR ts.Title = 'Contact Past Due');
