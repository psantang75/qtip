-- Adds an optional category column to the admin-managed scheduling list types so
-- they can be grouped in List Management exactly like the generic lists.
ALTER TABLE `schedule_exception_type` ADD COLUMN `category` VARCHAR(100) NULL AFTER `label`;
ALTER TABLE `schedule_activity_type`  ADD COLUMN `category` VARCHAR(100) NULL AFTER `label`;
