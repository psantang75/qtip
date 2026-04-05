-- Add parent_id column to existing departments table for hierarchy support
ALTER TABLE `departments` ADD COLUMN `parent_id` INT NULL AFTER `is_active`;
ALTER TABLE `departments` ADD CONSTRAINT `fk_department_parent` FOREIGN KEY (`parent_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX `idx_department_parent` ON `departments` (`parent_id`);
