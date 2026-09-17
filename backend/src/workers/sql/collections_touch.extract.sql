/* Collections Touch extract (source pool: crm). Grain: one agent status-ladder move
   ("touch") on an AR task, window-bound by :pFromDate / :pToDate on the action's
   CompletedOn.

   TOUCH DEFINITION — aligned with the Tickets & Tasks report, which is the single
   source of truth for "an agent worked this item" (task_open.extract.sql +
   insightsTouchDetail.service.ts). Validated against the June 2026 Declined CC (1st)
   cohort on 2026-09-07 (341 tasks / 2,683 actions):
     - `Note <> ''` is what makes an action a real event. 628 of the 2,683 actions
       carry no note at all: they are the scheduled follow-up rows the system opens
       when a status is set (CreatedBy 0/12), not work anybody did.
     - The actor is `CompletedBy` and the time is `CompletedOn`, NOT CreatedBy /
       CreatedOn. Those disagree on 1,367 of 2,683 actions (51%) and land on a
       different calendar day 944 times (35%), because the system creates the
       follow-up row and the agent completes it later. Keying on CreatedBy was
       undercounting touch #1 by ~3x (80 counted vs 231 real) while overcounting
       later rungs — the direct cause of the wrong marginal-recovery curve.
     - A ladder move writes a "Task Status Changed from [X] to [Y]" note. Every one
       of those in the validation cohort resolved to a real agent, and the filter
       cleanly excludes the note families that are NOT a collections touch: logged
       dunning emails (`<html>` / `<div>` bodies, 102 rows), portal
       "invoice viewed" stamps (67), re-assignment stamps (56), bounce
       notifications, and the task-creation stamp. This is the same bracketed family
       systemNoteClassifier.ts deliberately KEEPS as human work.
     - The stamp is matched ANYWHERE in the note, never anchored to the start. The
       CRM began prefixing it with a separator part-way through August 2026, so a
       `LIKE 'Task Status Changed%'` anchor silently dropped every touch from
       2026-08-28 onward (September: 0 matched vs 726 real) and read as "the source
       has no recent activity". The stamp is now written as
       `{agent note} - Task Status Changed from [X] to [Y]`: over 13 months 958 notes
       carry the bare ' - ' separator and 70 carry real agent text ahead of it, and
       both are genuine touches. Keeping `from ` in the pattern holds it to the
       transition stamp rather than any stray mention.
   `tblAction.TaskStatusID` is the status the action moved the task TO (verified:
   the note's "to [X]" text matches the joined status title on 100% of rows).

   TOUCH NUMBERING — `touch_seq` is a single continuous rung across the campaign's
   cadence, so "5 calls, then terminate, then 5 more" reads as touches 1-11 on one
   axis. Term rungs are offset by the length of that ladder's outreach leg and the
   final call sits one past the end, both derived per TaskTypeID from tblTaskStatus
   (`lad`) rather than hard-coded, because the ladders differ: CC/ACH run 5 outreach
   + 5 term + final, Expiring CC runs 10 outreach with no term leg, and Sales AR
   runs 3 "Contact Attempt N" rungs. Without this offset 'Declined CC #3' and
   'Termd Non-Pay #3' both parsed to 3 and were summed into one bar.
   'Invoice Generated #N' is a parallel invoice/email track rather than a call rung,
   so it is phase INVOICE with a NULL touch_seq: still counted as agent effort and
   contact frequency, but kept out of the numbered call ladder.

   CAMPAIGN HERE IS A FALLBACK ONLY. The transform inherits campaign_key from
   ie_fact_collections_task, which is where a task's campaign is actually decided, and
   only uses the value below when it holds no row for the task (a touch logged today on
   a task older than the task fact's 15-month window). Keeping the derivation cheap is
   the point: the ACH 1st/16th split needs the RUN behind the task, not the task's
   created date, and reproducing that lookup here would be a second copy of a rule that
   is already resolved upstream. See collections_task.extract.sql.

   Aliases match ie_stg_collections_touch exactly. */
