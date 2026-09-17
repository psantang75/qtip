-- ─────────────────────────────────────────────────────────────────────────────
-- Collections subscriptions: carry the order that activated the service line.
--
-- WHY. The subscription fact records no order at all — only order_part_id,
-- billing_group_id, customer_id and task_id — so nothing downstream can name
-- WHICH service a reactivation belongs to. Campaign x Touch has to link
-- subscriptions to invoices by billing group, which answers "a service on the
-- card this invoice bills to" rather than "this service". Reactivation work
-- needs the service line itself, and the order part is the only handle on it.
--
-- The extract already walks the order: tblOrders o -> tblOrderParts op ->
-- tblService s (see collections_subscription.extract.sql). o.OrderID is in the
-- join today and simply was not selected, so this captures a value the query
-- already resolves rather than adding a lookup.
--
-- READ IT AS THE ACTIVATING ORDER, NOT THE BILLED ONE. The extract joins
-- o.BillingGroupID = t.BillingGroupID, i.e. every order on the task's billing
-- group, and the service hangs off op.OrderPartID. So order_id identifies the
-- order that SOLD the service line. It is generally NOT the declined recurring
-- invoice's order_id, because that is a later billing order against the same
-- group. Do not treat this as a join key to ie_fact_collections_invoice: it
-- names the service, it does not match the invoice.
--
-- Purely additive: one nullable column on staging and fact, plus an index for
-- the service-line lookups this exists to serve. No existing column, key or
-- partition is touched. Idempotent via the information_schema guard used by
-- 20260910160000_collections_billing_order_id, because MySQL has no
-- ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
--
-- Backfill: the transform is FULL_RELOAD_WINDOW, so the column populates for a
-- window the next time that window is ingested. Existing rows read NULL until
-- then; every consumer must tolerate NULL rather than assume coverage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_subscription' AND COLUMN_NAME = 'order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_subscription` ADD COLUMN `order_id` INT NULL AFTER `order_part_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_subscription' AND COLUMN_NAME = 'order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_subscription` ADD COLUMN `order_id` INT NULL AFTER `order_part_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_subscription' AND INDEX_NAME = 'idx_fcs_order') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_subscription` ADD KEY `idx_fcs_order` (`order_id`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
