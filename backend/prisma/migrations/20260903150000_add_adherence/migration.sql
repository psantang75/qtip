-- ─────────────────────────────────────────────────────────────────────────────
-- Adherence points — intraday scoring over scheduling + punch + phone data.
--
-- Distinct from Attendance (which scores shift start/end). Adherence scores three
-- things per scheduled break/lunch:
--   1. DURATION  — actual length vs the scheduled segment length.
--   2. START     — actual start vs the scheduled start (either direction).
--   3. PHONE     — the Genesys presence Break/Meal window vs the punch window,
--                  with an admin before/after tolerance. Catches the dodge of
--                  going Break on the phone early to avoid calls.
--
-- Four tables. Two are CONFIG (bands + discipline ladder, admin-managed, both
-- effective-dated) and two are DERIVED (rebuilt by services/adherence/
-- adherence.engine.ts). These are OLTP operational tables like attendance_daily,
-- NOT ie_fact_/ie_stg_ warehouse tables, so they carry no partitioning/registry.
--
-- Conventions match 20260803200000_add_attendance_points:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   uq_* unique keys, idx_* indexes, fk_* constraints with explicit ON DELETE.
--
-- Grace model: for DURATION and START the grace is the gap below the lowest band
-- (edit the lowest band's minimum to change it), exactly like attendance — no
-- separate setting. For PHONE the tolerance is asymmetric (before vs after) so it
-- lives in ie_config and the engine subtracts it before matching the band.
--
-- Report-first switch: occurrences are always recorded, but points only count
-- toward the discipline ladder on/after ie_config `adherence_points_active_from`
-- (default far-future = report-only). Both the rollup and the notifier read that
-- one gate, so nothing fires a warning during the reporting-only phase.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Point bands — configurable per (kind) with inclusive [min_seconds,
--    max_seconds] deviation bounds; max_seconds NULL = unbounded. MISSED kinds
--    ignore both bounds (there is no duration to measure).
CREATE TABLE IF NOT EXISTS `adherence_point_rule` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `rule_key`       VARCHAR(50)   NOT NULL,
  `label`          VARCHAR(100)  NOT NULL,
  `kind`           ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START','BREAK_PHONE','LUNCH_PHONE','BREAK_MISSED','LUNCH_MISSED') NOT NULL,
  `min_seconds`    INT           NOT NULL DEFAULT 0,
  `max_seconds`    INT           NULL,
  `points`         DECIMAL(4,2)  NOT NULL DEFAULT 0.00,
  `effective_from` DATE          NOT NULL,
  `effective_to`   DATE          NULL,
  `sort_order`     INT           NOT NULL DEFAULT 0,
  `is_active`      BOOLEAN       NOT NULL DEFAULT TRUE,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adherence_point_rule_key_effective` (`rule_key`, `effective_from`),
  INDEX `idx_adherence_point_rule_lookup` (`kind`, `is_active`, `effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Discipline ladder — rolling-90 point totals at or above which each rung is
--    recommended. Recommends only; creates no write_up or coaching_session.
CREATE TABLE IF NOT EXISTS `adherence_warning_threshold` (
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
  UNIQUE KEY `uq_adherence_warning_threshold_level_effective` (`level_key`, `effective_from`),
  INDEX `idx_adherence_warning_threshold_lookup` (`is_active`, `effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Daily reconciliation — one row per user per SCHEDULED day that carries a
--    break or lunch. Scheduled vs actual seconds per segment, the phone-vs-punch
--    overhang, and a scannable adherence_pct. No department_id snapshot:
--    department resolves live by joining users.
CREATE TABLE IF NOT EXISTS `adherence_daily` (
  `id`                    INT      NOT NULL AUTO_INCREMENT,
  `user_id`               INT      NOT NULL,
  `work_date`             DATE     NOT NULL,
  `shift_id`              INT      NULL,
  `break_scheduled_sec`   INT      NOT NULL DEFAULT 0,
  `break_actual_sec`      INT      NOT NULL DEFAULT 0,
  `lunch_scheduled_sec`   INT      NOT NULL DEFAULT 0,
  `lunch_actual_sec`      INT      NOT NULL DEFAULT 0,
  `phone_break_extra_sec` INT      NOT NULL DEFAULT 0,
  `phone_lunch_extra_sec` INT      NOT NULL DEFAULT 0,
  `adherence_pct`         DECIMAL(5,2) NULL,
  `computed_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adherence_daily_user_date` (`user_id`, `work_date`),
  INDEX `idx_adherence_daily_date` (`work_date`),
  CONSTRAINT `fk_adherence_daily_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_adherence_daily_shift`
    FOREIGN KEY (`shift_id`) REFERENCES `schedule_shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Point-bearing occurrences — the drill-down detail behind every point.
--    Unique on (user, date, kind, seq): seq distinguishes the first break from
--    the second on a multi-break day. Points summed from here, never
--    denormalised onto adherence_daily.
CREATE TABLE IF NOT EXISTS `adherence_occurrence` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `user_id`           INT          NOT NULL,
  `work_date`         DATE         NOT NULL,
  `seq`              TINYINT       NOT NULL DEFAULT 1,
  `rule_id`           INT          NULL,
  `kind`              ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START','BREAK_PHONE','LUNCH_PHONE','BREAK_MISSED','LUNCH_MISSED') NOT NULL,
  `deviation_seconds` INT          NOT NULL DEFAULT 0,
  `points`            DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  `reason_label`      VARCHAR(100) NOT NULL,
  `computed_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adherence_occurrence_user_date_kind_seq` (`user_id`, `work_date`, `kind`, `seq`),
  INDEX `idx_adherence_occurrence_date` (`work_date`),
  CONSTRAINT `fk_adherence_occurrence_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_adherence_occurrence_rule`
    FOREIGN KEY (`rule_id`) REFERENCES `adherence_point_rule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: point bands, in SECONDS of deviation, effective from 2000-01-01 so all
-- history scores under them. Grace is the gap below the lowest band of each kind.
--
--   Break duration : 3:00–5:59 → 0.25, 6:00–10:59 → 0.50, 11:00+ → 1.00
--                    (grace ~2 min: anything under 3:00 earns nothing)
--   Lunch duration : 4:00–6:59 → 0.25, 7:00–11:59 → 0.50, 12:00+ → 1.00
--                    (grace ~3 min: anything under 4:00 earns nothing)
--   Missed break / lunch (worked the shift, never punched the segment) → 1.00
--   Start-time     : 5:00+ off schedule → 0.00 (occurrence-only per proposal)
--   Phone match    : 1:00–4:59 → 0.25, 5:00–9:59 → 0.50, 10:00+ → 1.00 over the
--                    admin before/after tolerance
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `adherence_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`, `effective_from`, `sort_order`) VALUES
  ('break_dur_minor',    'Break long — minor',    'BREAK_DURATION',  180,   359, 0.25, '2000-01-01', 10),
  ('break_dur_moderate', 'Break long — moderate', 'BREAK_DURATION',  360,   659, 0.50, '2000-01-01', 20),
  ('break_dur_severe',   'Break long — severe',   'BREAK_DURATION',  660,  NULL, 1.00, '2000-01-01', 30),
  ('lunch_dur_minor',    'Lunch long — minor',    'LUNCH_DURATION',  240,   419, 0.25, '2000-01-01', 40),
  ('lunch_dur_moderate', 'Lunch long — moderate', 'LUNCH_DURATION',  420,   719, 0.50, '2000-01-01', 50),
  ('lunch_dur_severe',   'Lunch long — severe',   'LUNCH_DURATION',  720,  NULL, 1.00, '2000-01-01', 60),
  ('break_missed',       'Break missed',          'BREAK_MISSED',      0,  NULL, 1.00, '2000-01-01', 70),
  ('lunch_missed',       'Lunch missed',          'LUNCH_MISSED',      0,  NULL, 1.00, '2000-01-01', 80),
  ('break_start',        'Break wrong start',     'BREAK_START',     300,  NULL, 0.00, '2000-01-01', 90),
  ('lunch_start',        'Lunch wrong start',     'LUNCH_START',     300,  NULL, 0.00, '2000-01-01', 100),
  ('break_phone_minor',    'Break phone off — minor',    'BREAK_PHONE',   1,   299, 0.25, '2000-01-01', 110),
  ('break_phone_moderate', 'Break phone off — moderate', 'BREAK_PHONE', 300,   599, 0.50, '2000-01-01', 120),
  ('break_phone_severe',   'Break phone off — severe',   'BREAK_PHONE', 600,  NULL, 1.00, '2000-01-01', 130),
  ('lunch_phone_minor',    'Lunch phone off — minor',    'LUNCH_PHONE',   1,   299, 0.25, '2000-01-01', 140),
  ('lunch_phone_moderate', 'Lunch phone off — moderate', 'LUNCH_PHONE', 300,   599, 0.50, '2000-01-01', 150),
  ('lunch_phone_severe',   'Lunch phone off — severe',   'LUNCH_PHONE', 600,  NULL, 1.00, '2000-01-01', 160);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: discipline ladder (proposal values). Rolling-90 points at or above each
-- value recommend that rung.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `adherence_warning_threshold`
  (`level_key`, `label`, `points_threshold`, `effective_from`, `sort_order`) VALUES
  ('coaching',    'Coaching',           5.00,  '2000-01-01', 10),
  ('verbal',      'Verbal',            10.00,  '2000-01-01', 20),
  ('written',     'Written',           15.00,  '2000-01-01', 30),
  ('final',       'Final',             20.00,  '2000-01-01', 40),
  ('termination', 'Termination Review', 25.00, '2000-01-01', 50);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: ie_config settings. Same key-value store attendance's points-start uses.
-- INSERT IGNORE so a hand-edited value is never clobbered on re-run.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('adherence_start_date', '2026-06-21', 'Adherence: earliest date scored. Breaks/lunches before this date are never scored or counted even though earlier history exists. Format YYYY-MM-DD.'),
  ('adherence_points_active_from', '2099-01-01', 'Adherence: date points begin counting toward the discipline ladder. Before it, occurrences are reported but carry no points (report-only). Set it to flip the switch. Format YYYY-MM-DD.'),
  ('adherence_phone_grace_before_sec', '120', 'Adherence: seconds the phone may go Break/Meal BEFORE the punch break/lunch starts before it counts. Default 120 (2 min).'),
  ('adherence_phone_grace_after_sec', '60', 'Adherence: seconds the phone may stay Break/Meal AFTER the punch break/lunch ends before it counts. Default 60 (1 min).');

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Insights page catalog. Category 'Agent Activity - CSR', alongside
-- Attendance. Route /app/insights/csr-adherence.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('csr_adherence', 'Adherence',
   'Rolling 90-day break/lunch adherence points: duration and start-time against the published schedule, plus phone-status-vs-punch matching.',
   'Agent Activity - CSR', '/app/insights/csr-adherence', 'Timer', 2, TRUE, 'insights');

-- Role grants. 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager. No Director role row.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_adherence' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_adherence' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_adherence' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_adherence' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_adherence';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: KPI metadata for the scannable adherence %, reusing the ie_kpi /
-- ie_kpi_threshold path so it needs no new admin screen.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_kpi`
  (`kpi_code`, `kpi_name`, `description`, `category`, `formula_type`, `formula`, `source_table`, `format_type`, `decimal_places`, `direction`, `unit_label`, `is_active`, `sort_order`) VALUES
  ('csr_adh_adherence', 'Break/Lunch Adherence',
   'Share of scheduled break and lunch time taken within tolerance. Aligned seconds divided by scheduled seconds across the window.',
   'Adherence', 'SQL', 'SUM(aligned_seconds) / SUM(scheduled_seconds) x 100',
   'adherence_daily', 'PERCENT', 1, 'UP_IS_GOOD', NULL, TRUE, 1),
  ('csr_adh_points', 'Adherence Points',
   'Points accumulated in the rolling 90-day window, summed from adherence_occurrence under the bands in force on each work date (once points are active).',
   'Adherence', 'SQL', 'SUM(points) WHERE work_date > asOf - 90 days',
   'adherence_occurrence', 'NUMBER', 2, 'DOWN_IS_GOOD', 'pts', TRUE, 2);

INSERT IGNORE INTO `ie_kpi_threshold` (`kpi_id`, `department_key`, `goal_value`, `warning_value`, `critical_value`, `effective_from`)
SELECT id, NULL, 95.0000, 90.0000, 85.0000, '2000-01-01' FROM `ie_kpi` WHERE `kpi_code` = 'csr_adh_adherence';

INSERT IGNORE INTO `ie_kpi_threshold` (`kpi_id`, `department_key`, `goal_value`, `warning_value`, `critical_value`, `effective_from`)
SELECT id, NULL, 0.0000, 5.0000, 15.0000, '2000-01-01' FROM `ie_kpi` WHERE `kpi_code` = 'csr_adh_points';
