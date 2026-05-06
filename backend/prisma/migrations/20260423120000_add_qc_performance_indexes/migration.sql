-- QC Performance Optimization: Pillar 1
--
-- Adds composite indexes on the hot-path tables driving the QC dashboards
-- (agent list, agent profile, quality, coaching, warnings). These are pure
-- read-perf additions: no table or column changes, no data changes.
--
-- Each index targets a query pattern observed in QCKpiService /
-- QCAnalyticsService / QCQualityData. Indexes that are already created
-- automatically by MySQL for foreign-key columns or that already exist via
-- @@index in schema.prisma are intentionally omitted.
--
-- Idempotent via the SET @sql / PREPARE / EXECUTE pattern: each index check
-- is a single statement Prisma can ship without DELIMITER (which Prisma's
-- migration engine doesn't speak). 'SELECT 1' is the no-op branch when the
-- index already exists.

-- submissions: dominant filter is `WHERE status = 'FINALIZED' AND submitted_at BETWEEN ? AND ?`.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'submissions' AND index_name = 'idx_submissions_status_date') = 0, 'CREATE INDEX `idx_submissions_status_date` ON `submissions` (`status`, `submitted_at`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'submissions' AND index_name = 'idx_submissions_form_status_date') = 0, 'CREATE INDEX `idx_submissions_form_status_date` ON `submissions` (`form_id`, `status`, `submitted_at`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- submission_metadata: the CSR join shape is `JOIN submission_metadata sm ON sm.submission_id = s.id WHERE sm.field_id = ?`.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'submission_metadata' AND index_name = 'idx_subm_meta_subid_field') = 0, 'CREATE INDEX `idx_subm_meta_subid_field` ON `submission_metadata` (`submission_id`, `field_id`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- coaching_sessions: aggregates by date+status and per-agent timelines.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'coaching_sessions' AND index_name = 'idx_coaching_date_status') = 0, 'CREATE INDEX `idx_coaching_date_status` ON `coaching_sessions` (`session_date`, `status`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'coaching_sessions' AND index_name = 'idx_coaching_csr_date') = 0, 'CREATE INDEX `idx_coaching_csr_date` ON `coaching_sessions` (`csr_id`, `session_date`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- quiz_attempts: aggregates by submitted_at and per-user timelines.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'quiz_attempts' AND index_name = 'idx_quiz_attempts_date_user') = 0, 'CREATE INDEX `idx_quiz_attempts_date_user` ON `quiz_attempts` (`submitted_at`, `user_id`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'quiz_attempts' AND index_name = 'idx_quiz_attempts_user_date') = 0, 'CREATE INDEX `idx_quiz_attempts_user_date` ON `quiz_attempts` (`user_id`, `submitted_at`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- disputes: dispute aggregates filter by created_at and group/filter by status.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'disputes' AND index_name = 'idx_disputes_created_status') = 0, 'CREATE INDEX `idx_disputes_created_status` ON `disputes` (`created_at`, `status`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- write_ups: per-agent date-range queries and the repeat-offender lookback subquery.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'write_ups' AND index_name = 'idx_write_ups_csr_date') = 0, 'CREATE INDEX `idx_write_ups_csr_date` ON `write_ups` (`csr_id`, `created_at`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'write_ups' AND index_name = 'idx_write_ups_date_csr') = 0, 'CREATE INDEX `idx_write_ups_date_csr` ON `write_ups` (`created_at`, `csr_id`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- users: the active-CSR cohort filter `WHERE role_id = 3 AND is_active = 1` plus dept filtering.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_role_active_dept') = 0, 'CREATE INDEX `idx_users_role_active_dept` ON `users` (`role_id`, `is_active`, `department_id`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
