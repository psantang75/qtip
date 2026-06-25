-- ─────────────────────────────────────────────────────────────────────────────
-- App Page Access — scope model (None / Own / All / Edit)
--
-- Replaces the two opaque booleans (can_access / can_write) with a single
-- 4-rung access ladder that maps to what a role can actually DO on a page:
--
--   NONE  — no access (hidden in nav, route redirects, API 403s)
--   OWN   — their own records only (the "My X" self-view experience)
--   ALL   — everyone's records, read-only (editor/manager view)
--   EDIT  — everyone's records + create/edit/delete
--
-- Also folds the duplicate "*_my" pages into the OWN rung of their parent so
-- there is ONE page per logical feature. The parent page gains a self route +
-- label so the nav endpoint can render the right link per resolved level.
--
-- Additive: new columns only; old booleans are retained (deprecated) and the
-- redundant "*_my" rows are DEACTIVATED, not deleted.
--
-- INVARIANT: CSR (role_id=3) is capped at OWN here and self-scoped again at
-- the service layer (assertCsrSelfScope). Both layers must agree.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Page metadata for the self ("Own") experience.
ALTER TABLE `app_page`
  ADD COLUMN `supports_self`   BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN `self_route_path` VARCHAR(200) NULL,
  ADD COLUMN `self_label`      VARCHAR(100) NULL;

-- 2. The access ladder.
ALTER TABLE `app_page_role_access`
  ADD COLUMN `access_level` ENUM('NONE','OWN','ALL','EDIT') NOT NULL DEFAULT 'NONE';

-- 3. Mark the pages that have a self-view, and where that view lives.
UPDATE `app_page` SET `supports_self` = TRUE, `self_route_path` = '/app/training/my-coaching',     `self_label` = 'My Training'              WHERE `page_key` = 'training_coaching';
UPDATE `app_page` SET `supports_self` = TRUE, `self_route_path` = '/app/performancewarnings/my',    `self_label` = 'My Performance Warnings'  WHERE `page_key` = 'pw_list';
UPDATE `app_page` SET `supports_self` = TRUE, `self_route_path` = '/app/quality/submissions',       `self_label` = 'My Reviews'               WHERE `page_key` = 'quality_submissions';
UPDATE `app_page` SET `supports_self` = TRUE, `self_route_path` = '/app/quality/disputes',          `self_label` = 'Dispute History'          WHERE `page_key` = 'quality_disputes';

-- 4. Backfill the ladder from the existing booleans.
--    can_write → EDIT, can_access (read only) → ALL, otherwise NONE.
UPDATE `app_page_role_access`
SET `access_level` = CASE
  WHEN `can_write`  = 1 THEN 'EDIT'
  WHEN `can_access` = 1 THEN 'ALL'
  ELSE 'NONE'
END;

-- 5. Fold the redundant "*_my" pages into the OWN rung of their parent.
--    (Their CSR grant becomes OWN on the parent page.)
INSERT INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 3, 1, 0, 'OWN' FROM `app_page` WHERE `page_key` = 'training_coaching'
ON DUPLICATE KEY UPDATE `access_level` = 'OWN', `can_access` = 1, `can_write` = 0;

INSERT INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 3, 1, 0, 'OWN' FROM `app_page` WHERE `page_key` = 'pw_list'
ON DUPLICATE KEY UPDATE `access_level` = 'OWN', `can_access` = 1, `can_write` = 0;

-- 6. CSR cap (defense-in-depth): role 3 may never exceed OWN, and OWN only on
--    pages that actually have a self-view. The backfill above would otherwise
--    have given CSR 'ALL' on Submissions/Disputes (read-only booleans).
UPDATE `app_page_role_access` a
JOIN `app_page` p ON p.id = a.page_id
SET a.`access_level` = CASE
  WHEN p.`supports_self` = TRUE AND a.`access_level` <> 'NONE' THEN 'OWN'
  ELSE 'NONE'
END
WHERE a.`role_id` = 3;

-- 7. Deactivate the now-redundant "*_my" pages (folded into parents above).
UPDATE `app_page` SET `is_active` = FALSE WHERE `page_key` IN ('pw_my', 'training_my_coaching');
