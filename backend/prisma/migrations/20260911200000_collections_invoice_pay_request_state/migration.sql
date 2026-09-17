-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: say WHY an invoice was never charged, instead of shrugging.
--
-- "Never attempted · other" was hiding a run defect. Validating the 2026-08-01
-- card run against CRM: of 7,942 recurring card invoices, 7,917 had a payment
-- request sent AND confirmed, 23 had a request sent with no confirmation ever
-- recorded, and 2 never had a request sent at all. Nineteen of the invoices sitting
-- in "other" that day are in that unconfirmed group, and their cards check out
-- against tblBillingGroupsArchive — 1922043's runs to 07/2031. They were not
-- skipped because of the card. The run started charging them at 04:03:57-04:04:10
-- and never finished.
--
-- tblRecurringItems already records this per service item as PayAuthStartedOn /
-- PayAuthFinishedOn. Despite the column names these are the payment request going
-- out and the confirmation coming back, NOT a card authorisation hold — the CRM
-- wording is kept in SQL comments for traceability and kept out of anything a user
-- reads. Because the grain is per item, the extract counts unconfirmed items rather
-- than taking a MIN: an invoice where three of five items confirmed must not read
-- as fully confirmed.
--
-- Two columns:
--
-- 1. pay_request_state (staging + fact). CONFIRMED / UNCONFIRMED / NOT_SENT, NULL
--    when the invoice has no recurring items at all (order types 1 and 6 have no
--    run, and invoice 1935704 on 08-16 has no item rows either). RESULT_CASE folds
--    NULL in with NOT_SENT — no record of a request having gone out.
--
-- 2. card_from_archive (staging only). The card-state rule refuses to judge a
--    billing group whose CreatedOn post-dates the invoice, on the grounds that its
--    stored card cannot be the one the run saw. That guard was too broad: CRM
--    REWRITES CreatedOn when a card is re-keyed in place, so it fired on exactly the
--    customers who fixed their card. Group 76262 reads CreatedOn 2026-08-03, which
--    is the moment the customer extended the same card (last4 5032 before and
--    after) — and the archive plainly shows it expired 07/2026, i.e. expired on the
--    08-01 run. Three August invoices were mislabelled UNKNOWN this way. The guard
--    only makes sense when the extract fell back to the LIVE billing group, so the
--    extract now says which source it used. Staging only: the fact keeps the
--    verdict, not the provenance of the read.
--
-- Purely additive: nullable columns, no index, no existing column, key or partition
-- touched. Idempotent via the information_schema guard used by
-- 20260911160000_collections_error_detail_and_payer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── did the run send a payment request, and did it come back? ─────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'pay_request_state') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `pay_request_state` VARCHAR(12) NULL AFTER `card_billing_group_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'pay_request_state') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `pay_request_state` VARCHAR(12) NULL AFTER `card_state`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── was the card read from the archive, or from the live group? ───────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'card_from_archive') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `card_from_archive` TINYINT NULL AFTER `card_group_created_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
