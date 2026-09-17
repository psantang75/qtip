-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: when the money actually landed on an invoice.
--
-- Cycle Performance reports how much outreach a decline took, and it counts every
-- touch ever logged against the task. Effort after the invoice was settled is
-- therefore reported as effort that led to the settlement. Invoice 1919497 is the
-- shape of it: 419.40 was credit-memoed on 08-06 at 15:07:40 Eastern, and of the five
-- touches on task 1104623 three precede that (Declined CC #1, #2, #3) while two follow
-- it (Credit Memo - No Contact at 15:08:33, Not Reactivated - Contacted at 16:02:47).
-- The page presents all five as the work that resolved it. At least 42 declined
-- invoices carry post-payment touches this way.
--
-- Splitting them needs the instant of the financial event, and the warehouse holds
-- neither one we need:
--
-- 1. first_cash_on. `paid_on` is MAX(AppliedOn) over cash lines — the moment the
--    balance was FULLY settled. For the touch window we need the moment cash FIRST
--    arrived, which is a different date whenever an invoice was paid in instalments.
--    The recovery fact does carry an earliest application, but it cannot be the source
--    here: it is gated to customers who had an AR task, and that gate is exactly what
--    left September's 1936399 (838.80), 1937195 (790.80) and 1939578 (30.95) out of
--    recovery while the invoice fact knew their cash all along — the 1,660.55 by which
--    section 2 and section 3 disagreed. Reading first cash off the invoice makes the
--    invoice self-sufficient and closes that gap at the same time.
--
-- 2. credit_memo_on. Not carried in any form. A write-off resolves an invoice just as
--    finally as a payment does, and 1919497 has no cash row at all, so without this
--    column a memoed invoice has no financial event and its touch window cannot be
--    closed. The recovery fact cannot supply it either, and deliberately so — it is
--    collected cash only, and admitting memos would corrupt every cash measure built
--    on it.
--
-- Both read vwPaymentsCreditsOrdersApproved, already joined in the invoice extract as
-- `ap`; this is one more MIN() per arm beside the SUM()s that are there now.
--
-- DATETIME, not DATE, because the comparison is against touch.created_on to the
-- second — 1919497's memo and its next touch are 53 seconds apart, and a date would
-- put both on 08-06 and resolve nothing. Stored as the UTC instant the primary pool
-- writes, matching task/touch/recovery, so the comparison is like-for-like; see
-- backend/src/services/insights/collections/easternTime.ts for the one place that
-- convention has to be undone.
--
-- Purely additive: nullable columns, no index, no existing column, key or partition
-- touched. Idempotent via the information_schema guard used by
-- 20260914060000_collections_currency_txntype_payer_card.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── when did cash first arrive? ───────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'first_cash_on') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `first_cash_on` DATETIME NULL AFTER `paid_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'first_cash_on') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `first_cash_on` DATETIME NULL AFTER `paid_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── when was it written off instead? ──────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'credit_memo_on') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `credit_memo_on` DATETIME NULL AFTER `first_cash_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'credit_memo_on') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `credit_memo_on` DATETIME NULL AFTER `first_cash_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
