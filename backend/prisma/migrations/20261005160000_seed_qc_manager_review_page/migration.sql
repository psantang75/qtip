-- Register Insights → Quality, Coaching & Performance Warnings → Manager Review Items.
--
-- Registry rows only — no schema change. Mirrors
-- 20260915120000_seed_collections_failed_charges_page. The page reports answers
-- to form questions marked Agent Visible = No (form_questions.visible_to_csr = 0),
-- e.g. the coaching questions + manager notes on Sales Interaction QA.
--
-- Management only: Admin (1) ALL, Manager (5) DIVISION (same scope Managers have
-- on qc_agents). QA (2) and Trainer (4) are seeded closed so an admin can open
-- them from the Insights Pages screen. CSR (3) gets no row; the API also rejects
-- SELF scope in code regardless of this configuration.
--
-- sort_order 6 places it after Agent Performance (qc_agents = 5).

INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('qc_manager_review', 'Manager Review Items',
   'Answers to form questions hidden from agents (Agent Visible = No): coaching questions and manager-only notes by form, question, and agent.',
   'Quality, Coaching & Performance Warnings', '/app/insights/qc-manager-review', 'ClipboardCheck', 6, TRUE, 'insights');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'qc_manager_review';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'DIVISION' FROM `ie_page` WHERE `page_key` = 'qc_manager_review';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 2, FALSE, 'ALL' FROM `ie_page` WHERE `page_key` = 'qc_manager_review';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 4, FALSE, 'ALL' FROM `ie_page` WHERE `page_key` = 'qc_manager_review';
