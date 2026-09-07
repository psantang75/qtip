-- Adherence occurrence: persist the raw start/stop times behind each deviation so
-- the drill-down can show scheduled vs actual-punch vs phone side by side without
-- re-deriving them at read time. All nullable seconds-since-local-midnight; a null
-- means "not applicable to this kind" (a missed segment has no actual punch; a
-- duration/start row has no phone span; a phone row has no scheduled instance).
-- Additive + idempotent: existing rows are backfilled by the next recompute.
ALTER TABLE `adherence_occurrence`
  ADD COLUMN `scheduled_start_sec` INT NULL AFTER `deviation_seconds`,
  ADD COLUMN `scheduled_end_sec`   INT NULL AFTER `scheduled_start_sec`,
  ADD COLUMN `actual_start_sec`    INT NULL AFTER `scheduled_end_sec`,
  ADD COLUMN `actual_end_sec`      INT NULL AFTER `actual_start_sec`,
  ADD COLUMN `phone_start_sec`     INT NULL AFTER `actual_end_sec`,
  ADD COLUMN `phone_end_sec`       INT NULL AFTER `phone_start_sec`;
