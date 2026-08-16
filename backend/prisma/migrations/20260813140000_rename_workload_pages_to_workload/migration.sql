-- ─────────────────────────────────────────────────────────────────────────────
-- Rename the "Ticket and Task Workload" page registration from its legacy
-- `*_productivity` keys/name to `*_workload`.
--
-- These pages were originally seeded as "Productivity" (keys aa_sales_productivity
-- / csr_productivity) but the feature is the Ticket & Task Workload report — the
-- separate Productivity roster now owns the *_productivity_report keys. Aligning
-- the registration to "Workload" so the admin Insights Pages / access screen is
-- unambiguous to manage.
--
-- Registry data only — no schema change. page_id is preserved, so existing
-- ie_page_role_access / ie_page_department_access / ie_page_user_override grants
-- follow the rename automatically. Idempotent: the WHERE clause matches only the
-- legacy key, so a re-run after the rename is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE `ie_page`
SET `page_key`   = 'aa_sales_workload',
    `page_name`  = 'Ticket and Task Workload',
    `route_path` = '/app/insights/aa-workload'
WHERE `page_key` = 'aa_sales_productivity';

UPDATE `ie_page`
SET `page_key`   = 'csr_workload',
    `page_name`  = 'Ticket and Task Workload',
    `route_path` = '/app/insights/csr-workload'
WHERE `page_key` = 'csr_productivity';
