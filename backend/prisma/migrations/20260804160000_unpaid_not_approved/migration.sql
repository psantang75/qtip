-- Adds the sixth Paychex pay type, `Unpaid - Not Approved`: unapproved time away
-- that is also unpaid. It is the unpaid twin of `PTO - Not Approved` and earns
-- the same point, so the retired `unexcused_absence` type is relabelled and
-- brought back rather than a seventh type being invented for it.
--
-- Only a FULL day earns the flat point. A partial block falls through to the
-- normal Late / Leave Early bands, because the engine's point-bearing-exception
-- branch is gated on `is_full_day` and an unexcused window forgives nothing.

UPDATE `schedule_exception_type`
   SET `label` = 'Unpaid - Not Approved',
       `paychex_pay_type` = 'Unpaid - Not Approved',
       `category` = 'Unexcused - Points',
       `description` = 'Unpaid time off taken without approval. Earns points.',
       `is_excused` = 0,
       `duration_mode` = 'EITHER',
       `affects_arrival` = 1,
       `affects_departure` = 1,
       `is_active` = 1,
       `sort_order` = 6
 WHERE `type_key` = 'unexcused_absence';

UPDATE `schedule_exception_type` SET `sort_order` = 7 WHERE `type_key` = 'no_call_no_show';

-- Point rules sort on a 10s scale; the PTO - Not Approved rule was seeded at 8
-- and sorted above Late 3+, which is not where the policy table reads it.
UPDATE `attendance_point_rule` SET `sort_order` = 65 WHERE `rule_key` = 'unscheduled_pto';

INSERT INTO `attendance_point_rule`
  (`rule_key`, `label`, `kind`, `min_seconds`, `max_seconds`, `points`,
   `exception_type_id`, `effective_from`, `effective_to`, `sort_order`, `is_active`)
SELECT 'unpaid_not_approved', 'Unpaid - Not Approved', 'EXCEPTION', 0, NULL, 1.00,
       t.`id`, '2000-01-01', NULL, 68, 1
  FROM `schedule_exception_type` t
 WHERE t.`type_key` = 'unexcused_absence'
   AND NOT EXISTS (
     SELECT 1 FROM `attendance_point_rule` r WHERE r.`rule_key` = 'unpaid_not_approved'
   );
