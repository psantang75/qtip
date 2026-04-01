-- Align database schema with schema.prisma
-- Drops legacy columns from coaching_sessions that were removed from the schema.
-- Converts coaching_sessions enum fields from VARCHAR to proper ENUM types.
-- Fixes write_up foreign key and index naming to Prisma conventions.
-- list_items is intentionally excluded (managed via raw SQL, marked @@ignore).
-- coaching_session_behavior_flags, coaching_session_quizzes, coaching_session_resources are retained
-- as they are actively used by coaching and CSR controllers.

-- DropForeignKey
ALTER TABLE `write_up_attachments` DROP FOREIGN KEY `fk_write_up_attachments_write_up`;

-- DropForeignKey
ALTER TABLE `write_up_examples` DROP FOREIGN KEY `fk_write_up_examples_violation`;

-- DropForeignKey
ALTER TABLE `write_up_incidents` DROP FOREIGN KEY `fk_write_up_incidents_write_up`;

-- DropForeignKey
ALTER TABLE `write_up_prior_discipline` DROP FOREIGN KEY `fk_write_up_prior_write_up`;

-- DropForeignKey
ALTER TABLE `write_up_violations` DROP FOREIGN KEY `fk_write_up_violations_incident`;

-- DropForeignKey
ALTER TABLE `write_ups` DROP FOREIGN KEY `fk_write_ups_coaching`;

-- DropForeignKey
ALTER TABLE `write_ups` DROP FOREIGN KEY `fk_write_ups_creator`;

-- DropForeignKey
ALTER TABLE `write_ups` DROP FOREIGN KEY `fk_write_ups_csr`;

-- DropForeignKey
ALTER TABLE `write_ups` DROP FOREIGN KEY `fk_write_ups_follow_up`;

-- DropIndex
DROP INDEX `fk_write_ups_coaching` ON `write_ups`;

-- DropIndex
DROP INDEX `fk_write_ups_follow_up` ON `write_ups`;

-- AlterTable: convert coaching_sessions VARCHAR fields to ENUMs
ALTER TABLE `coaching_sessions`
    MODIFY `source_type` ENUM('QA_AUDIT', 'MANAGER_OBSERVATION', 'TREND', 'DISPUTE', 'SCHEDULED', 'OTHER') NOT NULL DEFAULT 'OTHER',
    MODIFY `coaching_purpose` ENUM('WEEKLY', 'PERFORMANCE', 'ONBOARDING') NOT NULL DEFAULT 'WEEKLY',
    MODIFY `coaching_format` ENUM('ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION') NOT NULL DEFAULT 'ONE_ON_ONE';

-- AlterTable: normalize write_ups defaults to match Prisma expectations
ALTER TABLE `write_ups`
    MODIFY `follow_up_required` BOOLEAN NOT NULL DEFAULT false,
    ALTER COLUMN `updated_at` DROP DEFAULT;

-- AddForeignKey (Prisma-named constraints for write_up tables)
ALTER TABLE `write_ups` ADD CONSTRAINT `write_ups_csr_id_fkey` FOREIGN KEY (`csr_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_ups` ADD CONSTRAINT `write_ups_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_ups` ADD CONSTRAINT `write_ups_follow_up_assigned_to_fkey` FOREIGN KEY (`follow_up_assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `write_ups` ADD CONSTRAINT `write_ups_linked_coaching_id_fkey` FOREIGN KEY (`linked_coaching_id`) REFERENCES `coaching_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `write_up_incidents` ADD CONSTRAINT `write_up_incidents_write_up_id_fkey` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_up_violations` ADD CONSTRAINT `write_up_violations_incident_id_fkey` FOREIGN KEY (`incident_id`) REFERENCES `write_up_incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_up_examples` ADD CONSTRAINT `write_up_examples_violation_id_fkey` FOREIGN KEY (`violation_id`) REFERENCES `write_up_violations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_up_prior_discipline` ADD CONSTRAINT `write_up_prior_discipline_write_up_id_fkey` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `write_up_attachments` ADD CONSTRAINT `write_up_attachments_write_up_id_fkey` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex: normalize write_up index names to Prisma conventions
ALTER TABLE `write_up_attachments` RENAME INDEX `idx_write_up_attachments_write_up_id` TO `write_up_attachments_write_up_id_idx`;
ALTER TABLE `write_up_examples` RENAME INDEX `idx_write_up_examples_violation_id` TO `write_up_examples_violation_id_idx`;
ALTER TABLE `write_up_incidents` RENAME INDEX `idx_write_up_incidents_write_up_id` TO `write_up_incidents_write_up_id_idx`;
ALTER TABLE `write_up_prior_discipline` RENAME INDEX `idx_write_up_prior_discipline_write_up_id` TO `write_up_prior_discipline_write_up_id_idx`;
ALTER TABLE `write_up_prior_discipline` RENAME INDEX `unique_prior_discipline` TO `write_up_prior_discipline_write_up_id_reference_type_referen_key`;
ALTER TABLE `write_up_violations` RENAME INDEX `idx_write_up_violations_incident_id` TO `write_up_violations_incident_id_idx`;
ALTER TABLE `write_ups` RENAME INDEX `idx_write_ups_created_at` TO `write_ups_created_at_idx`;
ALTER TABLE `write_ups` RENAME INDEX `idx_write_ups_created_by` TO `write_ups_created_by_idx`;
ALTER TABLE `write_ups` RENAME INDEX `idx_write_ups_csr_id` TO `write_ups_csr_id_idx`;
ALTER TABLE `write_ups` RENAME INDEX `idx_write_ups_status` TO `write_ups_status_idx`;
