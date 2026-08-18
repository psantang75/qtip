-- ─────────────────────────────────────────────────────────────────────────────
-- Insights access — remove erroneously hand-added CSR grants on Sales pages
--
-- The "Agent Activity - Sales" pages were seeded for Admin (role 1) + Manager
-- (role 5) only. At some point a CSR (role 3) can_access grant was hand-added
-- through the admin screen to five of them (aa_sales_call / aa_sales_leads /
-- aa_sales_margin / aa_sales_tickets / aa_sales_email). Because that grant was
-- global (no department scoping), EVERY CSR org-wide — Tech Support, VIP
-- Support, etc. — could see the Sales pages. That is the reported leak.
--
-- This reverts that bad data: it deletes the CSR (role_id = 3) role-access rows
-- from the Sales pages, restoring them to their seeded Admin/Manager intent so
-- CSRs no longer reach them. It intentionally does NOT hardcode any department
-- gate — under the access funnel, per-page department gating for these (and
-- every other Insights page) is managed by admins in the Insights Pages settings
-- screen, "in the pages, not in the code."
--
-- Data correction only — NO schema change (honors the additive-migrations rule).
-- Idempotent: the workload / productivity-report Sales pages never carried a CSR
-- row, and a re-run simply deletes nothing.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE ra
FROM `ie_page_role_access` ra
JOIN `ie_page` p ON p.`id` = ra.`page_id`
WHERE ra.`role_id` = 3
  AND p.`page_key` IN (
    'aa_sales_call',
    'aa_sales_leads',
    'aa_sales_margin',
    'aa_sales_tickets',
    'aa_sales_email',
    'aa_sales_workload',
    'aa_sales_productivity_report'
  );
