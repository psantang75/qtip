/* Collections Task extract (source pool: crm). Grain: one AR task, window-bound
   by :pFromDate / :pToDate on the task's CreatedOn (FULL_RELOAD_WINDOW rebuilds a
   trailing window nightly so late status changes on open tasks are recaptured).

   This is a PROCEDURE-STYLE extract: it builds connection-scoped TEMPORARY tables
   and ends in a single SELECT, matching collections_invoice.extract.sql. The
   SourceReportSyncWorker runs every statement on one dedicated connection and loads
   the final result set into staging.

   campaign_key from TaskTypeID (+ day-of-month for the CC 1st/16th split).

   THIS FILE IS THE ONLY PLACE A TASK'S CAMPAIGN IS DERIVED. The touch and
   subscription facts used to re-derive it from TaskTypeID with their own copy of the
   rule; they now inherit it from ie_fact_collections_task in their transforms, so the
   ACH attribution below exists once rather than three times.

   ACH RUNS ON THE 1st AND THE 16th, LIKE CARD — but its task cannot be split by the
   task's own created date, and that is why this extract needs temporary tables at all.
   A declined CARD raises its task within seconds (billing group 9961 declined at
   07:31:06, task appeared at 07:31:07), so for TaskTypeID 1 the created date IS the run
   date and DAY(CreatedOn) is exact. ACH is a RETURN: it posts against the cycle date but
   the task is raised 3-21 days later, median ~6 (see collections_billing.transform.sql).
   Reusing the card rule would therefore scramble the very split it is meant to make — a
   task from the 1st run created on the 20th would read as the 16th run, and a task from
   the 16th run created on the 3rd of the next month would read as the 1st. There is no
   created-date rule that fixes this: the two passes' task windows genuinely overlap.

   So the run is looked up instead. tmpAchRun holds the dates the ACH recurring run
   actually billed each billing group, and the task takes the day of the latest such run
   at or before it was raised.

   MEASURED over the 15 months to 2026-09-15 (1,008 ACH tasks): the run is found for 882
   of them, 87.5%. The lag from run to task averages 11.8 days and reaches 26 — roughly
   double the ~6-day median quoted in docs/collections_data_retrieval_plan.md, which is
   itself the reason a tighter rule cannot be used. Of the 882, the created-date rule
   would misfile 21 into the wrong pass.

   THE 30-DAY BOUND IS WHERE COVERAGE PLATEAUS, not a guess: 21 days finds 86.6%, 30
   finds 87.5%, and 45 and 60 both find 87.8%. The remaining ~12% have no ACH run on
   their billing group at any lookback, so widening the window only increases the chance
   of reaching back past a cycle boundary for nothing.

   MAX() CANNOT PICK THE WRONG PASS. A billing group belongs to one cycle: across 1,669
   distinct ACH groups over the same window, only 3 group-months were billed on both the
   1st and the 16th. So "the latest run at or before the task" is unambiguous in
   practice, and the 30-day bound cannot straddle two passes of the same group.

   KEYED ON tblRecurringItems, NOT THE INVOICE HEADER. tblOrders.BillingGroupID is
   rewritten by CRM to whichever group eventually PAID, so joining the run to the task
   through the header loses exactly the declines we are trying to attribute — the same
   defect collections_billing.extract.sql corrected on 2026-09-10 and
   collections_invoice.extract.sql documents at length. tblRecurringItems.BillingGroupID
   is the group the run was configured to charge, and it is the only stable key here.

   NO GATEWAY TIER, DELIBERATELY. Reading the run off tblPaymentResponseLog was the
   obvious second source and it is not worth its cost: it needs the whole gateway log for
   the window joined to tblBillingGroups, and it would have to classify ACH off
   bg.PMType, the billing group's method TODAY, which drifts from what the run charged.
   The recurring run is the authoritative record and it resolves a same-day invoice for
   95-100% of cycle-day declines, so the invoice route carries the attribution on its own.
   Tasks with no run in range fall back to DAY(CreatedOn) — wrong only where the lag
   crosses a cycle boundary, and it always yields one of the two real campaigns rather
   than a third "unattributed ACH" bucket.
   agent_email = the assigned owner resolved via the DEDUPED agent table, keyed the
   same way as the Tickets & Tasks report (my_aspnet_users.id = tblSalesPeople.UserID,
   UserID 12 = system excluded; GROUP BY UserID because UserID 12 has two rows).
   Department scoping is applied at the READ layer via ie_dim_employee, so this does
   not pre-filter on DeptID — that dropped AR tasks worked by agents outside depts
   1-3 (cross-department assists the Channel Effectiveness page needs to see).

   OPEN vs CLOSED comes from `tblTaskStatus.Closed`, the status-definition flag the
   legacy Task/Ticket report treats as authoritative (see task_open.extract.sql:
   these "done" tasks often never get a CompletedOn, so the date can't be used).
   Validated 2026-09-07 against every AR ladder: Paid / Reactivated / Non-Payment /
   Duplicate / Cancelled-* / Not Reactivated-* / Billing Cycle Change Cancelled /
   Updated-Contacted are Closed = 1; the numbered outreach + Termd Non-Pay rungs and
   Promised To Pay are Closed = 0 (still being worked). One documented source
   inconsistency: 'Credit Memo - No Contact' is Closed = 0 while its sibling
   'Credit Memo - Contacted' is Closed = 1 — both are a final non-cash disposition,
   so Credit Memo is forced closed here (mirrors how task_open.extract.sql carries
   the one 'Contact Past Due' exception).

   The title still chooses WHICH bucket a closed task lands in, but no longer decides
   whether it is closed at all — that string-parsing bug left 'Non-Payment' and
   'Billing Cycle Change Cancelled' counted as open. Open tasks are sub-bucketed
   (OPEN_NEW / OPEN_TERM / OPEN_PROMISED / OPEN) so the read layer can test
   `outcome LIKE 'OPEN%'` without needing a separate flag column.

   Per-task touch counts + true "ever-termed" are derived in the API from
   ie_fact_collections_touch (full history), not here, so a chunked backfill can't
   truncate them. Aliases match ie_stg_collections_task. */
