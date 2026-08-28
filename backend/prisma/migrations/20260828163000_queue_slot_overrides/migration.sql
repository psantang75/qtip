-- ─────────────────────────────────────────────────────────────────────────────
-- Phone queue coverage: windowed overrides + a fill strategy.
--
-- The solver moved from grading whole coverage frames to solving 15-minute
-- slots, because the thing it has to automate is lunch cover: somebody away
-- from 12:30 to 13:30 is "available" for an all-day frame, so nothing was ever
-- pulled over to cover them. Two stored things had to follow.
--
-- 1. An override needs a window. "Put Mitch on Inbound while Jamie is at lunch"
--    was not expressible when the only grain was a whole day. The window is
--    modelled exactly like a partial-day absence in `schedule_exception`
--    (nullable starts_at/ends_at DATETIME, both NULL meaning all day) rather
--    than as TIME columns, so the existing combineLocal/hmFromDateTime helpers
--    carry it and the API keeps speaking 'HH:MM'.
--
--    That means the old unique key has to go: it allowed exactly one override
--    per person per queue per day, which is the limitation being removed. Like
--    `schedule_exception`, overlap is refused in the service rather than by the
--    database, and the write path is delete-overlapping-then-create — the same
--    shape as campaign.override.service.
--
-- 2. `fill_strategy` chooses who covers when several people could: the existing
--    person_priority order, or round-robin, which spreads cover duty by
--    preferring whoever has served the fewest cover-minutes so far that day.
--
-- Purely additive. Existing override rows get NULL/NULL and keep meaning "all
-- day", so nothing needs backfilling. Idempotent via the SET @sql / PREPARE /
-- EXECUTE pattern from 20260423120000_add_qc_performance_indexes: one statement
-- per check, because Prisma's migration engine does not speak DELIMITER.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The override window. NULL/NULL is all day, matching every row that already exists.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phone_queue_assignment_override' AND column_name = 'starts_at') = 0, 'ALTER TABLE `phone_queue_assignment_override` ADD COLUMN `starts_at` DATETIME NULL AFTER `action`', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phone_queue_assignment_override' AND column_name = 'ends_at') = 0, 'ALTER TABLE `phone_queue_assignment_override` ADD COLUMN `ends_at` DATETIME NULL AFTER `starts_at`', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Create the replacement lookup BEFORE dropping the unique key, so the
--    department_id foreign key is never left without a usable leftmost index.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'phone_queue_assignment_override' AND index_name = 'idx_phone_queue_override_person') = 0, 'CREATE INDEX `idx_phone_queue_override_person` ON `phone_queue_assignment_override` (`department_id`, `assignment_date`, `user_id`, `queue_id`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Drop the day-grained unique key. This is the constraint that capped a
--    person at one override per queue per day.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'phone_queue_assignment_override' AND index_name = 'uq_phone_queue_override') > 0, 'DROP INDEX `uq_phone_queue_override` ON `phone_queue_assignment_override`', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. (department_id, assignment_date) is now a left prefix of the index added in
--    step 2, so keeping it would only cost writes.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'phone_queue_assignment_override' AND index_name = 'idx_phone_queue_override_dept_date') > 0, 'DROP INDEX `idx_phone_queue_override_dept_date` ON `phone_queue_assignment_override`', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Who covers, when several people could. Defaulting to PRIORITY leaves every
--    existing department behaving exactly as it does today.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phone_queue_policy' AND column_name = 'fill_strategy') = 0, 'ALTER TABLE `phone_queue_policy` ADD COLUMN `fill_strategy` ENUM(''PRIORITY'',''ROUND_ROBIN'') NOT NULL DEFAULT ''PRIORITY'' AFTER `respect_pins`', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
