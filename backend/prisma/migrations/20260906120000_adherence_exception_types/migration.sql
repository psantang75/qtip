-- Adherence Exceptions — rebuilt to mirror Attendance Exceptions.
--
-- Replaces the earlier per-segment second-allowance model with a type-driven one:
--   * adherence_exception_type — the catalog of reasons (excused / unexcused),
--     the twin of schedule_exception_type. is_excused alone decides scoring.
--   * adherence_exception — now references a type instead of begin/end seconds.
--   * app_page — a dedicated "Adherence Exceptions" page, alongside the
--     "Attendance Exceptions" page, gated by its own sched_adherence_exceptions key.
--
-- Conventions match 20260731170000_add_scheduling: utf8mb4 / utf8mb4_unicode_ci,
-- CREATE TABLE IF NOT EXISTS, INSERT IGNORE, uq_* / idx_* / fk_* names.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Exception-type catalog (mirror schedule_exception_type, minus the
--    attendance-window-only fields: duration_mode / affects_* / paychex).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `adherence_exception_type` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `type_key`    VARCHAR(50)  NOT NULL,
  `label`       VARCHAR(100) NOT NULL,
  `category`    VARCHAR(100) NULL,
  `description` VARCHAR(255) NULL,
  `is_excused`  BOOLEAN      NOT NULL DEFAULT FALSE,
  `is_system`   BOOLEAN      NOT NULL DEFAULT FALSE,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `is_active`   BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at`  DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adherence_exception_type_key` (`type_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `adherence_exception_type`
  (`type_key`, `label`, `is_excused`, `is_system`, `sort_order`) VALUES
  ('approved_variance', 'Approved Variance',   TRUE,  TRUE, 10),
  ('system_issue',      'System / Tool Issue', TRUE,  TRUE, 20),
  ('coaching_only',     'Coaching Only',        FALSE, TRUE, 30),
  ('unapproved',        'Unapproved',           FALSE, TRUE, 40);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rework adherence_exception: drop the second-allowance columns, reference a
--    type instead. The prior model was dev-only and never used in prod, so the
--    throwaway allowance rows are cleared to satisfy the NOT NULL type FK.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM `adherence_exception`;

ALTER TABLE `adherence_exception`
  DROP COLUMN `begin_extra_sec`,
  DROP COLUMN `end_extra_sec`,
  ADD COLUMN `exception_type_id` INT NOT NULL AFTER `seq`,
  ADD INDEX `idx_adherence_exception_type` (`exception_type_id`),
  ADD CONSTRAINT `fk_adherence_exception_type`
    FOREIGN KEY (`exception_type_id`) REFERENCES `adherence_exception_type` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dedicated "Adherence Exceptions" page, directly below "Attendance
--    Exceptions" (sort_order 25; Attendance is 20). Same role access:
--    Admin EDIT, Manager EDIT, Director ALL.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page`
  (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`, `supports_self`, `self_route_path`, `self_label`, `self_icon`) VALUES
  ('sched_adherence_exceptions', 'Adherence Exceptions', 'scheduling', '/app/scheduling/adherence-exceptions', 'Timer', 25, FALSE, NULL, NULL, NULL);

INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 1, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_adherence_exceptions' UNION ALL
SELECT id, 5, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_adherence_exceptions' UNION ALL
SELECT id, 6, TRUE,  FALSE, 'ALL'  FROM `app_page` WHERE `page_key`='sched_adherence_exceptions';
