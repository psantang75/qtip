-- ─────────────────────────────────────────────────────────────────────────────
-- Retire two Collections pages: Channel Effectiveness and Contact Frequency.
--
-- Registry rows only — no schema change. Their routes, services and components
-- were removed in the same change, so leaving these rows active would publish
-- sidebar links to routes that no longer resolve.
--
-- DEACTIVATED, NOT DELETED. `ie_page_role_access` rows hang off `ie_page.id`, and
-- an admin may have granted additional roles or scopes from Page Management since
-- the original seed (20260907190000_seed_collections_pages). Flipping `is_active`
-- hides the pages and blocks direct-URL access while preserving those grants, so
-- restoring either page is one UPDATE rather than a re-grant exercise.
--
-- Idempotent: re-running matches the same two keys and sets the same value.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE `ie_page`
   SET `is_active` = FALSE
 WHERE `page_key` IN ('collections_channels', 'collections_contact');

-- Channel Effectiveness held slot 6, so Agent Performance moves up from 7 to close
-- the gap. Everything above it is unchanged: Overview 1 → Cycle Performance 2 →
-- Cycle Invoices 3 → Failed Charge Invoices 4 → Campaign & Touch 5.
UPDATE `ie_page` SET `sort_order` = 6 WHERE `page_key` = 'collections_agents';
