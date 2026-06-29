-- Convert coaching_sessions.coaching_purpose / coaching_format / source_type
-- from MySQL ENUMs to INT foreign keys referencing list_items.id, so these
-- three lists are fully managed in List Management (add / remove / rename).
--
-- The migration is data-preserving and idempotent:
--   1. Seed the three coaching lists (only rows that don't already exist).
--   2. Add temp INT columns and backfill them by matching the existing enum
--      text value to the seeded list_items.item_key.
--   3. Drop the old enum columns (and their indexes), rename the INT columns
--      into place, and recreate the indexes with the same names Prisma expects.

-- ── 1. Seed canonical coaching list items (idempotent by list_type + item_key) ──
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_purpose', 'WEEKLY', NULL, 'Weekly', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_purpose' AND item_key = 'WEEKLY');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_purpose', 'PERFORMANCE', NULL, 'Performance', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_purpose' AND item_key = 'PERFORMANCE');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_purpose', 'ONBOARDING', NULL, 'Onboarding', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_purpose' AND item_key = 'ONBOARDING');

INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_format', 'ONE_ON_ONE', NULL, '1-on-1', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_format' AND item_key = 'ONE_ON_ONE');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_format', 'SIDE_BY_SIDE', NULL, 'Side-by-Side', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_format' AND item_key = 'SIDE_BY_SIDE');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_format', 'TEAM_SESSION', NULL, 'Team Session', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_format' AND item_key = 'TEAM_SESSION');

INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'QA_AUDIT', NULL, 'QA Audit', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'QA_AUDIT');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'MANAGER_OBSERVATION', NULL, 'Manager Observation', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'MANAGER_OBSERVATION');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'TREND', NULL, 'Trend', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'TREND');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'DISPUTE', NULL, 'Dispute', 4, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'DISPUTE');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'SCHEDULED', NULL, 'Scheduled', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'SCHEDULED');
INSERT INTO list_items (list_type, item_key, category, label, sort_order, is_active)
SELECT 'coaching_source', 'OTHER', NULL, 'Other', 6, 1
WHERE NOT EXISTS (SELECT 1 FROM list_items WHERE list_type = 'coaching_source' AND item_key = 'OTHER');

-- ── 2. Add temp INT columns and backfill from the existing enum text values ─────
ALTER TABLE `coaching_sessions`
  ADD COLUMN `coaching_purpose_id` INT NULL,
  ADD COLUMN `coaching_format_id`  INT NULL,
  ADD COLUMN `source_type_id`      INT NULL;

UPDATE `coaching_sessions` cs
  JOIN `list_items` li ON li.list_type = 'coaching_purpose'
   AND li.item_key = CAST(cs.coaching_purpose AS CHAR) COLLATE utf8mb4_unicode_ci
  SET cs.coaching_purpose_id = li.id;
UPDATE `coaching_sessions` cs
  JOIN `list_items` li ON li.list_type = 'coaching_format'
   AND li.item_key = CAST(cs.coaching_format AS CHAR) COLLATE utf8mb4_unicode_ci
  SET cs.coaching_format_id = li.id;
UPDATE `coaching_sessions` cs
  JOIN `list_items` li ON li.list_type = 'coaching_source'
   AND li.item_key = CAST(cs.source_type AS CHAR) COLLATE utf8mb4_unicode_ci
  SET cs.source_type_id = li.id;

-- ── 3. Drop old enum columns (drops their indexes) and rename INT columns ───────
DROP INDEX `coaching_sessions_csr_id_coaching_purpose_idx` ON `coaching_sessions`;
DROP INDEX `coaching_sessions_session_date_coaching_purpose_idx` ON `coaching_sessions`;
DROP INDEX `coaching_sessions_coaching_purpose_idx` ON `coaching_sessions`;
DROP INDEX `coaching_sessions_coaching_format_idx` ON `coaching_sessions`;

ALTER TABLE `coaching_sessions`
  DROP COLUMN `coaching_purpose`,
  DROP COLUMN `coaching_format`,
  DROP COLUMN `source_type`;

ALTER TABLE `coaching_sessions`
  CHANGE COLUMN `coaching_purpose_id` `coaching_purpose` INT NULL,
  CHANGE COLUMN `coaching_format_id`  `coaching_format`  INT NULL,
  CHANGE COLUMN `source_type_id`      `source_type`      INT NULL;

-- ── 4. Recreate indexes with the names Prisma expects ───────────────────────────
CREATE INDEX `coaching_sessions_csr_id_coaching_purpose_idx` ON `coaching_sessions`(`csr_id`, `coaching_purpose`);
CREATE INDEX `coaching_sessions_session_date_coaching_purpose_idx` ON `coaching_sessions`(`session_date`, `coaching_purpose`);
CREATE INDEX `coaching_sessions_coaching_purpose_idx` ON `coaching_sessions`(`coaching_purpose`);
CREATE INDEX `coaching_sessions_coaching_format_idx` ON `coaching_sessions`(`coaching_format`);
