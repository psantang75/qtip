-- Tickets & Tasks daily PRODUCTIVITY roll-up: one row per (day, area, agent)
-- with the workload-flow counts for that calendar day —
--   beginning     = open work items assigned at the START of the day
--                   (reused from ie_ticket_task_daily's 8am inventory:
--                    cur + due_today + past_due);
--   new_assigned  = items whose created_on falls on the day;
--   touched       = distinct items with an audit event on the day;
--   closed        = items whose completed_on / ticket-close transition is the day.
--
-- Sibling of ie_ticket_task_daily and intentionally shaped the same way:
-- deliberately NOT named ie_fact_* / ie_stg_* and NOT partitioned so
-- PartitionManagerWorker (which auto-drops those prefixes past
-- retention_fact_years) never ages it out. Backfilled from the CRM audit trail
-- and captured live by RollupWorker the morning AFTER each day closes; at
-- ~50-100 rows/day it needs no partitioning.
--
-- IF NOT EXISTS / INSERT IGNORE keep this idempotent (apply now, re-run later
-- by `prisma migrate deploy`).
CREATE TABLE IF NOT EXISTS `ie_ticket_task_productivity_daily` (
  `snapshot_date`   DATE                NOT NULL,
  `area`            ENUM('sales','csr') NOT NULL,
  `employee_key`    INT                 NOT NULL,
  `agent_name`      VARCHAR(150)        NULL,
  -- Captured as-of the day so old rows keep the department the agent was in at
  -- the time (the live report joins the CURRENT dimension instead).
  `department_name` VARCHAR(150)        NULL,
  `beginning`       INT NOT NULL DEFAULT 0,
  `new_assigned`    INT NOT NULL DEFAULT 0,
  `touched`         INT NOT NULL DEFAULT 0,
  `closed`          INT NOT NULL DEFAULT 0,
  -- 1 = row reconstructed by the one-time CRM-history backfill script,
  -- 0 = captured live by RollupWorker the morning after the day closed.
  `is_backfilled`   TINYINT(1)          NOT NULL DEFAULT 0,
  `captured_at`     DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_date`, `area`, `employee_key`),
  KEY `idx_ttpd_area_date` (`area`, `snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Page catalog: "Productivity" for the Sales and CSR Agent Activity sections.
-- Registry rows only — no further schema change. Both pages read the new
-- ie_ticket_task_productivity_daily roll-up; the Sales page covers the Sales
-- Department - All subtree, the CSR page its complement.
--
-- sort_order 6 places Sales Productivity under Email Activity (5); sort_order 3
-- places CSR Productivity under Tickets & Tasks (2).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('aa_sales_productivity', 'Productivity',
   'Ticket & task workload and productivity by salesperson: beginning, new assigned, touched, and closed by day.',
   'Agent Activity - Sales', '/app/insights/aa-productivity', 'Activity', 6, TRUE, 'insights'),
  ('csr_productivity', 'Productivity',
   'Ticket & task workload and productivity by agent: beginning, new assigned, touched, and closed by day.',
   'Agent Activity - CSR', '/app/insights/csr-productivity', 'Activity', 3, TRUE, 'insights');

-- Sales grants mirror the Sales section (aa_sales_tickets): Admin(1) + Manager(5)
-- ALL scope; the section is not self-served for salespeople.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key`='aa_sales_productivity' UNION ALL
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key`='aa_sales_productivity';

-- CSR grants mirror csr_tickets: Admin(1)/Manager(5) ALL, QA(2)/CSR(3)/Trainer(4) SELF.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_productivity' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_productivity' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_productivity';
