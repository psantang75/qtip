-- Time-of-day coverage bars. A department's staffing expectation is not flat
-- across the day: nothing is required before open, the full bar applies mid-day,
-- and a lower bar applies after the evening drop. Each row is one time window
-- with its own green/yellow minimums. Minutes outside every window are
-- unmonitored (no warning). A department with no windows falls back to its flat
-- schedule_coverage_threshold, so this is additive and backward compatible.
CREATE TABLE IF NOT EXISTS `schedule_coverage_window` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `department_id` INT NOT NULL,
  `start_time`    TIME NOT NULL,
  `end_time`      TIME NOT NULL,
  `green_min`     INT NOT NULL DEFAULT 1,
  `yellow_min`    INT NOT NULL DEFAULT 1,
  `sort_order`    INT NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_schedule_coverage_window_department` (`department_id`),
  CONSTRAINT `fk_schedule_coverage_window_department`
    FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
