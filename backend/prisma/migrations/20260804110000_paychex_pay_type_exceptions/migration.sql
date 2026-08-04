-- Paychex becomes the system of record for time off. The punch export now carries
-- a Pay Type on every Start Non-Work block, so the feed can say WHY somebody was
-- out instead of only that they were. Three changes make that usable:
--
--   1. punch_raw.pay_type stores the reason alongside the block.
--   2. schedule_exception_type.paychex_pay_type links our type list to theirs, so
--      the mapping is editable in Admin > List Management rather than hard-coded.
--   3. The type list collapses to the six categories Paychex actually emits, each
--      allowing full day OR a window. The old paired types (Excused/Unexcused Late
--      Arrival, Early Leave) existed only to encode which edge they forgave; the
--      engine now intersects a window with the deviation it overlaps, so one type
--      carrying both flags covers every case without double-forgiving.

ALTER TABLE `punch_raw`
  ADD COLUMN `pay_type` VARCHAR(50) NULL AFTER `punch_type_out`;

ALTER TABLE `schedule_exception_type`
  ADD COLUMN `paychex_pay_type` VARCHAR(100) NULL AFTER `description`,
  ADD UNIQUE KEY `uq_schedule_exception_type_paychex` (`paychex_pay_type`);

-- ── The six retained types ───────────────────────────────────────────────────
-- Labels mirror Paychex verbatim so a manual entry and an imported one read the
-- same on the roster. EITHER duration keeps the Full day toggle available on all
-- of them; both affects flags let a partial window forgive whichever edge it
-- actually overlaps.
UPDATE `schedule_exception_type`
   SET `label` = 'PTO - Approved',
       `paychex_pay_type` = 'PTO - Approved',
       `category` = 'Excused - No Points',
       `description` = 'Approved paid time off. Imported from Paychex.',
       `is_excused` = 1, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 1
 WHERE `type_key` = 'scheduled_pto';

UPDATE `schedule_exception_type`
   SET `label` = 'Holiday',
       `paychex_pay_type` = 'Holiday',
       `category` = 'Excused - No Points',
       `description` = 'Company holiday. Imported from Paychex.',
       `is_excused` = 1, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 2
 WHERE `type_key` = 'holiday';

UPDATE `schedule_exception_type`
   SET `label` = 'Bereavement',
       `paychex_pay_type` = 'Bereavement',
       `category` = 'Excused - No Points',
       `description` = 'Bereavement leave. Imported from Paychex.',
       `is_excused` = 1, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 3
 WHERE `type_key` = 'bereavement';

UPDATE `schedule_exception_type`
   SET `label` = 'Unpaid - Approved',
       `paychex_pay_type` = 'Unpaid - Approved',
       `category` = 'Excused - No Points',
       `description` = 'Approved unpaid time off. Imported from Paychex.',
       `is_excused` = 1, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 4
 WHERE `type_key` = 'excused_absence';

UPDATE `schedule_exception_type`
   SET `label` = 'PTO - Not Approved',
       `paychex_pay_type` = 'PTO - Not Approved',
       `category` = 'Unexcused - Points',
       `description` = 'Time off taken without approval. Earns points.',
       `is_excused` = 0, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 5
 WHERE `type_key` = 'unscheduled_pto';

-- Not a Paychex pay type yet. It is being added on their side; until then the
-- link stays NULL and the type is entered by hand.
UPDATE `schedule_exception_type`
   SET `label` = 'No Call / No Show',
       `category` = 'Unexcused - Points',
       `description` = 'Absent with no notice. Earns points.',
       `is_excused` = 0, `duration_mode` = 'EITHER',
       `affects_arrival` = 1, `affects_departure` = 1,
       `is_active` = 1, `sort_order` = 6
 WHERE `type_key` = 'no_call_no_show';

-- ── Retire the rest ──────────────────────────────────────────────────────────
-- Deactivated, not deleted: an exception row could reference one, and the label
-- still has to render on a historical roster.
UPDATE `schedule_exception_type`
   SET `is_active` = 0
 WHERE `type_key` IN (
   'excused_late', 'excused_early_leave', 'unexcused_late', 'unexcused_early_leave',
   'jury_duty', 'fmla_loa', 'sent_home_company', 'extended_break'
 );

-- ── Points for unapproved time off ───────────────────────────────────────────
-- Same weight as an absence, because that is what it is; scoring it through the
-- exception rule instead means the roster names the reason.
INSERT INTO `attendance_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`,
   `exception_type_id`, `effective_from`, `effective_to`, `sort_order`, `is_active`)
SELECT 'unscheduled_pto', 'PTO - Not Approved', 'EXCEPTION', 0, NULL, 1.00,
       t.`id`, '2000-01-01', NULL, 8, 1
  FROM `schedule_exception_type` t
 WHERE t.`type_key` = 'unscheduled_pto'
   AND NOT EXISTS (
     SELECT 1 FROM `attendance_point_rule` r WHERE r.`rule_key` = 'unscheduled_pto'
   );
