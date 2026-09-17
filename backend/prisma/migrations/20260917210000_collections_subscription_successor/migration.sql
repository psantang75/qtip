-- ─────────────────────────────────────────────────────────────────────────────
-- Collections subscriptions: carry the service that replaced a terminated one,
-- and the order that sold it.
--
-- WHY. `outcome = 'REACTIVATED'` records THAT a service came back but not WHAT it
-- came back as, so nothing downstream can reach the invoice carrying the win-back
-- cash. Campaign x Touch therefore linked a memoed invoice to its replacement on
-- `billing_group_id`, and that key is wrong for this event: a reactivation is
-- normally paid by a NEW card, so the replacement sits on a different billing
-- group from the invoice that was written off. Measured on the 60 declined and
-- memoed September CC invoices (dev, 2026-09-17):
--
--   billing-group link, order type 6      3 invoices     $605.71
--   successor-service link, order type 6  7 invoices   $3,202.80
--
-- The page was reporting under a fifth of the reactivation cash, and no
-- downstream filter can recover a link the fact never carried.
--
-- THE EXTRACT ALREADY RESOLVES THIS. collections_subscription.extract.sql tests
-- `NextServiceID` and reverse `ReactivatedID` to decide REACTIVATED; these two
-- columns store the service those tests find and the order its part belongs to,
-- rather than adding a lookup. Because outcome and successor now come from the
-- same resolution, they cannot disagree.
--
-- successor_order_id IS A JOIN KEY TO ie_fact_collections_invoice, unlike
-- `order_id` on this table (see 20260916200000_collections_subscription_order_id,
-- which warns that the activating order matches no invoice). It holds the order
-- that sold the SUCCESSOR service, which is exactly the invoice the win-back cash
-- lands on. It may name an order type the invoice fact does not ingest (types 0
-- and 2 both occur), in which case the join simply finds nothing — the column
-- stays honest about what CRM recorded and the reader's join decides scope.
--
-- Purely additive: two nullable columns on staging and fact, plus one index on
-- the join key. No existing column, key or partition is touched. Idempotent via
-- the information_schema guard used by
-- 20260916200000_collections_subscription_order_id, because MySQL has no
-- ADD COLUMN IF NOT EXISTS and a bare ALTER aborts on re-run.
--
-- Backfill: the transform is FULL_RELOAD_WINDOW, so the columns populate for a
-- window the next time that window is ingested. Existing rows read NULL until
-- then; every consumer must tolerate NULL rather than assume coverage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staging ───────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_subscription'
      AND COLUMN_NAME = 'successor_service_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_subscription`
     ADD COLUMN `successor_service_id` INT NULL AFTER `reactivated_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_subscription'
      AND COLUMN_NAME = 'successor_order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_subscription`
     ADD COLUMN `successor_order_id` INT NULL AFTER `successor_service_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── fact ──────────────────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_subscription'
      AND COLUMN_NAME = 'successor_service_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_subscription`
     ADD COLUMN `successor_service_id` INT NULL AFTER `reactivated_on`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_subscription'
      AND COLUMN_NAME = 'successor_order_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_subscription`
     ADD COLUMN `successor_order_id` INT NULL AFTER `successor_service_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- The reactivation-cash read probes this from the memoed invoice's own services,
-- so the successor order is the lookup that has to be indexed.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_subscription'
      AND INDEX_NAME = 'idx_fcs_successor_order') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_subscription`
     ADD KEY `idx_fcs_successor_order` (`successor_order_id`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
