-- Register Insights → Collections → Failed Charge Invoices.
--
-- Registry rows only — no schema change. Mirrors
-- 20260914180000_seed_collections_cycle_invoices_page. Failed Charge Invoices is
-- the declined slice of Cycle Invoices, sliced by decline reason, so it sits
-- directly after Cycle Invoices and shares its audience.
--
-- Access = Admin (role 1) + Manager (role 5), data_scope ALL — the same audience
-- as the other Collections pages.
--
-- sort_order 4 puts it directly after Cycle Invoices; the pages below it shift down.

INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('collections_failed_charges', 'Failed Charge Invoices',
   'Declined invoices on the run, sliced by why the charge failed: decline reason, AR task, recovery path, recovered cash, and outstanding balance.',
   'Collections', '/app/insights/collections-failed-charges', 'CreditCard', 4, TRUE, 'insights');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_failed_charges';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'collections_failed_charges';

UPDATE `ie_page` SET `sort_order` = 5 WHERE `page_key` = 'collections_campaign';
UPDATE `ie_page` SET `sort_order` = 6 WHERE `page_key` = 'collections_channels';
UPDATE `ie_page` SET `sort_order` = 7 WHERE `page_key` = 'collections_agents';
UPDATE `ie_page` SET `sort_order` = 8 WHERE `page_key` = 'collections_contact';
