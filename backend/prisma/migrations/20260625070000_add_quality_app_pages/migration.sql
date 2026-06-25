-- ─────────────────────────────────────────────────────────────────────────────
-- Add the Quality section to the `app_page` catalog so the admin
-- "Pages & Access" screen surfaces every routable page, not just Training +
-- Performance Warnings (Phase 1).
--
-- Grants mirror the current static role arrays in
-- `frontend/src/config/navConfig.ts` and `AdminRolesPage.tsx`:
--   - quality_forms (Form Builder)        → Admin only
--   - quality_review_forms                 → Admin + QA
--   - quality_ai_reviewer                  → Admin + QA
--   - quality_ai_inbox                     → Admin + QA
--   - quality_submissions                  → Admin + QA + Trainer + Manager (R/W on Admin/QA, R on others); CSR self-scoped view
--   - quality_disputes                     → Admin + QA + Manager (R/W); CSR self-scoped read (their own dispute history)
--
-- INVARIANT: CSR can_write is forced to FALSE by AppPermissionService;
-- dispute submission is a separate self-scoped endpoint, not a page write.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT IGNORE INTO `app_page` (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`) VALUES
  ('quality_forms',         'Form Builder',     'quality', '/app/quality/forms',          'ClipboardList',  10),
  ('quality_review_forms',  'Review Forms',     'quality', '/app/quality/review-forms',   'ClipboardCheck', 20),
  ('quality_ai_reviewer',   'AI Reviewer',      'quality', '/app/quality/ai-reviewer',    'Sliders',        30),
  ('quality_ai_inbox',      'AI Inbox',         'quality', '/app/quality/ai-inbox',       'Bot',            40),
  ('quality_submissions',   'Submissions',      'quality', '/app/quality/submissions',    'FileCheck',      50),
  ('quality_disputes',      'Disputes',         'quality', '/app/quality/disputes',       'AlertTriangle',  60);

-- Form Builder — Admin only
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE FROM `app_page` WHERE `page_key`='quality_forms';

-- Review Forms — Admin + QA
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE FROM `app_page` WHERE `page_key`='quality_review_forms' UNION ALL
SELECT id, 2, TRUE, TRUE FROM `app_page` WHERE `page_key`='quality_review_forms';

-- AI Reviewer (config) — Admin + QA
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE FROM `app_page` WHERE `page_key`='quality_ai_reviewer' UNION ALL
SELECT id, 2, TRUE, TRUE FROM `app_page` WHERE `page_key`='quality_ai_reviewer';

-- AI Inbox — Admin + QA
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_ai_inbox' UNION ALL
SELECT id, 2, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_ai_inbox';

-- Submissions — Admin/QA write; Trainer/Manager/CSR read (CSR self-scoped at data layer)
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_submissions' UNION ALL
SELECT id, 2, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_submissions' UNION ALL
SELECT id, 4, TRUE, FALSE FROM `app_page` WHERE `page_key`='quality_submissions' UNION ALL
SELECT id, 5, TRUE, FALSE FROM `app_page` WHERE `page_key`='quality_submissions' UNION ALL
SELECT id, 3, TRUE, FALSE FROM `app_page` WHERE `page_key`='quality_submissions';

-- Disputes — Admin/QA/Manager write; CSR self-scoped read (own dispute history)
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_disputes' UNION ALL
SELECT id, 2, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_disputes' UNION ALL
SELECT id, 5, TRUE, TRUE  FROM `app_page` WHERE `page_key`='quality_disputes' UNION ALL
SELECT id, 3, TRUE, FALSE FROM `app_page` WHERE `page_key`='quality_disputes';
