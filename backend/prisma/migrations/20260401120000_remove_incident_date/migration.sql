-- Remove incident_date from write_up_incidents
-- The date is now captured at the example level (example_date on write_up_examples)
ALTER TABLE `write_up_incidents` DROP COLUMN `incident_date`;
