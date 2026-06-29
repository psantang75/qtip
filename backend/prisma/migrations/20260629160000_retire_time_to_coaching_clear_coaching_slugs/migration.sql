-- Retire the unused "Time to Coaching" KPI and remove coaching list slugs.
--
-- 1. Delete the time_to_coaching KPI definition. Its ie_kpi_threshold rows are
--    removed automatically via the ON DELETE CASCADE foreign key.
-- 2. Coaching purpose/format/source are fully List-Management-managed by id and
--    label only — no code resolves them by item_key anymore — so clear the
--    leftover slugs. (MySQL unique keys allow multiple NULLs.)
--
-- Both statements are idempotent (safe to re-run).

DELETE FROM `ie_kpi` WHERE `kpi_code` = 'time_to_coaching';

UPDATE `list_items`
   SET `item_key` = NULL
 WHERE `list_type` IN ('coaching_purpose', 'coaching_format', 'coaching_source')
   AND `item_key` IS NOT NULL;
