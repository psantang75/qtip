-- ─────────────────────────────────────────────────────────────────────────────
-- Sales plays: record how many source calls back each play (its "support").
--
-- The miner emits ~2.5 plays per call, so a 90-day mine produced thousands of
-- rows that are 97% unique by title yet cluster into a few dozen genuinely
-- distinct moves ("ask about new locations on every check-in" showed up ~70
-- times). That repetition is signal: a play mined from 70 winning calls is
-- proven. Consolidation collapses each cluster to one exemplar and records the
-- cluster size here, so the reviewer prompt can rank by proven-ness and cap to
-- the top-N per category instead of dumping every reworded duplicate.
--
-- NULL means "not yet consolidated" (treated as 1 when ranking). Purely
-- additive: nullable, no default backfill. Idempotent via the same
-- information_schema guard as 20260908200000_missed_opportunity_evidence_speaker,
-- because MySQL has no ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_sales_play' AND COLUMN_NAME = 'support_count') > 0,
  'DO 0',
  'ALTER TABLE `ie_sales_play` ADD COLUMN `support_count` INT NULL AFTER `sort_order`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
