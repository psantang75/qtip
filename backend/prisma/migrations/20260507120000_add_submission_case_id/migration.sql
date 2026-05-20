-- Phase C (C4): tag every submission with the multi-source `case_id`
-- it belongs to. Format is `<KIND>:<external_id>` (e.g. `TICKET:279060`
-- or `CALL:abcd-1234-...`). The case_id of a submission is the
-- KIND:external_id of its primary source; a submission attached to a
-- ticket via the call linker carries the TICKET case_id.
--
-- Why a single VARCHAR rather than (kind, external_id) cols: keeps the
-- key indexable as one column and makes the inbox query a flat group-by
-- without forcing every consumer to know the kind/id encoding.
ALTER TABLE `submissions`
  ADD COLUMN `case_id` VARCHAR(64) NULL AFTER `call_id`;

CREATE INDEX `idx_submissions_case_id` ON `submissions` (`case_id`);

-- Backfill: derive case_id from the existing link tables. Order of
-- preference matches the Phase C `loadCase` primary-source rule:
--   1. linked TICKET row (most submissions today)
--   2. linked TASK row
--   3. linked CALL row (uses calls.call_id, the Genesys conversation id
--      string, NOT the internal calls.id integer)
-- Submissions with none of those links keep case_id = NULL.
UPDATE `submissions` s
   JOIN (
     SELECT submission_id, MIN(external_id) AS external_id
       FROM `submission_ticket_tasks`
      WHERE kind = 'TICKET'
      GROUP BY submission_id
   ) t ON t.submission_id = s.id
    SET s.case_id = CONCAT('TICKET:', t.external_id)
  WHERE s.case_id IS NULL;

UPDATE `submissions` s
   JOIN (
     SELECT submission_id, MIN(external_id) AS external_id
       FROM `submission_ticket_tasks`
      WHERE kind = 'TASK'
      GROUP BY submission_id
   ) t ON t.submission_id = s.id
    SET s.case_id = CONCAT('TASK:', t.external_id)
  WHERE s.case_id IS NULL;

UPDATE `submissions` s
   JOIN (
     SELECT sc.submission_id, MIN(c.call_id) AS conversation_id
       FROM `submission_calls` sc
       JOIN `calls` c ON c.id = sc.call_id
      WHERE c.call_id IS NOT NULL AND c.call_id <> ''
      GROUP BY sc.submission_id
   ) c ON c.submission_id = s.id
    SET s.case_id = CONCAT('CALL:', c.conversation_id)
  WHERE s.case_id IS NULL;
