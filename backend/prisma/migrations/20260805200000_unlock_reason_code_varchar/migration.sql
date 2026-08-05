-- Reasons are now curated in Admin -> List Management -> Quality, so the fixed
-- ENUM on `record_unlock.reason_code` becomes a plain VARCHAR that stores the
-- managed list's code. Existing values (SCORING_ERROR, …) are preserved as-is
-- because they are the same strings the ENUM held.
ALTER TABLE `record_unlock` MODIFY COLUMN `reason_code` VARCHAR(100) NOT NULL;
