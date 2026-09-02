-- ─────────────────────────────────────────────────────────────────────────────
-- Stable form-family identity: forms.form_group_id
--
-- Additive only: one nullable column + one index, then a deterministic,
-- idempotent backfill. No table is created; no existing column/data is altered.
--
-- WHY: a form is versioned by creating a NEW `forms` row per save. Those rows
-- were only loosely tied together by `form_name`, which is fragile — a form can
-- be renamed between versions (e.g. "No Contact Call Review Form" -> "… v2",
-- "Ticket Review" -> "Tech Ticket Review …"), `parent_form_id` is NULL on legacy
-- rows and branches where present, and `version` numbers are not monotonic per
-- family. `form_group_id` is the single, denormalised source of truth: every
-- version of one logical form shares it (the id of the family's first version).
--
-- BACKFILL STRATEGY (both signals, so renames and legacy rows still group):
--   1. seed each row to its own id;
--   2. collapse to the lineage root via a recursive walk of parent_form_id
--      (handles arbitrarily deep chains in one pass);
--   3. merge groups that share a form_name, then flatten group pointers,
--      iterated until convergence (handles renames + legacy NULL-lineage rows).
-- Every step uses MIN/`<` guards so the whole script is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `forms` ADD COLUMN `form_group_id` INT NULL AFTER `parent_form_id`;
CREATE INDEX `idx_forms_group` ON `forms` (`form_group_id`);

-- 1. Seed: each version starts as its own group.
UPDATE `forms` SET `form_group_id` = `id` WHERE `form_group_id` IS NULL;

-- 2. Collapse to the lineage root (walk parent_form_id to the top). Materialised
--    into a temp table first so the recursive query does not reference `forms`
--    while `forms` is the UPDATE target.
DROP TEMPORARY TABLE IF EXISTS `tmp_form_roots`;
CREATE TEMPORARY TABLE `tmp_form_roots` AS
SELECT `id`, `root` FROM (
  WITH RECURSIVE roots AS (
    SELECT `id`, `id` AS `root`
      FROM `forms`
      WHERE `parent_form_id` IS NULL
         OR `parent_form_id` NOT IN (SELECT `id` FROM `forms`)
    UNION ALL
    SELECT c.`id`, r.`root`
      FROM `forms` c
      JOIN roots r ON c.`parent_form_id` = r.`id`
  )
  SELECT `id`, `root` FROM roots
) x;

UPDATE `forms` f
  JOIN `tmp_form_roots` r ON f.`id` = r.`id`
  SET f.`form_group_id` = r.`root`
  WHERE f.`form_group_id` <> r.`root`;

DROP TEMPORARY TABLE IF EXISTS `tmp_form_roots`;

-- 3. Merge by shared name + flatten pointers, iterated to convergence. Each
--    pair is monotonic (only ever lowers a group id), so re-running is a no-op
--    once stable. Eight iterations far exceeds the rename/name-chain depth in
--    the data.
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
UPDATE `forms` f JOIN (SELECT `form_name`, MIN(`form_group_id`) g FROM `forms` GROUP BY `form_name`) n ON f.`form_name` = n.`form_name` SET f.`form_group_id` = n.g WHERE f.`form_group_id` > n.g;
UPDATE `forms` f JOIN `forms` g ON f.`form_group_id` = g.`id` SET f.`form_group_id` = g.`form_group_id` WHERE f.`form_group_id` > g.`form_group_id`;
