-- Duration is now binary: Full day vs Partial day (Partial drives the time
-- window on a shift). Retire the legacy 'EITHER' mode from exception types.
-- Missed Punch is inherently a partial-day event; everything else that was
-- 'EITHER' (PTO, bereavement, jury duty, company closure, call-outs) is full-day.
UPDATE `schedule_exception_type` SET `duration_mode` = 'WINDOW'   WHERE `type_key` = 'missed_punch';
UPDATE `schedule_exception_type` SET `duration_mode` = 'FULL_DAY' WHERE `duration_mode` = 'EITHER';
