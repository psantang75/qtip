-- Convert legacy OFF rows to disabled IMMEDIATE so the enum can drop OFF.
UPDATE `email_templates`
   SET `is_enabled` = 0, `cadence` = 'IMMEDIATE'
 WHERE `cadence` = 'OFF';

-- Drop OFF from the cadence enum (covered by `is_enabled`).
ALTER TABLE `email_templates`
  MODIFY `cadence` ENUM('IMMEDIATE','DAILY','WEEKLY') NOT NULL DEFAULT 'IMMEDIATE';

ALTER TABLE `email_template_versions`
  MODIFY `cadence` ENUM('IMMEDIATE','DAILY','WEEKLY') NOT NULL;

-- New columns for editable per-template recipient roles.
ALTER TABLE `email_templates`
  ADD COLUMN `available_roles` JSON NOT NULL AFTER `allowed_variables`,
  ADD COLUMN `recipient_roles` JSON NOT NULL AFTER `available_roles`;
