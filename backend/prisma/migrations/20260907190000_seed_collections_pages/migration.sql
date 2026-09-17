-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: the five Collections (AR campaign performance) pages.
--
-- Registry rows only — no schema change. Mirrors the Service Counts seed
-- (20260825170000_seed_company_reporting_service_counts): the sidebar group comes
-- from ie_page.category, and visibility/access comes entirely from
-- ie_page_role_access — the same DB-driven model the rest of Insights uses. This
-- replaces the Phase-1 hardcoded role gate (authorizeManager / RequireRole) so
-- Collections is now managed from Insights → Page Management like every other
-- page.
--
-- Access = Admin (role 1) + Manager (role 5), data_scope ALL — matching the
-- Phase-1 audience. Admins can grant additional roles/scopes (e.g. Director, or
-- CSR at SELF scope) from Page Management without a code change.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('collections_overview', 'Overview',
   'AR collections performance: dollars recovered (agent vs no-agent), recovery rate, and open declines.',
   'Collections', '/app/insights/collections-overview', 'LayoutDashboard', 1, TRUE, 'insights'),
  ('collections_campaign', 'Campaign & Touch',
   'Marginal recovery by touch and subscription outcomes for each dunning campaign.',
   'Collections', '/app/insights/collections-campaign', 'BarChart2', 2, TRUE, 'insights'),
  ('collections_channels', 'Channel Effectiveness',
   'Effort vs. return across portal (agent / no-agent) and inbound / outbound calls.',
   'Collections', '/app/insights/collections-channels', 'Radio', 3, TRUE, 'insights'),
  ('collections_agents', 'Agent Performance',
   'Collector leaderboard: dollars collected, payments, call effort, and touches.',
   'Collections', '/app/insights/collections-agents', 'Users', 4, TRUE, 'insights'),
  ('collections_contact', 'Contact Frequency',
   'Over-contact guardrail (7-in-7 analog): accounts contacted too often in the window.',
   'Collections', '/app/insights/collections-contact', 'AlertTriangle', 5, TRUE, 'insights');

-- Admin (1) + Manager (5) grants at ALL scope. No other role rows => the whole
-- Collections group is hidden and direct-URL blocked for everyone else.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page`
 WHERE `page_key` IN ('collections_overview','collections_campaign','collections_channels','collections_agents','collections_contact');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'ALL' FROM `ie_page`
 WHERE `page_key` IN ('collections_overview','collections_campaign','collections_channels','collections_agents','collections_contact');
