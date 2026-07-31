-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduling — Operations/CSR shift scheduling engine.
--
-- Nine domain tables plus app_page + app_page_role_access seeds. This is the
-- system of record behind services/attendance/scheduleProvider.ts. It stores
-- the PLAN (who is scheduled, with which breaks/lunches, and any manager-entered
-- exceptions); it scores nothing. All points/bands/thresholds/KPIs live in the
-- Operations Attendance metric, which READS this data through the provider.
--
-- Conventions match 20260624170000_add_app_page_access:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   uq_* unique keys, idx_* indexes, fk_* constraints with explicit ON DELETE.
--
-- The business week runs SUNDAY (day_of_week = 0) to Saturday.
--
-- Author columns (created_by / updated_by / entered_by) intentionally carry NO
-- foreign key, matching punch_raw's shape — users are deactivated, not deleted,
-- so authorship never dangles in practice and we avoid a dozen named reverse
-- relations on `users`. Only user_id (the employee) and department_id are FK'd.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Activity types — the small admin-managed list behind shift segments.
--    Seeded with Break (paid) and Lunch (unpaid). Later: On Queue, Tickets, etc.
CREATE TABLE IF NOT EXISTS `schedule_activity_type` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `label`              VARCHAR(50)  NOT NULL,
  `is_paid`            BOOLEAN      NOT NULL DEFAULT TRUE,
  `counts_as_coverage` BOOLEAN      NOT NULL DEFAULT FALSE,
  `color`              VARCHAR(20)  NULL,
  `sort_order`         INT          NOT NULL DEFAULT 0,
  `is_active`          BOOLEAN      NOT NULL DEFAULT TRUE,
  `is_system`          BOOLEAN      NOT NULL DEFAULT FALSE,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_activity_type_label` (`label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Exception types — paired excused/unexcused list. `is_excused` alone decides
--    scoring; there is no separate counts-toward-points flag.
CREATE TABLE IF NOT EXISTS `schedule_exception_type` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `type_key`           VARCHAR(50)  NOT NULL,
  `label`              VARCHAR(100) NOT NULL,
  `description`        VARCHAR(255) NULL,
  `is_excused`         BOOLEAN      NOT NULL DEFAULT FALSE,
  `duration_mode`      ENUM('FULL_DAY','WINDOW','EITHER') NOT NULL DEFAULT 'WINDOW',
  `affects_arrival`    BOOLEAN      NOT NULL DEFAULT FALSE,
  `affects_departure`  BOOLEAN      NOT NULL DEFAULT FALSE,
  `is_system`          BOOLEAN      NOT NULL DEFAULT FALSE,
  `sort_order`         INT          NOT NULL DEFAULT 0,
  `is_active`          BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_exception_type_key` (`type_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Coverage thresholds — per-department green/yellow minimums for the day-view
