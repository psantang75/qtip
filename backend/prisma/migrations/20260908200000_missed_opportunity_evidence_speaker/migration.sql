-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities: record WHO said the evidence quote.
--
-- The finding already stores a verbatim `evidence_quote`, but not the speaker,
-- so a manager reading the report cannot tell whether the damning line came
-- from the customer or the rep. The transcript the model reads is already
-- speaker-labelled ("[m:ss — Agent]" / "[m:ss — Customer]", see
-- transcriptRender.genesysSpeaker), so the model always knows — we simply never
-- asked it to tell us, and had nowhere to store the answer.
--
-- Values are 'CUSTOMER' or 'AGENT'. A quote pulled from the rep's own CRM notes
-- is 'AGENT' (the rep wrote it). NULL means the model did not attribute it —
-- which is the honest state for every row graded before this shipped.
--
-- Purely additive: nullable, no default, no backfill, no index (display-only on
-- a page already filtered by date_key / employee_key). Idempotent via the same
-- information_schema guard as 20260908190000_missed_opportunity_crm_ref, because
-- MySQL has no ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_missed_opportunity_finding' AND COLUMN_NAME = 'evidence_speaker') > 0,
  'DO 0',
  'ALTER TABLE `ie_missed_opportunity_finding` ADD COLUMN `evidence_speaker` VARCHAR(16) NULL AFTER `evidence_quote`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
