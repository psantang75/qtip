-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: Service Counts under a NEW 'Company Reporting' section.
--
-- Registry rows only — no schema change. This mirrors the csr_call seed
-- (20260820130000_seed_csr_call_page): the report's sidebar group comes from
-- ie_page.category, and visibility/access comes entirely from
-- ie_page_role_access (the same DB-driven model the rest of Insights uses —
-- On Demand Reports' legacy static-role gate is intentionally NOT copied).
--
-- Access = Admin (role 1) ONLY. Because a sidebar group only renders when the
-- user can reach >=1 page under it, granting no other role turns the entire
-- 'Company Reporting' section off for everyone but admins, and the backend
-- RequireInsightsAccess gate blocks direct-URL hits for non-admins too.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('company_service_counts', 'Service Counts',
   'Subscription service counts, churn, growth and mix by provider line.',
   'Company Reporting', '/app/insights/company-service-counts', 'Radio', 1, TRUE, 'insights');

-- Admin-only grant. 1=Admin. No other role rows => hidden + blocked for everyone else.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key`='company_service_counts';