--    heat map. Departments with no row fall back to a share of headcount.
CREATE TABLE IF NOT EXISTS `schedule_coverage_threshold` (
  `id`            INT      NOT NULL AUTO_INCREMENT,
  `department_id` INT      NOT NULL,
  `green_min`     INT      NOT NULL DEFAULT 1,
  `yellow_min`    INT      NOT NULL DEFAULT 1,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_coverage_threshold_department` (`department_id`),
  CONSTRAINT `fk_schedule_coverage_threshold_department`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Templates — a named reusable week. Global, NOT department-scoped.
CREATE TABLE IF NOT EXISTS `schedule_template` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `template_name` VARCHAR(100) NOT NULL,
  `description`   VARCHAR(255) NULL,
  `is_active`     BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_by`    INT          NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_template_name` (`template_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Template days — one row per day-of-week the template covers.
CREATE TABLE IF NOT EXISTS `schedule_template_day` (
  `id`          INT     NOT NULL AUTO_INCREMENT,
  `template_id` INT     NOT NULL,
  `day_of_week` TINYINT NOT NULL,               -- 0 = Sunday … 6 = Saturday
  `is_day_off`  BOOLEAN NOT NULL DEFAULT FALSE,
  `start_time`  TIME    NULL,
  `end_time`    TIME    NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_template_day` (`template_id`, `day_of_week`),
  CONSTRAINT `fk_schedule_template_day_template`
    FOREIGN KEY (`template_id`) REFERENCES `schedule_template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Template day segments — breaks/lunches inside a template day.
CREATE TABLE IF NOT EXISTS `schedule_template_day_segment` (
  `id`               INT     NOT NULL AUTO_INCREMENT,
  `template_day_id`  INT     NOT NULL,
  `activity_type_id` INT     NOT NULL,
  `start_time`       TIME    NOT NULL,
  `end_time`         TIME    NOT NULL,
  `sort_order`       INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_schedule_template_day_segment_day` (`template_day_id`),
  CONSTRAINT `fk_schedule_tpl_day_segment_day`
    FOREIGN KEY (`template_day_id`) REFERENCES `schedule_template_day`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_schedule_tpl_day_segment_activity`
    FOREIGN KEY (`activity_type_id`) REFERENCES `schedule_activity_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Shifts — the materialised plan, one row per person per day. Full DATETIMEs
--    so values compare directly to punch_raw.punch_in_at.
CREATE TABLE IF NOT EXISTS `schedule_shift` (
  `id`          INT      NOT NULL AUTO_INCREMENT,
  `user_id`     INT      NOT NULL,
  `shift_date`  DATE     NOT NULL,
  `start_at`    DATETIME NULL,
  `end_at`      DATETIME NULL,
  `is_day_off`  BOOLEAN  NOT NULL DEFAULT FALSE,
  `source`      ENUM('TEMPLATE','COPIED','MANUAL','ROLLED') NOT NULL DEFAULT 'MANUAL',
  `template_id` INT      NULL,
  `notes`       VARCHAR(500) NULL,
  `status`      ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `locked_at`   DATETIME NULL,
  `created_by`  INT      NULL,
  `updated_by`  INT      NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schedule_shift_user_date` (`user_id`, `shift_date`),
  INDEX `idx_schedule_shift_date` (`shift_date`),
  INDEX `idx_schedule_shift_user_date` (`user_id`, `shift_date`),
  INDEX `idx_schedule_shift_status_date` (`status`, `shift_date`),
  CONSTRAINT `fk_schedule_shift_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_schedule_shift_template`
    FOREIGN KEY (`template_id`) REFERENCES `schedule_template`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Shift segments — breaks/lunches inside a real shift. Sparse, not tiling.
CREATE TABLE IF NOT EXISTS `schedule_shift_segment` (
  `id`               INT      NOT NULL AUTO_INCREMENT,
  `shift_id`         INT      NOT NULL,
  `activity_type_id` INT      NOT NULL,
  `start_at`         DATETIME NOT NULL,
  `end_at`           DATETIME NOT NULL,
  `sort_order`       INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_schedule_shift_segment_shift` (`shift_id`),
  CONSTRAINT `fk_schedule_shift_segment_shift`
    FOREIGN KEY (`shift_id`) REFERENCES `schedule_shift`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_schedule_shift_segment_activity`
    FOREIGN KEY (`activity_type_id`) REFERENCES `schedule_activity_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Exceptions — manager-entered adjustments carrying an excused time window.
--    Anchored to exception_date so it survives a shift re-apply (shift_id SET NULL).
CREATE TABLE IF NOT EXISTS `schedule_exception` (
  `id`                INT      NOT NULL AUTO_INCREMENT,
  `user_id`           INT      NOT NULL,
  `exception_date`    DATE     NOT NULL,
  `exception_type_id` INT      NOT NULL,
  `shift_id`          INT      NULL,
  `is_full_day`       BOOLEAN  NOT NULL DEFAULT FALSE,
  `starts_at`         DATETIME NULL,
  `ends_at`           DATETIME NULL,
  `notes`             VARCHAR(500) NULL,
  `paychex_reference` VARCHAR(100) NULL,
  `entered_by`        INT      NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_schedule_exception_user_date` (`user_id`, `exception_date`),
  INDEX `idx_schedule_exception_date` (`exception_date`),
  CONSTRAINT `fk_schedule_exception_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_schedule_exception_type`
    FOREIGN KEY (`exception_type_id`) REFERENCES `schedule_exception_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_schedule_exception_shift`
    FOREIGN KEY (`shift_id`) REFERENCES `schedule_shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: activity types (v1 = Break paid, Lunch unpaid). is_system blocks delete.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `schedule_activity_type`
  (`label`, `is_paid`, `counts_as_coverage`, `color`, `sort_order`, `is_active`, `is_system`) VALUES
  ('Break', TRUE,  FALSE, '#94a3b8', 10, TRUE, TRUE),
  ('Lunch', FALSE, FALSE, '#64748b', 20, TRUE, TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: exception types. is_excused alone decides scoring.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `schedule_exception_type`
  (`type_key`, `label`, `is_excused`, `duration_mode`, `affects_arrival`, `affects_departure`, `is_system`, `sort_order`) VALUES
  ('excused_absence',      'Excused Absence',         TRUE,  'FULL_DAY', FALSE, FALSE, TRUE, 10),
  ('unexcused_absence',    'Unexcused Absence',       FALSE, 'FULL_DAY', FALSE, FALSE, TRUE, 20),
  ('no_call_no_show',      'No Call / No Show',       FALSE, 'FULL_DAY', FALSE, FALSE, TRUE, 30),
  ('excused_late',         'Excused Late Arrival',    TRUE,  'WINDOW',   TRUE,  FALSE, TRUE, 40),
  ('unexcused_late',       'Unexcused Late Arrival',  FALSE, 'WINDOW',   TRUE,  FALSE, TRUE, 50),
  ('excused_early_leave',  'Excused Early Leave',     TRUE,  'WINDOW',   FALSE, TRUE,  TRUE, 60),
  ('unexcused_early_leave','Unexcused Early Leave',   FALSE, 'WINDOW',   FALSE, TRUE,  TRUE, 70),
  ('excused_partial',      'Excused Partial Day',     TRUE,  'WINDOW',   FALSE, FALSE, TRUE, 80),
  ('extended_break',       'Extended Lunch / Break',  FALSE, 'WINDOW',   FALSE, FALSE, TRUE, 90),
  ('scheduled_pto',        'Scheduled PTO',           TRUE,  'EITHER',   FALSE, FALSE, TRUE, 100),
  ('unscheduled_pto',      'Unscheduled PTO / Call-Out', FALSE, 'EITHER', FALSE, FALSE, TRUE, 110),
  ('bereavement',          'Bereavement',             TRUE,  'EITHER',   FALSE, FALSE, TRUE, 120),
  ('jury_duty',            'Jury Duty',               TRUE,  'EITHER',   FALSE, FALSE, TRUE, 130),
  ('fmla_loa',             'FMLA / LOA',              TRUE,  'FULL_DAY', FALSE, FALSE, TRUE, 140),
  ('holiday',              'Holiday',                 TRUE,  'FULL_DAY', FALSE, FALSE, TRUE, 150),
  ('company_closure',      'Company Closure',         TRUE,  'EITHER',   FALSE, FALSE, TRUE, 160),
  ('sent_home_company',    'Sent Home - Company',     TRUE,  'WINDOW',   FALSE, TRUE,  TRUE, 170),
  ('missed_punch',         'Missed Punch',            TRUE,  'EITHER',   FALSE, FALSE, TRUE, 180);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: app_page catalog. section = 'scheduling', after Performance Warnings.
-- Templates are managed in a dialog on the calendar page — NO sched_templates
-- page; template edit rights ride on sched_calendar EDIT.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page`
  (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`, `supports_self`, `self_route_path`, `self_label`, `self_icon`) VALUES
  ('sched_calendar',   'Schedule',              'scheduling', '/app/scheduling/calendar',   'CalendarDays', 10, TRUE,  '/app/scheduling/my-schedule', 'My Schedule', 'CalendarClock'),
  ('sched_exceptions', 'Attendance Exceptions', 'scheduling', '/app/scheduling/exceptions', 'CalendarX',    20, FALSE, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: role grants. Role ids 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager, 6=Director.
-- access_level is the source of truth; can_access/can_write kept in sync.
-- QA and Trainer are excluded (mirrors pw_list).
--   sched_calendar:   Admin EDIT, Manager EDIT, Director ALL, CSR OWN
--   sched_exceptions: Admin EDIT, Manager EDIT, Director ALL
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 1, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_calendar' UNION ALL
SELECT id, 5, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_calendar' UNION ALL
SELECT id, 6, TRUE,  FALSE, 'ALL'  FROM `app_page` WHERE `page_key`='sched_calendar' UNION ALL
SELECT id, 3, TRUE,  FALSE, 'OWN'  FROM `app_page` WHERE `page_key`='sched_calendar';

INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 1, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_exceptions' UNION ALL
SELECT id, 5, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_exceptions' UNION ALL
SELECT id, 6, TRUE,  FALSE, 'ALL'  FROM `app_page` WHERE `page_key`='sched_exceptions';
