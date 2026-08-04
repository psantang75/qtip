-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance points — the scoring layer over scheduling + punch data.
--
-- Four tables. Two are CONFIG (bands + discipline ladder, admin-managed, both
-- effective-dated); two are DERIVED (daily reconciliation + point-bearing
-- occurrences, rebuilt by services/attendance/attendance.engine.ts).
--
-- Conventions match 20260731170000_add_scheduling:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   uq_* unique keys, idx_* indexes, fk_* constraints with explicit ON DELETE.
--
-- WHY the config tables are effective-dated: editing a band must not rewrite
-- history. Recompute resolves the rules in force on the WORK DATE, so a past
-- discipline decision stays reproducible and a policy change applies forward
-- only. Mirrors ie_kpi_threshold, which already works this way. Edits insert a
-- new effective-dated row rather than mutating the old one.
--
-- WHY there is no waive/forgive column: forgiveness is an excused
-- schedule_exception, the mechanism that already exists. A second one would
-- guarantee the two drift apart.
--
-- WHY attendance_daily has no department_id snapshot: department resolves live
-- by joining `users`, exactly like every other Insights page, so attendance can
-- never disagree with the QC pages about which department someone is in.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Point bands — the configurable "how late earns how much" table.
--    min_seconds/max_seconds are INCLUSIVE bounds on the deviation.
--    max_seconds NULL = unbounded. kind ABSENT ignores both bounds.
--    kind EXCEPTION binds to a schedule_exception_type: a manager-logged event
--    (No Call / No Show) that punch data cannot detect, because the
--    distinguishing fact is that nobody called.
CREATE TABLE IF NOT EXISTS `attendance_point_rule` (
  `id`                INT           NOT NULL AUTO_INCREMENT,
  `rule_key`          VARCHAR(50)   NOT NULL,
  `label`             VARCHAR(100)  NOT NULL,
  `kind`              ENUM('LATE','EARLY_LEAVE','ABSENT','EXCEPTION') NOT NULL,
  `min_seconds`       INT           NOT NULL DEFAULT 0,
  `max_seconds`       INT           NULL,
  `points`            DECIMAL(4,2)  NOT NULL DEFAULT 0.00,
  `exception_type_id` INT           NULL,
  `effective_from`    DATE          NOT NULL,
  `effective_to`      DATE          NULL,
  `sort_order`        INT           NOT NULL DEFAULT 0,
  `is_active`         BOOLEAN       NOT NULL DEFAULT TRUE,
  `created_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_point_rule_key_effective` (`rule_key`, `effective_from`),
  INDEX `idx_attendance_point_rule_lookup` (`kind`, `is_active`, `effective_from`),
  CONSTRAINT `fk_attendance_point_rule_exception_type`
    FOREIGN KEY (`exception_type_id`) REFERENCES `schedule_exception_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Discipline ladder — points at which each rung is recommended.
--    This page RECOMMENDS a rung; it creates no write_up or coaching_session.
CREATE TABLE IF NOT EXISTS `attendance_warning_threshold` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `level_key`        VARCHAR(50)  NOT NULL,
  `label`            VARCHAR(100) NOT NULL,
  `points_threshold` DECIMAL(4,2) NOT NULL,
  `effective_from`   DATE         NOT NULL,
  `effective_to`     DATE         NULL,
  `sort_order`       INT          NOT NULL DEFAULT 0,
  `is_active`        BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_warning_threshold_level_effective` (`level_key`, `effective_from`),
  INDEX `idx_attendance_warning_threshold_lookup` (`is_active`, `effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Daily reconciliation — one row per user per SCHEDULED day, clean days
--    included. Compliance needs scheduled_minutes for every scheduled day, which
--    the occurrence table alone cannot supply, and discipline has to be
--    defensible months later, which recompute-on-read cannot do.
--
--    late_seconds is stored even when it earns no points. That single decision is
--    what makes grace usage measurable (the person who is 2:59 late every day and
--    never earns a point) without recomputing anything.
CREATE TABLE IF NOT EXISTS `attendance_daily` (
  `id`                   INT      NOT NULL AUTO_INCREMENT,
  `user_id`              INT      NOT NULL,
  `work_date`            DATE     NOT NULL,
  `shift_id`             INT      NULL,
  `scheduled_minutes`    INT      NOT NULL DEFAULT 0,
  `adherent_minutes`     INT      NOT NULL DEFAULT 0,
  `late_seconds`         INT      NOT NULL DEFAULT 0,
  `early_leave_seconds`  INT      NOT NULL DEFAULT 0,
  `is_absent`            BOOLEAN  NOT NULL DEFAULT FALSE,
  `first_punch_at`       DATETIME NULL,
  `last_punch_at`        DATETIME NULL,
  `is_excused`           BOOLEAN  NOT NULL DEFAULT FALSE,
  `excused_exception_id` INT      NULL,
  `computed_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_daily_user_date` (`user_id`, `work_date`),
  INDEX `idx_attendance_daily_date` (`work_date`),
  CONSTRAINT `fk_attendance_daily_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_attendance_daily_shift`
    FOREIGN KEY (`shift_id`) REFERENCES `schedule_shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_attendance_daily_exception`
    FOREIGN KEY (`excused_exception_id`) REFERENCES `schedule_exception`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Point-bearing occurrences — the drill-down detail behind every point.
--    Unique on (user, date, kind): a day carries at most one Late and one
--    Leave Early. Points are NOT denormalised onto attendance_daily; they are
--    summed from here so there is one source of truth.
--
--    Policy, per the attendance plan: absences count PER DAY (consecutive days
--    out are separate occurrences) and a day is NOT capped, so 2:10 late plus
--    leaving 30 minutes early earns 1.5.
CREATE TABLE IF NOT EXISTS `attendance_occurrence` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `user_id`           INT          NOT NULL,
  `work_date`         DATE         NOT NULL,
  `rule_id`           INT          NULL,
  `kind`              ENUM('LATE','EARLY_LEAVE','ABSENT','EXCEPTION') NOT NULL,
  `deviation_seconds` INT          NOT NULL DEFAULT 0,
  `points`            DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  `reason_label`      VARCHAR(100) NOT NULL,
  `computed_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_occurrence_user_date_kind` (`user_id`, `work_date`, `kind`),
  INDEX `idx_attendance_occurrence_date` (`work_date`),
  CONSTRAINT `fk_attendance_occurrence_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_attendance_occurrence_rule`
    FOREIGN KEY (`rule_id`) REFERENCES `attendance_point_rule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: point bands, in SECONDS, effective from 2000-01-01 so every day of
-- existing punch history scores under them.
--
--   Late 3+    3:01 – 15:59      → 0.25
--   Late 16+   16:00 – 1:00:59   → 0.50
--   Late 61+   1:01:00 – 2:00:59 → 0.75
--   Late 121+  2:01:00 – 7:59:00 → 1.00   (beyond this rolls into Absent)
--   Leave Early 3:01 – unbounded → 0.50
--   Absent     full day          → 1.00
--   NCNS       manager-logged    → 2.00   (weighted above a plain absence)
--
-- Grace is therefore 0–3:00 inclusive: it earns nothing but is still recorded
-- in attendance_daily.late_seconds.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `attendance_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`, `exception_type_id`, `effective_from`, `sort_order`) VALUES
  ('late_3',      'Late 3+',      'LATE',        181,   959, 0.25, NULL, '2000-01-01', 10),
  ('late_16',     'Late 16+',     'LATE',        960,  3659, 0.50, NULL, '2000-01-01', 20),
  ('late_61',     'Late 61+',     'LATE',       3660,  7259, 0.75, NULL, '2000-01-01', 30),
  ('late_121',    'Late 121+',    'LATE',       7260, 28740, 1.00, NULL, '2000-01-01', 40),
  ('leave_early', 'Leave Early',  'EARLY_LEAVE', 181,  NULL, 0.50, NULL, '2000-01-01', 50),
  ('absent',      'Absent',       'ABSENT',        0,  NULL, 1.00, NULL, '2000-01-01', 60);

INSERT IGNORE INTO `attendance_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`, `exception_type_id`, `effective_from`, `sort_order`)
SELECT 'ncns', 'No Call / No Show', 'EXCEPTION', 0, NULL, 2.00, `id`, '2000-01-01', 70
  FROM `schedule_exception_type` WHERE `type_key` = 'no_call_no_show';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: discipline ladder. Rolling-90 points at or above each value recommend
