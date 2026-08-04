-- Completes the Paychex pay types that flow over on the punch feed. Six were
-- already linked; this adds the last two.
--
-- `Jury Duty` already existed but was retired and unlinked, so it is brought
-- back rather than duplicated. `VTO` has no counterpart in the list at all —
-- "sent home by the company" is the closest retired type, but VTO is the
-- employee volunteering, so it gets its own row rather than a misleading key.
--
-- Both are excused and earn nothing, so no attendance_point_rule changes: the
-- only point-bearing types remain PTO - Not Approved, Unpaid - Not Approved and
-- the manual No Call / No Show.
--
-- The feed carries the Paychex *Description* column, not the Code, which is why
-- these link on 'Jury Duty' and 'VTO' rather than 'JD' and 'VTO'.

UPDATE `schedule_exception_type`
   SET `label` = 'Jury Duty',
       `paychex_pay_type` = 'Jury Duty',
       `category` = 'Excused - No Points',
       `description` = 'Court-ordered jury service. Imported from Paychex.',
       `is_excused` = 1,
       `duration_mode` = 'EITHER',
       `affects_arrival` = 1,
       `affects_departure` = 1,
       `is_active` = 1,
       `sort_order` = 4
 WHERE `type_key` = 'jury_duty';

INSERT INTO `schedule_exception_type`
  (`type_key`, `label`, `category`, `description`, `paychex_pay_type`, `is_excused`,
   `duration_mode`, `affects_arrival`, `affects_departure`, `is_system`, `sort_order`, `is_active`)
SELECT 'vto', 'VTO', 'Excused - No Points',
       'Voluntary time off the employee accepted when volume was low. Imported from Paychex.',
       'VTO', 1, 'EITHER', 1, 1, 1, 6, 1
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM `schedule_exception_type` t WHERE t.`type_key` = 'vto'
 );

-- Renumber so the excused group leads and the two new types sit with their kind
-- instead of on the end.
UPDATE `schedule_exception_type` SET `sort_order` = 1 WHERE `type_key` = 'scheduled_pto';
UPDATE `schedule_exception_type` SET `sort_order` = 2 WHERE `type_key` = 'holiday';
UPDATE `schedule_exception_type` SET `sort_order` = 3 WHERE `type_key` = 'bereavement';
UPDATE `schedule_exception_type` SET `sort_order` = 5 WHERE `type_key` = 'excused_absence';
UPDATE `schedule_exception_type` SET `sort_order` = 7 WHERE `type_key` = 'unscheduled_pto';
UPDATE `schedule_exception_type` SET `sort_order` = 8 WHERE `type_key` = 'unexcused_absence';
UPDATE `schedule_exception_type` SET `sort_order` = 9 WHERE `type_key` = 'no_call_no_show';
