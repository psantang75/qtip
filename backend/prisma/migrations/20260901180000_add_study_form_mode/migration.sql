-- ─────────────────────────────────────────────────────────────────────────────
-- Study form mode + Internal Research Insights section.
--
-- Additive only: three nullable columns and Insights registry-row seeds. No
-- table is created, no existing column/data is altered.
--
--   * forms.access_mode   — NULL = normal form (Active/Inactive via is_active);
--                           'STUDY' = hidden-capture form (internal research).
--   * forms.access_roles  — JSON array of role names allowed to audit + view
--                           results while the form is in a non-public mode.
--   * submissions.access_mode — snapshot of the form's access_mode at creation,
--                           so historical visibility is unaffected by later
--                           form status changes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `forms`
  ADD COLUMN `access_mode`  VARCHAR(24) NULL AFTER `is_active`,
  ADD COLUMN `access_roles` JSON        NULL AFTER `access_mode`;

ALTER TABLE `submissions`
  ADD COLUMN `access_mode` VARCHAR(24) NULL AFTER `status`;

CREATE INDEX `idx_forms_access_mode`       ON `forms`       (`access_mode`);
CREATE INDEX `idx_submissions_access_mode` ON `submissions` (`access_mode`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page catalog: the "Internal Research" section. Reuses the QC
-- dashboards (Overview / Quality / Agent Performance) in STUDY scope. Registry
-- rows only — no schema change. Section visibility is further gated at runtime
-- by the per-form audience (a user only sees it when they have >=1 permitted
-- study form), layered on top of these coarse role grants.
--
-- sort_order 30 slots it after Company Reporting. Role ids: 1=Admin, 2=QA,
-- 3=CSR, 4=Trainer, 5=Manager. There is no Director role row.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('ir_overview', 'Overview',
   'High-level KPIs for internal research / study forms.',
   'Internal Research', '/app/insights/ir-overview', 'FlaskConical', 30, TRUE, 'insights'),
  ('ir_quality', 'Quality',
   'Score distribution, form and category breakdowns for study forms.',
   'Internal Research', '/app/insights/ir-quality', 'Target', 31, TRUE, 'insights'),
  ('ir_agents', 'Agent Performance',
   'Per-agent study results captured under research forms.',
   'Internal Research', '/app/insights/ir-agents', 'Users', 32, TRUE, 'insights');

-- Coarse role gate (org-flat). The operative filter is the per-form audience.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` IN ('ir_overview','ir_quality','ir_agents') UNION ALL
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` IN ('ir_overview','ir_quality','ir_agents') UNION ALL
SELECT id, 2, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` IN ('ir_overview','ir_quality','ir_agents') UNION ALL
SELECT id, 4, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` IN ('ir_overview','ir_quality','ir_agents');