SET SESSION max_execution_time = 200000;
SET @pFrom := :pFromDate, @pTo := DATE_ADD(:pToDate, INTERVAL 1 DAY);

/* Dates the ACH recurring run billed each billing group. The 45-day lookback reaches
   the previous cycle for a task raised early in the window, since a return can trail
   its run by up to ~21 days and that run can sit in the prior month. */
DROP TEMPORARY TABLE IF EXISTS tmpAchRun;
CREATE TEMPORARY TABLE tmpAchRun(
  BillingGroupID INT NOT NULL,
  RunDate DATE NOT NULL,
  PRIMARY KEY (BillingGroupID, RunDate));

INSERT IGNORE INTO tmpAchRun(BillingGroupID, RunDate)
SELECT ri.BillingGroupID, DATE(o.OrderDate)
FROM tblOrders o
INNER JOIN tblRecurring r
  ON r.RecurringID = o.RecurringID
 AND r.PaymentType = 3
INNER JOIN tblRecurringItems ri
  ON ri.newOrderID = o.OrderID
WHERE o.OrderTypeID = 3
  AND o.OrderDate >= DATE_SUB(@pFrom, INTERVAL 45 DAY)
  AND o.OrderDate < @pTo
  AND IFNULL(ri.BillingGroupID, 0) > 0;

/* The run each ACH task belongs to. MAX picks the latest run at or before the task,
   which is the one it is answering; aggregating here rather than in the final SELECT
   is what keeps tmpAchRun opened once — MySQL cannot reopen a TEMPORARY table twice in
   one statement (the constraint collections_invoice.extract.sql works around too). */
DROP TEMPORARY TABLE IF EXISTS tmpAchTaskRun;
CREATE TEMPORARY TABLE tmpAchTaskRun(
  TaskID INT NOT NULL,
  PRIMARY KEY (TaskID),
  RunDate DATE NOT NULL);

