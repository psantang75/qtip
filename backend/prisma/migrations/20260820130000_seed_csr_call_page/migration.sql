-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: Call Activity for the 'Agent Activity - CSR' section.
--
-- Registry rows only — no schema change. The report reuses the existing
-- ie_fact_call_activity fact and the call_activity ingestion (which already loads
-- both Sales and Billing/CS agents), reading the complement of the Sales
-- Department - All subtree so it covers the CSR-area agents.
--
-- sort_order 5 slots it after Productivity (4) in the CSR group; the sidebar
-- itself orders by navConfig, where Call Activity leads the CSR group.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('csr_call', 'Call Activity',
   'Inbound and outbound call volume and talk time by agent.',
   'Agent Activity - CSR', '/app/insights/csr-call', 'Phone', 5, TRUE, 'insights');

-- Role grants mirror csr_attendance / csr_tickets so the CSR section reads
-- consistently. 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager. There is no Director
-- role row, so no Director grant is attempted.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_call' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_call' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call';
