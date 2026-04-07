-- Drop legacy enrollment system tables (no longer used in the UI)
-- Order matters: drop child tables before parent tables due to FK constraints

DROP TABLE IF EXISTS `certificates`;
DROP TABLE IF EXISTS `enrollments`;
DROP TABLE IF EXISTS `training_path_courses`;
DROP TABLE IF EXISTS `training_paths`;
DROP TABLE IF EXISTS `course_pages`;
DROP TABLE IF EXISTS `training_logs`;
