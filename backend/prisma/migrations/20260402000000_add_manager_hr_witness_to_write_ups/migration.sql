-- Add manager_id and hr_witness_id columns to write_ups

ALTER TABLE `write_ups`
  ADD COLUMN `manager_id`    INT NULL,
  ADD COLUMN `hr_witness_id` INT NULL;

ALTER TABLE `write_ups`
  ADD CONSTRAINT `write_ups_manager_id_fkey`    FOREIGN KEY (`manager_id`)    REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `write_ups_hr_witness_id_fkey` FOREIGN KEY (`hr_witness_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
