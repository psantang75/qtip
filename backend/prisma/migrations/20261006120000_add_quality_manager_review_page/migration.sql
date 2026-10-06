-- ─────────────────────────────────────────────────────────────────────────────
-- Quality > Manager Review Items — answers to form questions marked
-- Agent Visible = No (form_questions.visible_to_csr = 0), e.g. the coaching
-- section on Sales Interaction QA.
--
-- Registered in `app_page` like every other Quality page so the Quality
-- sidebar, the route guard, and the admin "Page Access" screen all pick it up
-- from one source.
--
-- Access: every role except CSR. Read-only, org-wide report → ALL for
-- Admin (1), QA (2), Trainer (4), Manager (5). CSR (3) gets no row = NONE, and
-- AppPermissionService caps CSR at OWN, which the API's viewAll gate rejects.
--
-- Also removes the short-lived Insights registration (`ie_page`
-- 'qc_manager_review'); its role/department/user rows cascade.
--
-- Additive + idempotent, safe to re-run across dev/test/prod.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM `ie_page` WHERE `page_key` = 'qc_manager_review';

INSERT IGNORE INTO `app_page` (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`) VALUES
  ('quality_manager_review', 'Manager Review Items', 'quality', '/app/quality/manager-review', 'EyeOff', 65);

INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `access_level`, `can_access`, `can_write`)
SELECT id, 1, 'ALL', TRUE, FALSE FROM `app_page` WHERE `page_key` = 'quality_manager_review' UNION ALL
SELECT id, 2, 'ALL', TRUE, FALSE FROM `app_page` WHERE `page_key` = 'quality_manager_review' UNION ALL
SELECT id, 4, 'ALL', TRUE, FALSE FROM `app_page` WHERE `page_key` = 'quality_manager_review' UNION ALL
SELECT id, 5, 'ALL', TRUE, FALSE FROM `app_page` WHERE `page_key` = 'quality_manager_review';
