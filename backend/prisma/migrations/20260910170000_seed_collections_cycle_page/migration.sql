-- ─────────────────────────────────────────────────────────────────────────────
-- Register Insights → Collections → Cycle Performance.
--
-- Registry rows only — no schema change. Mirrors
-- 20260907190000_seed_collections_pages: the sidebar group comes from
-- ie_page.category and visibility/access comes entirely from
-- ie_page_role_access, so the page does not exist for anyone until it is
-- granted here.
--
-- Access = Admin (role 1) + Manager (role 5), data_scope ALL — the same audience
-- as the other five Collections pages. Admins can widen this from Page
-- Management without a code change.
--
-- sort_order 2 puts it directly after Overview: it is the intake report the
-- other four pages hang off, so it reads before Campaign & Touch.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('collections_cycle', 'Cycle Performance',
   'Recurring billing cycle by invoice: processed, declined, error and no-charge outcomes, decline reasons, and how declines were recovered.',
   'Collections', '/app/insights/collections-cycle', 'Receipt', 2, TRUE, 'insights');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_cycle';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_cycle';

-- Shift the four pages that used to sit at 2-5 down one slot so the group keeps
-- a stable order. Safe to re-run: it sets absolute values, not increments.
UPDATE `ie_page` SET `sort_order` = 3 WHERE `page_key` = 'collections_campaign';
UPDATE `ie_page` SET `sort_order` = 4 WHERE `page_key` = 'collections_channels';
UPDATE `ie_page` SET `sort_order` = 5 WHERE `page_key` = 'collections_agents';
UPDATE `ie_page` SET `sort_order` = 6 WHERE `page_key` = 'collections_contact';
