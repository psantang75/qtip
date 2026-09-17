-- ─────────────────────────────────────────────────────────────────────────────
-- Collections invoice: carry the CARD THE RUN ACTUALLY SAW.
--
-- WHY. "Never attempted" (an invoice the run wrote but the gateway never
-- answered for) is not one failure — on 2026-09-01 sixteen of the twenty-five
-- were sitting on a card that had already expired, and those recover 50% of the
-- money against 100% for the ones that got a replacement card. Splitting the
-- bucket on card state is only possible if the card state is on the fact.
--
-- WHY NOT READ tblBillingGroups AT LOAD TIME. It is the card TODAY. The invoice
-- transform is FULL_RELOAD_WINDOW — it deletes the date window and re-inserts
-- from a fresh CRM read — so a derived-at-load-time expiry is rewritten on every
-- reload, and an invoice silently migrates out of the expired bucket the moment
-- the customer fixes their card. The bucket would heal itself and permanently
-- under-report. Measured on 2026-09-01: the live billing group says 10 of 25
-- expired, the as-of card says 16. Faulkner Infiniti reads as a valid 06/2028
-- card today; on the 1st it was a different card that expired in 12/2024.
-- This is the same class of bug that recurring_payment_type fixed for pm_type
-- (see 20260910180000_collections_invoice_recurring_run).
--
-- WHERE THE AS-OF CARD COMES FROM. tblBillingGroupsArchive keeps every prior
-- version of a billing group with an ArchivedOn stamp (609k rows, back to 2014).
-- The earliest archived row on or after the invoice date IS the card the run
-- charged; when there is none the live row has not changed since and is used.
-- That makes the value deterministic on every reload and backfillable across the
-- whole 15-month window, so no frozen column or snapshot table is needed.
--
-- card_state is derived in the transform, not here, because it needs the
-- invoice's own order_date and the run's payment type:
--   REPLACED — the billing group did not exist on the invoice date (CRM
--              repointed the invoice at a replacement card group; the original
--              card is unknowable, and 5 of 5 such invoices in September paid)
--   EXPIRED  — card_expire_ym is earlier than the invoice's own year+month
--   VALID    — card was in date
--   NULL     — not a card group, or no expiry on file
--
-- Purely additive: three nullable columns per table and one index. No existing
-- column, key or partition is touched. Idempotent via the information_schema
-- guard used by 20260910180000_collections_invoice_recurring_run, because MySQL
-- has no ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
-- card_group_created_on is staging-only: it is an input to card_state, not a
-- measure worth carrying on the fact.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'card_expire_ym') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `card_expire_ym` INT NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'card_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `card_last4` VARCHAR(4) NULL AFTER `card_expire_ym`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'card_group_created_on') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `card_group_created_on` DATE NULL AFTER `card_last4`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'card_expire_ym') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `card_expire_ym` INT NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'card_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `card_last4` VARCHAR(4) NULL AFTER `card_expire_ym`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'card_state') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `card_state` VARCHAR(10) NULL AFTER `card_last4`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- The Cycle Performance spine is always "one run, one date", so date_key leads —
-- same shape as idx_fci_recurring.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND INDEX_NAME = 'idx_fci_card_state') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD KEY `idx_fci_card_state` (`date_key`, `card_state`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
