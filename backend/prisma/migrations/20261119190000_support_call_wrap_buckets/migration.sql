-- ─────────────────────────────────────────────────────────────────────────────
-- Call Length: the after-call time that lives on the agent's STATUS, not the call.
--
-- Until now handle time was talk + hold + the Genesys `Wrapup` segment. Two kinds of
-- after-call work never reached it, because Genesys records them as agent presence
-- (tblPrimaryPresence) rather than as a segment of the conversation:
--
-- 1. wrap_extended_secs — the org's "Follow-Up Extended" status. Agents set it by
--    hand when the 90s wrap-up timeout was not enough. Roughly 3-4 hours a week
--    across support, none of it ever counted.
-- 2. wrap_pending_secs — the "Wrap Pending" status that replaces both from
--    2026-11-18. Genesys starts it the moment the call disconnects (95% of periods
--    within 2s on 2026-11-16), and it runs alongside the Wrapup segment (91-94% of
--    its minutes on 2026-11-18/19) and can run on after it closes: 205 minutes past
--    wrap on 2026-11-16 alone. It is counted from the end of the call.
--
-- A presence period carries the agent and start/end, never a conversation id, so
-- the extract ties each one to the agent's call by time. Where Wrap Pending and the
-- Wrapup segment overlap, the seconds count once, as Wrap Pending: from these
-- columns on, wrap_secs is the Wrapup time NOT covered by Wrap Pending (unchanged
-- for every call before the status existed). Follow-Up Extended counts only after
-- the wrap. handle_secs includes both columns and still equals the elapsed time.
--
-- Purely additive: NOT NULL DEFAULT 0 on the fact so every existing read keeps
-- working before the backfill, nullable on staging to match its siblings. No index,
-- key or partition touched. Idempotent via the information_schema guard used by
-- 20260914120000_collections_invoice_financial_event_times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_support_call' AND COLUMN_NAME = 'wrap_extended_secs') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_support_call` ADD COLUMN `wrap_extended_secs` INT NULL AFTER `wrap_secs`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_support_call' AND COLUMN_NAME = 'wrap_pending_secs') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_support_call` ADD COLUMN `wrap_pending_secs` INT NULL AFTER `wrap_extended_secs`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_support_call' AND COLUMN_NAME = 'wrap_extended_secs') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_support_call` ADD COLUMN `wrap_extended_secs` INT NOT NULL DEFAULT 0 AFTER `wrap_secs`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_support_call' AND COLUMN_NAME = 'wrap_pending_secs') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_support_call` ADD COLUMN `wrap_pending_secs` INT NOT NULL DEFAULT 0 AFTER `wrap_extended_secs`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