-- that rung. Separation is unmodelled elsewhere (write_ups.document_type has no
-- SEPARATION value), so this page highlights it and creates nothing.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `attendance_warning_threshold`
  (`level_key`, `label`, `points_threshold`, `effective_from`, `sort_order`) VALUES
  ('coaching',   'Coaching',   3.00, '2000-01-01', 10),
  ('verbal',     'Verbal',     5.00, '2000-01-01', 20),
  ('written',    'Written',    7.00, '2000-01-01', 30),
  ('final',      'Final',      9.00, '2000-01-01', 40),
  ('separation', 'Separation', 10.00, '2000-01-01', 50);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Insights page catalog. Category 'Agent Activity - CSR' for symmetry
-- with the existing 'Agent Activity - Sales'.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('csr_attendance', 'Attendance',
   'Rolling 90-day attendance points and schedule compliance, generated by matching clock punches against the published schedule.',
   'Agent Activity - CSR', '/app/insights/csr-attendance', 'CalendarCheck', 1, TRUE, 'insights');

-- Role grants. 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager. There is no Director
-- role row, so no Director grant is attempted.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_attendance' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_attendance' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_attendance' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_attendance' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_attendance';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: KPI metadata. Compliance is the only thresholded KPI — points bands are
-- a policy, not a KPI, and live in attendance_point_rule.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_kpi`
  (`kpi_code`, `kpi_name`, `description`, `category`, `formula_type`, `formula`, `source_table`, `format_type`, `decimal_places`, `direction`, `unit_label`, `is_active`, `sort_order`) VALUES
  ('csr_att_compliance', 'Schedule Compliance',
   'Share of scheduled time actually worked. Adherent minutes divided by scheduled minutes. Full-day excused days are removed from both sides.',
   'Attendance', 'SQL', 'SUM(adherent_minutes) / SUM(scheduled_minutes) x 100',
   'attendance_daily', 'PERCENT', 1, 'UP_IS_GOOD', NULL, TRUE, 1),
  ('csr_att_points', 'Attendance Points',
   'Points accumulated in the rolling 90-day window, summed from attendance_occurrence under the bands in force on each work date.',
   'Attendance', 'SQL', 'SUM(points) WHERE work_date > asOf - 90 days',
   'attendance_occurrence', 'NUMBER', 2, 'DOWN_IS_GOOD', 'pts', TRUE, 2);

INSERT IGNORE INTO `ie_kpi_threshold` (`kpi_id`, `department_key`, `goal_value`, `warning_value`, `critical_value`, `effective_from`)
SELECT id, NULL, 95.0000, 90.0000, 85.0000, '2000-01-01' FROM `ie_kpi` WHERE `kpi_code` = 'csr_att_compliance';

INSERT IGNORE INTO `ie_kpi_threshold` (`kpi_id`, `department_key`, `goal_value`, `warning_value`, `critical_value`, `effective_from`)
SELECT id, NULL, 0.0000, 3.0000, 7.0000, '2000-01-01' FROM `ie_kpi` WHERE `kpi_code` = 'csr_att_points';
