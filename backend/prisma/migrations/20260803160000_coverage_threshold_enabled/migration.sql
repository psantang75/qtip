-- Coverage thresholds are per-department settings, not a list. Add an on/off
-- flag so a department's coverage heatmap can be turned off entirely (it then
-- won't render even with multiple people scheduled). Existing configured rows
-- default to enabled.
ALTER TABLE `schedule_coverage_threshold` ADD COLUMN `is_enabled` BOOLEAN NOT NULL DEFAULT TRUE AFTER `department_id`;