INSERT INTO tmpAchTaskRun(TaskID, RunDate)
SELECT t.TaskID, MAX(ar.RunDate)
FROM tblTask t
INNER JOIN tmpAchRun ar
  ON ar.BillingGroupID = t.BillingGroupID
 AND ar.RunDate <= DATE(t.CreatedOn)
 AND ar.RunDate > DATE_SUB(DATE(t.CreatedOn), INTERVAL 30 DAY)
WHERE t.TaskTypeID = 34
  AND t.CreatedOn >= @pFrom
  AND t.CreatedOn < @pTo
GROUP BY t.TaskID;

SELECT /*+ MAX_EXECUTION_TIME(120000) */
  t.TaskID                                     AS task_id,
  t.TaskTypeID                                 AS task_type_id,
  CASE t.TaskTypeID
    WHEN 1  THEN IF(DAY(t.CreatedOn) <= 15, 'CC_1_15', 'CC_16_31')
    WHEN 34 THEN IF(DAY(IFNULL(atr.RunDate, t.CreatedOn)) <= 15, 'ACH_1_15', 'ACH_16_31')
    WHEN 33 THEN 'CHECK'
    WHEN 4  THEN 'EXP_CC'
    WHEN 9  THEN 'SALES_AR'
  END                                          AS campaign_key,
  t.BillingGroupID                             AS billing_group_id,
  t.CustomerID                                 AS customer_id,
  ag.email                                     AS agent_email,
  t.CreatedOn                                  AS created_on,
  DATE(t.CreatedOn)                            AS created_date,
  t.TaskStatusID                               AS final_status_id,
  cts.Title                                    AS final_status_label,
  CASE
    WHEN cts.Closed = 0 AND cts.Title NOT LIKE 'Credit Memo%' THEN
      CASE
        WHEN cts.Title LIKE 'Termd%'             THEN 'OPEN_TERM'
        WHEN cts.Title LIKE 'Promised%'          THEN 'OPEN_PROMISED'
        WHEN cts.Title LIKE 'Not Started%'       THEN 'OPEN_NEW'
        ELSE 'OPEN'
      END
    WHEN cts.Title LIKE 'Paid%'                  THEN 'PAID'
    WHEN cts.Title LIKE 'Reactivat%'             THEN 'REACTIVATED'
    WHEN cts.Title LIKE 'Updated%'               THEN 'CARD_UPDATED'
    WHEN cts.Title LIKE 'Credit Memo%'           THEN 'CREDIT_MEMO'
    WHEN cts.Title LIKE 'Non-Payment%'
      OR cts.Title LIKE 'Not Reactivated%'
      OR cts.Title LIKE 'Not Updated%'           THEN 'NOT_RECOVERED'
    WHEN cts.Title LIKE 'Cancel%'
      OR cts.Title LIKE '%Cancelled'             THEN 'CANCELLED'
    WHEN cts.Title LIKE 'Duplicate%'             THEN 'DUPLICATE'
    ELSE 'CLOSED_OTHER'
  END                                          AS outcome,
  CASE WHEN cts.Closed = 1
        AND (cts.Title LIKE 'Paid%'
          OR cts.Title LIKE 'Reactivat%'
          OR cts.Title LIKE 'Updated%')
       THEN 1 ELSE 0 END                       AS is_success,
  CASE WHEN cts.Title LIKE 'Termd%' THEN 1 ELSE 0 END AS terminated_flag
FROM tblTask t
JOIN tblTaskStatus cts
  ON cts.TaskStatusID = t.TaskStatusID
LEFT JOIN (
  SELECT UserID, MIN(EMail) AS email
  FROM tblSalesPeople
  WHERE UserID NOT IN (12)
  GROUP BY UserID
) ag ON ag.UserID = t.AssignedTo
LEFT JOIN tmpAchTaskRun atr
  ON atr.TaskID = t.TaskID
WHERE t.TaskTypeID IN (1, 33, 34, 4, 9)
  AND t.CreatedOn >= @pFrom
  AND t.CreatedOn < @pTo;
