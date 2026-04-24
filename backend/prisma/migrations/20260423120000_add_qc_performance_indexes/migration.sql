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
-- The CreateIndexIfMissing procedure makes this migration idempotent so it
-- can be safely re-run if a partial failure occurs.

DROP PROCEDURE IF EXISTS CreateIndexIfMissing;

DELIMITER $$

CREATE PROCEDURE CreateIndexIfMissing(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_columns VARCHAR(255)
)
BEGIN
  DECLARE idx_count INT;
  SELECT COUNT(*) INTO idx_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name   = p_table_name
    AND index_name   = p_index_name;
  IF idx_count = 0 THEN
    SET @sql = CONCAT('CREATE INDEX `', p_index_name, '` ON `', p_table_name, '` (', p_columns, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- submissions: the dominant filter is `WHERE status = 'FINALIZED' AND submitted_at BETWEEN ? AND ?`.
CALL CreateIndexIfMissing('submissions',         'idx_submissions_status_date',          '`status`, `submitted_at`');
CALL CreateIndexIfMissing('submissions',         'idx_submissions_form_status_date',     '`form_id`, `status`, `submitted_at`');

-- submission_metadata: the CSR join shape is `JOIN submission_metadata sm ON sm.submission_id = s.id WHERE sm.field_id = ?`.
CALL CreateIndexIfMissing('submission_metadata', 'idx_subm_meta_subid_field',            '`submission_id`, `field_id`');

-- coaching_sessions: aggregates by date+status and per-agent timelines.
CALL CreateIndexIfMissing('coaching_sessions',   'idx_coaching_date_status',             '`session_date`, `status`');
CALL CreateIndexIfMissing('coaching_sessions',   'idx_coaching_csr_date',                '`csr_id`, `session_date`');

-- quiz_attempts: aggregates by submitted_at and per-user timelines.
CALL CreateIndexIfMissing('quiz_attempts',       'idx_quiz_attempts_date_user',          '`submitted_at`, `user_id`');
CALL CreateIndexIfMissing('quiz_attempts',       'idx_quiz_attempts_user_date',          '`user_id`, `submitted_at`');

-- disputes: dispute aggregates filter by created_at and group/filter by status.
CALL CreateIndexIfMissing('disputes',            'idx_disputes_created_status',          '`created_at`, `status`');

-- write_ups: per-agent date-range queries and the repeat-offender lookback subquery.
CALL CreateIndexIfMissing('write_ups',           'idx_write_ups_csr_date',               '`csr_id`, `created_at`');
CALL CreateIndexIfMissing('write_ups',           'idx_write_ups_date_csr',               '`created_at`, `csr_id`');

-- users: the active-CSR cohort filter `WHERE role_id = 3 AND is_active = 1` plus dept filtering.
CALL CreateIndexIfMissing('users',               'idx_users_role_active_dept',           '`role_id`, `is_active`, `department_id`');

DROP PROCEDURE IF EXISTS CreateIndexIfMissing;