SELECT /*+ MAX_EXECUTION_TIME(120000) */
  a.ActionID                                   AS action_id,
  a.TaskID                                     AS task_id,
  CASE t.TaskTypeID
    WHEN 1  THEN IF(DAY(t.CreatedOn) <= 15, 'CC_1_15', 'CC_16_31')
    WHEN 34 THEN IF(DAY(t.CreatedOn) <= 15, 'ACH_1_15', 'ACH_16_31')
    WHEN 33 THEN 'CHECK'
    WHEN 4  THEN 'EXP_CC'
    WHEN 9  THEN 'SALES_AR'
  END                                          AS campaign_key,
  a.TaskStatusID                               AS status_id_after,
  ts.Title                                     AS status_label,
  NULLIF(CASE
    WHEN ts.Title LIKE 'Invoice Generated%' THEN 0
    WHEN ts.Title LIKE 'Termd%Final%' OR ts.Title LIKE '%Final Call%'
      THEN IFNULL(lad.outreach_max, 0) + IFNULL(lad.term_max, 0) + 1
    WHEN ts.Title LIKE 'Termd%' AND ts.Title LIKE '%#%'
      THEN IFNULL(lad.outreach_max, 0)
         + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(ts.Title, '#', -1), ' ', 1), '-', 1) AS UNSIGNED)
    WHEN ts.Title LIKE '%#%'
      THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(ts.Title, '#', -1), ' ', 1), '-', 1) AS UNSIGNED)
    WHEN ts.Title REGEXP 'Attempt [0-9]+$'
      THEN CAST(SUBSTRING_INDEX(ts.Title, ' ', -1) AS UNSIGNED)
    ELSE 0
  END, 0)                                      AS touch_seq,
  ts.Title                                     AS touch_label,
  CASE
    WHEN ts.Title LIKE 'Invoice Generated%' THEN 'INVOICE'
    WHEN ts.Title LIKE 'Termd%Final%' OR ts.Title LIKE '%Final Call%' THEN 'FINAL'
    WHEN ts.Title LIKE 'Termd%' THEN 'TERM'
    ELSE 'OUTREACH'
  END                                          AS phase,
  CASE WHEN ts.Title LIKE '%2nd Call%' THEN 1 ELSE 0 END AS is_2nd_call,
  ag.email                                     AS agent_email,
  a.CompletedOn                                AS created_on,
  DATE(a.CompletedOn)                          AS created_date
FROM tblAction a
JOIN tblTask t
  ON t.TaskID = a.TaskID
 AND t.TaskTypeID IN (1, 33, 34, 4, 9)
JOIN tblTaskStatus ts
  ON ts.TaskStatusID = a.TaskStatusID
 AND ts.Title NOT LIKE 'Not Started%'
JOIN (
  SELECT UserID, MIN(EMail) AS email
  FROM tblSalesPeople
  WHERE UserID NOT IN (12)
  GROUP BY UserID
) ag ON ag.UserID = a.CompletedBy
LEFT JOIN (
  SELECT r.TaskTypeID,
         MAX(CASE WHEN r.Title NOT LIKE 'Termd%' THEN r.rung END) AS outreach_max,
         MAX(CASE WHEN r.Title LIKE 'Termd%'     THEN r.rung END) AS term_max
  FROM (
    SELECT ts2.TaskTypeID, ts2.Title,
           CASE
             WHEN ts2.Title LIKE 'Invoice Generated%' THEN NULL
             WHEN ts2.Title LIKE '%#%'
               THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(ts2.Title, '#', -1), ' ', 1), '-', 1) AS UNSIGNED)
             WHEN ts2.Title REGEXP 'Attempt [0-9]+$'
               THEN CAST(SUBSTRING_INDEX(ts2.Title, ' ', -1) AS UNSIGNED)
           END AS rung
    FROM tblTaskStatus ts2
    WHERE ts2.TaskTypeID IN (1, 33, 34, 4, 9)
  ) r
  WHERE r.rung > 0
  GROUP BY r.TaskTypeID
) lad ON lad.TaskTypeID = t.TaskTypeID
WHERE a.Note LIKE '%Task Status Changed from %'
  AND a.CompletedOn >= :pFromDate
  AND a.CompletedOn < DATE_ADD(:pToDate, INTERVAL 1 DAY);
