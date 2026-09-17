-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: carry currency, transaction type and the paying card.
--
-- Three facts the report needs to be truthful that the warehouse never captured.
-- Each one is currently answered by an assumption, and each assumption is wrong
-- for a measurable population.
--
-- 1. currency_code (invoice staging + fact). Every amount in Cycle Performance is
--    summed and rendered as USD. CRM has carried CurrencyTypeID on tblOrders,
--    tblOrderParts, tblBillingGroups, tblPaymentsCredits and tblPaymentResponseLog
--    all along; tblCurrencyType maps 1 = US Dollar and 2 = Canadian Dollar. In
--    2026-08 seventeen orders are CAD and in 2026-09 thirteen are, and their
--    Canadian dollars are being added straight into the USD totals and printed
--    behind a "$". There is no exchange rate in play and none is wanted: the two
--    currencies must be reported separately, never converted or combined. Stored
--    as the ISO suffix (USD / CAD) rather than the id so every consumer reads it
--    without a lookup, NULL when the source has no currency so an unresolved
--    invoice stays visibly unresolved instead of defaulting to USD.
--
-- 2. transaction_type (billing staging + fact). The run's outcome is taken from
--    the first answered gateway row, and any message that is not an approval is
--    treated as a submission error — a defect on our side. That conflates a
--    rejected submission with a transaction that was accepted and later voided.
--    Invoice 1936494 is the shape of it: the 09-01 04:25:01 SALE answers VOIDED,
--    a VOID at 15:13:35 answers Approved, two corrected SALEs follow, and the
--    invoice settles the next morning at 3,182.75 after starting at 3,248.60.
--    Nine September invoices worth 12,618.35 read as submission errors on that
--    basis, and they are not one outcome either — 1940478's last word is
--    VOID/VOIDED and it never settles. tblPaymentResponseLog.TransactionType
--    (SALE / VOID, NULL on the request row) is what separates them.
--
-- 3. payment_last4 (recovery staging + fact). "Original card retried" is the ELSE
--    arm of the recovery path rule, so every invoice the rule cannot place lands
--    there. It is decided from the order header's billing group, which CRM
--    rewrites after payment, and from a re-key proxy that looks for any later
--    success on the group rather than the payment that settled THIS invoice.
--    1919833 declined 08-01 on group 68054 last4 1781 and was paid 08-03 on group
--    112957 last4 4587, and reads "Original card retried". The gateway row behind
--    the payment carries the last four that actually paid; holding it on the
--    recovery fact lets the path be decided from the payment instead of a proxy.
--    Different last four proves a different card; identical last four does not
--    prove the same card, so the rule stays conservative in that direction.
--
-- The paying billing group needs no column — tblPaymentsCredits is already joined
-- in the recovery extract and pc.BillingGroupID sits unused beside the header id
-- being read instead. That is an extract fix, not a schema change.
--
-- Purely additive: nullable columns, no index, no existing column, key or
-- partition touched. Idempotent via the information_schema guard used by
-- 20260911200000_collections_invoice_pay_request_state.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── which currency is this invoice denominated in? ────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'currency_code') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `currency_code` CHAR(3) NULL AFTER `invoice_amount`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'currency_code') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `currency_code` CHAR(3) NULL AFTER `invoice_amount`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── was the gateway row a sale, or a void of one? ─────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_billing' AND COLUMN_NAME = 'transaction_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_billing` ADD COLUMN `transaction_type` VARCHAR(12) NULL AFTER `result_message`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_billing' AND COLUMN_NAME = 'transaction_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_billing` ADD COLUMN `transaction_type` VARCHAR(12) NULL AFTER `result_message`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── which card actually paid the invoice? ─────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_recovery' AND COLUMN_NAME = 'payment_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_recovery` ADD COLUMN `payment_last4` VARCHAR(4) NULL AFTER `billing_group_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_recovery' AND COLUMN_NAME = 'payment_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_recovery` ADD COLUMN `payment_last4` VARCHAR(4) NULL AFTER `billing_group_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
