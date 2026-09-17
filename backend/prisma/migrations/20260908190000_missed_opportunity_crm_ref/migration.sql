-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities: cite the CRM work item behind each finding.
--
-- WHY THE MODEL HAS TO NAME IT RATHER THAN US JOINING TO IT. There is no key
-- between a Genesys conversation and a CRM record: Genesys carries no TaskID or
-- TicketID, and neither tblTask nor tblTicket carries a ConversationID. That gap
-- is already documented in CallTicketLinkerService. What we DO have is the set of
-- notes the rep wrote that same day, which the analyzer already reads as context
-- for judging follow-through. Labelling each of those notes with its own
-- TASK/TICKET id lets the model cite the one the miss is about, and the parser
-- then validates that citation against the ids actually shown to it — so a
-- hallucinated id is dropped rather than deep-linked to a stranger's record.
--
-- WHY TWO COLUMNS. A sales rep's day notes come from BOTH sides of the CRM:
-- task actions live in tblAction (keyed by TaskID) and ticket notes live in
-- tblTicketNote (keyed by TicketID) — separate tables with separate id spaces,
-- so an id alone is ambiguous. Storing the kind alongside it mirrors
-- submission_ticket_tasks (kind + external_id), which is what the Quality
-- ticket/task panel already stores, and lets both use the same CRM deep-link
-- builder.
--
-- Purely additive: nullable, no default, no backfill. Every existing finding
-- keeps its data and simply reads as "no CRM record cited", which is the honest
-- state for rows graded before this shipped.
--
-- No index: these columns are display-only on a page that already filters by
-- date_key and employee_key. An index here would cost writes on every nightly
-- run and serve no read.
--
-- Idempotent via the information_schema guard from
-- 20260908120000_collections_channel_funnel, because MySQL has no
-- ADD COLUMN IF NOT EXISTS and a bare ALTER aborts the script on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_missed_opportunity_finding' AND COLUMN_NAME = 'crm_task_kind') > 0,
  'DO 0',
  'ALTER TABLE `ie_missed_opportunity_finding` ADD COLUMN `crm_task_kind` VARCHAR(16) NULL AFTER `customer_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_missed_opportunity_finding' AND COLUMN_NAME = 'crm_task_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_missed_opportunity_finding` ADD COLUMN `crm_task_id` INT NULL AFTER `crm_task_kind`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
