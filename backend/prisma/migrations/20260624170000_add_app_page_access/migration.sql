-- ─────────────────────────────────────────────────────────────────────────────
-- App Page Access — DB-driven role permissions for the app shell.
--
-- Companion to `ie_page` / `ie_page_role_access` (which gates Insights). This
-- table set gates the rest of the app: Training and Performance Warnings in
-- Phase 1, with Quality migrating later. The mental model is identical:
--   - Page catalog (`app_page`) is static and code-driven — rows are added by
--     migration, not by admins from the UI.
--   - Access matrix (`app_page_role_access`) is admin-toggleable via the
--     "Pages & Access" admin screen.
--
-- INVARIANT: This table does NOT control data scoping. CSR data isolation is
-- enforced at the service layer (see `assertCsrSelfScope` and per-entity
-- read paths). Even if a row here grants CSR `can_access=TRUE`, the data
-- queries still self-scope CSR viewers to their own rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Page catalog
CREATE TABLE IF NOT EXISTS `app_page` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `page_key`   VARCHAR(50)  NOT NULL,
  `page_name`  VARCHAR(100) NOT NULL,
  `section`    VARCHAR(50)  NOT NULL,           -- 'quality' | 'training' | 'performancewarnings'
  `route_path` VARCHAR(200) NOT NULL,
  `icon`       VARCHAR(50)  NULL,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `is_active`  BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_page_key` (`page_key`),
  INDEX `idx_app_page_section` (`section`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Per-role access matrix
CREATE TABLE IF NOT EXISTS `app_page_role_access` (
  `id`         INT     NOT NULL AUTO_INCREMENT,
  `page_id`    INT     NOT NULL,
  `role_id`    INT     NOT NULL,
  `can_access` BOOLEAN NOT NULL DEFAULT FALSE,
  `can_write`  BOOLEAN NOT NULL DEFAULT FALSE,  -- create / edit / delete on this page's data
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_page_role` (`page_id`, `role_id`),
  CONSTRAINT `fk_app_page_role_page` FOREIGN KEY (`page_id`) REFERENCES `app_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_app_page_role_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: page catalog
-- Page keys are referenced from code (frontend nav + backend middleware). Do
-- not rename without a follow-up migration that updates the keys here too.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page` (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`) VALUES
  ('training_coaching',          'Training Sessions',  'training',             '/app/training/coaching',          'MessageSquare', 10),
  ('training_my_coaching',       'My Training',        'training',             '/app/training/my-coaching',       'BookOpen',      20),
  ('training_library_topics',    'Training Topics',    'training',             '/app/training/library/topics',    'Tag',           30),
  ('training_library_quizzes',   'Quizzes',            'training',             '/app/training/library/quizzes',   'HelpCircle',    40),
  ('training_library_resources', 'Resources',          'training',             '/app/training/library/resources', 'BookMarked',    50),
  ('training_reports',           'Training Reports',   'training',             '/app/training/reports',           'BarChart3',     60),
  ('pw_list',                    'Performance Warnings','performancewarnings', '/app/performancewarnings',        'AlertTriangle', 10),
  ('pw_my',                      'My Performance Warnings','performancewarnings','/app/performancewarnings/my',   'FileText',      20);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: role grants — derived from `AdminRolesPage.tsx` ROLE_META
-- Role ids: 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager, 6=Director
-- INVARIANT: no CSR (role_id=3) row may have can_write=TRUE. Even self-scoped
-- writes go through hardcoded ownership checks in services (e.g. signWriteUp).
-- ─────────────────────────────────────────────────────────────────────────────

-- Training Sessions (coaching) — Admin/Trainer/Manager R/W; QA + CSR + Director NONE
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_coaching' UNION ALL
SELECT id, 4, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_coaching' UNION ALL
SELECT id, 5, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_coaching';

-- My Training — CSR only (read-only self-scope)
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 3, TRUE, FALSE FROM `app_page` WHERE `page_key`='training_my_coaching';

-- Training Library (Topics/Quizzes/Resources) — Admin + Trainer R/W
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_topics' UNION ALL
SELECT id, 4, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_topics' UNION ALL
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_quizzes' UNION ALL
SELECT id, 4, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_quizzes' UNION ALL
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_resources' UNION ALL
SELECT id, 4, TRUE, TRUE  FROM `app_page` WHERE `page_key`='training_library_resources';

-- Training Reports — Admin/Trainer/Manager read-only
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, FALSE FROM `app_page` WHERE `page_key`='training_reports' UNION ALL
SELECT id, 4, TRUE, FALSE FROM `app_page` WHERE `page_key`='training_reports' UNION ALL
SELECT id, 5, TRUE, FALSE FROM `app_page` WHERE `page_key`='training_reports';

-- Performance Warnings (editor view) — Admin + Manager R/W; QA EXCLUDED.
-- QA is intentionally NOT seeded here: performance warnings are an HR/management
-- responsibility, not part of the QA scope (matches `AdminRolesPage.tsx`).
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 1, TRUE, TRUE  FROM `app_page` WHERE `page_key`='pw_list' UNION ALL
SELECT id, 5, TRUE, TRUE  FROM `app_page` WHERE `page_key`='pw_list';

-- My Performance Warnings — CSR only (read-only)
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`)
SELECT id, 3, TRUE, FALSE FROM `app_page` WHERE `page_key`='pw_my';
