-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: give the "Productivity" report its OWN page keys.
--
-- The `aa_sales_productivity` / `csr_productivity` keys were repurposed by the
-- "Ticket and Task Workload" pages, leaving the Productivity roster (phone +
-- DeskTime utilization by agent) with no key of its own. This registers two new
-- keys so Productivity is gated and surfaced independently of Workload.
--
-- Registry rows only — no schema change. INSERT IGNORE keeps it idempotent
-- (apply now, re-run later via `prisma migrate deploy`).
--
-- sort_order 7 places Sales Productivity under the Workload page (6); sort_order
-- 4 places CSR Productivity under CSR Workload (3).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('aa_sales_productivity_report', 'Productivity',
   'Phone, ticket/task touch volume, and DeskTime utilization by salesperson, drilling into a per-day activity timeline.',
   'Agent Activity - Sales', '/app/insights/aa-productivity', 'Gauge', 7, TRUE, 'insights'),
  ('csr_productivity_report', 'Productivity',
   'Phone, ticket/task touch volume, and DeskTime utilization by agent, drilling into a per-day activity timeline.',
   'Agent Activity - CSR', '/app/insights/csr-productivity', 'Gauge', 4, TRUE, 'insights');

-- Sales grants mirror the Sales Workload page (aa_sales_productivity):
-- Admin(1) + Manager(5) ALL scope; the section is not self-served for salespeople.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key`='aa_sales_productivity_report' UNION ALL
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key`='aa_sales_productivity_report';

-- CSR grants mirror the CSR Workload page (csr_productivity):
-- Admin(1)/Manager(5) ALL, QA(2)/CSR(3)/Trainer(4) SELF.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_productivity_report' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_productivity_report' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity_report' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity_report' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity_report';
