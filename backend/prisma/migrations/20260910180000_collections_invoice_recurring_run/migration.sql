-- ─────────────────────────────────────────────────────────────────────────────
-- Collections invoice: carry the recurring RUN that produced the invoice.
--
-- WHY. campaign_key for a recurring invoice was derived from
-- tblBillingGroups.PMType plus DAY(OrderDate). PMType is the billing group's
-- payment method TODAY, not the method the run actually charged, so it drifts.
-- On 2026-08-01 the Check run (RecurringID 521) held 75 invoices whose billing
-- group now reads credit card and the ACH run (522) held 5 — every one of them
-- was being counted as "Declined CC (1st)".
--
-- tblRecurring is the authoritative, immutable record of the run:
--   RecurringID (PK) | StartedOn | PaymentType (1 Credit Card, 2 Check, 3 ACH)
-- One run per payment type per month, all started on the 1st. August 2026:
--   520 -> PaymentType 1, 521 -> PaymentType 2, 522 -> PaymentType 3.
--
-- A RecurringID is NOT the 1st vs the 16th — both passes share it. 520 wrote
-- 7,942 invoices on 08-01 and a further 6,017 on 08-16. The campaign therefore
-- needs BOTH the run's payment type and the invoice's own date:
--   PaymentType 1 + day 1..15  -> CC_1_15     PaymentType 3 -> ACH
--   PaymentType 1 + day 16..31 -> CC_16_31    PaymentType 2 -> CHECK
-- RecurringID 520 on 2026-08-01 is exactly the 7,942 invoices / $831,573.20 in
-- the hand-built August review, which is what makes this reconcilable to CRM.
--
-- recurring_payment_type is denormalised onto the invoice rather than looked up
-- through a run dimension: it is a single immutable tinyint, the fact is already
-- partitioned for scan-heavy reads, and every campaign predicate would otherwise
-- need a join. order_type_id 1 (Order) and 6 (Reactivation) have no run, so both
-- columns stay NULL there and the transform falls back to the task's campaign.
--
-- Purely additive: two nullable columns per table and one index. No existing
-- column, key or partition is touched. Idempotent via the information_schema
-- guard used by 20260910160000_collections_billing_order_id, because MySQL has
-- no ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'recurring_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `recurring_id` INT NULL AFTER `order_type_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'recurring_payment_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `recurring_payment_type` TINYINT NULL AFTER `recurring_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'recurring_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `recurring_id` INT NULL AFTER `order_type_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'recurring_payment_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `recurring_payment_type` TINYINT NULL AFTER `recurring_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- The Cycle Performance spine is always "one run, one date", so date_key leads.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND INDEX_NAME = 'idx_fci_recurring') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD KEY `idx_fci_recurring` (`date_key`, `recurring_id`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
