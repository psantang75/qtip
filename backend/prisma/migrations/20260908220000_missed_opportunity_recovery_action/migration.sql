-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities: how to recover THIS account NOW (nullable).
--
-- recommended_approach is the rewind-the-tape coaching line ("what the rep
-- should have said on the call"). Managers also need a morning-after action
-- when the deal is still live: call Amy before 10, place the order, transfer
-- to CS. That is a different clock, so it is a different column.
--
-- NULL is the honest state: coaching-only misses (voicemail, conduct), deals
-- already won or dead, and every row graded before this shipped. No backfill.
--
-- Purely additive. Idempotent via the information_schema guard because MySQL
-- has no ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_missed_opportunity_finding' AND COLUMN_NAME = 'recovery_action') > 0,
  'DO 0',
  'ALTER TABLE `ie_missed_opportunity_finding` ADD COLUMN `recovery_action` TEXT NULL AFTER `recommended_approach`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
