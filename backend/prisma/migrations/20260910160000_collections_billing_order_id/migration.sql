-- ─────────────────────────────────────────────────────────────────────────────
-- Collections billing attempts: carry the invoice the gateway was actually
-- charging, plus the card that ran.
--
-- WHY. This fact was built on the belief that "a declined card usually leaves no
-- invoice behind" and that invoices therefore undercount declines by roughly
-- half (see the header of 20260908150000_collections_billing_attempts). That was
-- an artifact of joining decline -> invoice on BillingGroupID. The invoice does
-- exist; recurring charges the site/tblRecurringItems billing group while the
-- invoice header often gets overwritten by whichever group later paid it, so a
-- billing-group join misses it. Invoice 1923909 is the worked example: declined
-- 2026-08-01 on group 98280, header now reads 109639, paid by an agent 8/4.
--
-- tblPaymentResponseLog.PaymentOrderId carries the invoice on BOTH the request
-- and the response, and it is near-universal: over the trailing 13 months it is
-- populated on 99.5% of answered card rows and 99.9% of ACH rows, rising to 100%
-- on the 1st-of-month cycle and 99.9% on the 16th. It resolves to a same-day
-- Recurring invoice for 95-100% of cycle-day declines. That makes it a far
-- better key than amount matching or the billing group.
--
-- GRAIN IS UNCHANGED. Still one billing group per attempt day; uq_fcb_bg still
-- holds. 99.92% of cycle-day billing-group-days charge exactly one invoice
-- (99.93% of declined ones), so order_id is the invoice behind first_result. The
-- <0.1% multi-invoice case keeps only the first; invoice-grain counting comes
-- from ie_fact_collections_invoice, which is the spine, so nothing is lost.
--
-- charge_last4 lets the recovery-path report separate "customer moved to a new
-- billing group" from "same billing group, card was re-keyed."
--
-- Purely additive: two nullable columns and one index. No existing column, key
-- or partition is touched. Idempotent via the information_schema guard used by
-- 20260909130000_sales_play_support_count, because MySQL has no
-- ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_billing' AND COLUMN_NAME = 'order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_billing` ADD COLUMN `order_id` INT NULL AFTER `customer_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_billing' AND COLUMN_NAME = 'charge_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_billing` ADD COLUMN `charge_last4` VARCHAR(4) NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_billing' AND COLUMN_NAME = 'order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_billing` ADD COLUMN `order_id` INT NULL AFTER `customer_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_billing' AND COLUMN_NAME = 'charge_last4') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_billing` ADD COLUMN `charge_last4` VARCHAR(4) NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_billing' AND INDEX_NAME = 'idx_fcb_order') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_billing` ADD KEY `idx_fcb_order` (`order_id`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
