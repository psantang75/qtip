-- ─────────────────────────────────────────────────────────────────────────────
-- Performance indexes (HIGH-value) + one redundant-index cleanup.
--
-- Approved out of the read-only database review (docs/database_review.md). Purely
-- additive composite indexes on hot query paths whose existing single-column FK
-- indexes cannot serve, plus the drop of one duplicate index. No table is added,
-- altered, or dropped; no data is touched.
--
-- Each index was verified with EXPLAIN before creation:
--   • auth_logs      — login throttling filtered `type=ALL` (full scan) with no
--                      usable index; (email, attempted_at) turns it into a seek.
--   • audit_logs     — actor-over-time listing used the user_id FK index then
--                      `Using filesort` for ORDER BY created_at; (user_id,
--                      created_at) removes the filesort. Second index covers the
--                      by-target lookup (target_type, target_id).
--   • audit_assignments / calls / score_snapshots — "for X in a date window"
--                      queries seeked the FK single column then post-filtered
--                      (`Using where`); the composites let the range be seeked.
--   • import_logs    — Import Center lists by data_type + recency.
--
-- The dropped index `idx_schedule_shift_user_date` duplicates the columns of
-- `uq_schedule_shift_user_date` (UNIQUE already provides an index on the same
-- (user_id, shift_date) tuple), so it was pure overhead on writes.
--
-- Written as hand-authored SQL and applied via `prisma migrate deploy` because
-- this repo's schema.prisma is deliberately a partial model (the Insights
-- data-warehouse `ie_fact_*`/`ie_stg_*` layer and other raw-SQL tables are
-- unmodeled by design), so `prisma migrate dev` cannot be used here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX `idx_auth_logs_email_time` ON `auth_logs`(`email`, `attempted_at`);

CREATE INDEX `idx_audit_assignments_qa_active_start` ON `audit_assignments`(`qa_id`, `is_active`, `start_date`);

CREATE INDEX `idx_calls_csr_date` ON `calls`(`csr_id`, `call_date`);

CREATE INDEX `idx_score_snapshots_csr_date` ON `score_snapshots`(`csr_id`, `snapshot_date`);

CREATE INDEX `idx_audit_logs_user_created` ON `audit_logs`(`user_id`, `created_at`);

CREATE INDEX `idx_audit_logs_target` ON `audit_logs`(`target_type`, `target_id`);

CREATE INDEX `idx_import_logs_type_created` ON `import_logs`(`data_type`, `created_at`);

DROP INDEX `idx_schedule_shift_user_date` ON `schedule_shift`;
