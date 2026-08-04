-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: Tickets & Tasks for the 'Agent Activity - CSR' section.
--
-- Registry rows only — no schema change. The report reuses the existing
-- ie_fact_ticket_task fact and the ticket_open/task_open ingestion, reading the
-- complement of the Sales Department - All subtree so it covers the CSR-area
-- agents (Customer Service, Tech Support, VIP Support, Installs, etc.).
--
-- sort_order 2 places it under Attendance (1) in the CSR group.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('csr_tickets', 'Tickets & Tasks',
   'Open tickets and tasks by agent and classification, bucketed Current / Due Today / Past Due.',
   'Agent Activity - CSR', '/app/insights/csr-tickets', 'Ticket', 2, TRUE, 'insights');

-- Role grants mirror csr_attendance so the CSR section reads consistently.
-- 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager. There is no Director role row, so
-- no Director grant is attempted.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_tickets' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_tickets' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_tickets' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_tickets' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_tickets';
