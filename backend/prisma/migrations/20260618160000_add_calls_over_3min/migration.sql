-- Add `calls_over_3min` to the Call Activity staging + fact tables.
--
-- This count cannot be derived from the existing summed `call_mins` (which is
-- already aggregated across calls), so it is computed per-conversation in the
-- extract (call_mins >= 3) and carried through staging into the fact.

ALTER TABLE `ie_stg_call_activity`
  ADD COLUMN `calls_over_3min` INT NULL AFTER `call_count`;

ALTER TABLE `ie_fact_call_activity`
  ADD COLUMN `calls_over_3min` INT NOT NULL DEFAULT 0 AFTER `call_count`;
