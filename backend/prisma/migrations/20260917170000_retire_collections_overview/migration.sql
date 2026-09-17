-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the Collections Overview page.
--
-- Registry rows only — no schema change. Its route, service, page component and
-- response contract were removed in the same change, so leaving this row active
-- would publish a sidebar link to a route that no longer resolves.
--
-- Follows 20260917140000_retire_collections_channels_contact: DEACTIVATED, NOT
-- DELETED, because `ie_page_role_access` grants hang off `ie_page.id` and an admin
-- may have added roles from Page Management since the original seed
-- (20260907190000_seed_collections_pages). Restoring the page stays one UPDATE.
--
-- The `col_*` KPI definitions this page rendered are deliberately left in the
-- frontend catalog (`constants/kpiDefs.ts`): Campaign & Touch still reads
-- `col_recovery_rate` and `col_first_touch_success` for its metric tooltips, and
-- the catalog is looked up by code rather than enumerated as a page menu.
--
-- Idempotent: re-running matches the same key and sets the same value.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE `ie_page`
   SET `is_active` = FALSE
 WHERE `page_key` = 'collections_overview';

-- Overview held slot 1, so everything still active moves up one to close the gap:
-- Cycle Performance 1 → Cycle Invoices 2 → Failed Charge Invoices 3 →
-- Campaign & Touch 4 → Agent Performance 5.
UPDATE `ie_page` SET `sort_order` = 1 WHERE `page_key` = 'collections_cycle';
UPDATE `ie_page` SET `sort_order` = 2 WHERE `page_key` = 'collections_cycle_invoices';
UPDATE `ie_page` SET `sort_order` = 3 WHERE `page_key` = 'collections_failed_charges';
UPDATE `ie_page` SET `sort_order` = 4 WHERE `page_key` = 'collections_campaign';
UPDATE `ie_page` SET `sort_order` = 5 WHERE `page_key` = 'collections_agents';
