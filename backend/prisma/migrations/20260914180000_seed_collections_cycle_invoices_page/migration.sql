-- Register Insights → Collections → Cycle Invoices.
--
-- Registry rows only — no schema change. Mirrors
-- 20260910170000_seed_collections_cycle_page. The invoice list is a separate
-- page so Cycle Performance can stay a summary and this drill can load on demand.
--
-- Access = Admin (role 1) + Manager (role 5), data_scope ALL — the same audience
-- as the other Collections pages.
--
-- sort_order 3 puts it directly after Cycle Performance.

INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('collections_cycle_invoices', 'Cycle Invoices',
   'Invoice list behind Cycle Performance: run result, AR task, recovery path, recovered cash, and outstanding balance.',
   'Collections', '/app/insights/collections-cycle-invoices', 'List', 3, TRUE, 'insights');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_cycle_invoices';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_cycle_invoices';

UPDATE `ie_page` SET `sort_order` = 4 WHERE `page_key` = 'collections_campaign';
UPDATE `ie_page` SET `sort_order` = 5 WHERE `page_key` = 'collections_channels';
UPDATE `ie_page` SET `sort_order` = 6 WHERE `page_key` = 'collections_agents';
UPDATE `ie_page` SET `sort_order` = 7 WHERE `page_key` = 'collections_contact';
