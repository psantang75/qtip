-- Split phone matching into two independent edges per break/lunch:
--   *_PHONE_START — phone opened Break/Meal BEFORE the punch-in (the dodge)
--   *_PHONE_STOP  — phone stayed Break/Meal AFTER the punch-out (slow back on queue)
-- Replaces the single *_PHONE kind (which summed both edges into one band/row), so
-- the two behaviours score and coach independently. Same seeded band values as the
-- combined kind used, split across the two edges; tune per-edge later in List
-- Management. Derived phone occurrences are dropped and rebuilt by the recompute.

-- 1. Widen both enum columns to a superset (old + new) so the data can be migrated.
ALTER TABLE `adherence_point_rule` MODIFY COLUMN `kind`
  ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START',
       'BREAK_PHONE','LUNCH_PHONE',
       'BREAK_PHONE_START','BREAK_PHONE_STOP','LUNCH_PHONE_START','LUNCH_PHONE_STOP',
       'BREAK_MISSED','LUNCH_MISSED') NOT NULL;
ALTER TABLE `adherence_occurrence` MODIFY COLUMN `kind`
  ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START',
       'BREAK_PHONE','LUNCH_PHONE',
       'BREAK_PHONE_START','BREAK_PHONE_STOP','LUNCH_PHONE_START','LUNCH_PHONE_STOP',
       'BREAK_MISSED','LUNCH_MISSED') NOT NULL;

-- 2. Drop the derived phone occurrences (the engine rebuilds them on recompute)
--    and the old combined phone bands.
DELETE FROM `adherence_occurrence` WHERE `kind` IN ('BREAK_PHONE','LUNCH_PHONE');
DELETE FROM `adherence_point_rule` WHERE `kind` IN ('BREAK_PHONE','LUNCH_PHONE');

-- 3. Seed the per-edge bands (same thresholds the combined kind used).
INSERT IGNORE INTO `adherence_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`, `effective_from`, `sort_order`) VALUES
  ('break_phone_start_minor',    'Break phone early on — minor',    'BREAK_PHONE_START',   1,   299, 0.25, '2000-01-01', 110),
  ('break_phone_start_moderate', 'Break phone early on — moderate', 'BREAK_PHONE_START', 300,   599, 0.50, '2000-01-01', 112),
  ('break_phone_start_severe',   'Break phone early on — severe',   'BREAK_PHONE_START', 600,  NULL, 1.00, '2000-01-01', 114),
  ('break_phone_stop_minor',     'Break phone late off — minor',    'BREAK_PHONE_STOP',    1,   299, 0.25, '2000-01-01', 116),
  ('break_phone_stop_moderate',  'Break phone late off — moderate', 'BREAK_PHONE_STOP',  300,   599, 0.50, '2000-01-01', 118),
  ('break_phone_stop_severe',    'Break phone late off — severe',   'BREAK_PHONE_STOP',  600,  NULL, 1.00, '2000-01-01', 120),
  ('lunch_phone_start_minor',    'Lunch phone early on — minor',    'LUNCH_PHONE_START',   1,   299, 0.25, '2000-01-01', 122),
  ('lunch_phone_start_moderate', 'Lunch phone early on — moderate', 'LUNCH_PHONE_START', 300,   599, 0.50, '2000-01-01', 124),
  ('lunch_phone_start_severe',   'Lunch phone early on — severe',   'LUNCH_PHONE_START', 600,  NULL, 1.00, '2000-01-01', 126),
  ('lunch_phone_stop_minor',     'Lunch phone late off — minor',    'LUNCH_PHONE_STOP',    1,   299, 0.25, '2000-01-01', 128),
  ('lunch_phone_stop_moderate',  'Lunch phone late off — moderate', 'LUNCH_PHONE_STOP',  300,   599, 0.50, '2000-01-01', 130),
  ('lunch_phone_stop_severe',    'Lunch phone late off — severe',   'LUNCH_PHONE_STOP',  600,  NULL, 1.00, '2000-01-01', 132);

-- 4. Narrow both enum columns to the final set (drop the retired combined kinds).
ALTER TABLE `adherence_point_rule` MODIFY COLUMN `kind`
  ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START',
       'BREAK_PHONE_START','BREAK_PHONE_STOP','LUNCH_PHONE_START','LUNCH_PHONE_STOP',
       'BREAK_MISSED','LUNCH_MISSED') NOT NULL;
ALTER TABLE `adherence_occurrence` MODIFY COLUMN `kind`
  ENUM('BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START',
       'BREAK_PHONE_START','BREAK_PHONE_STOP','LUNCH_PHONE_START','LUNCH_PHONE_STOP',
       'BREAK_MISSED','LUNCH_MISSED') NOT NULL;
