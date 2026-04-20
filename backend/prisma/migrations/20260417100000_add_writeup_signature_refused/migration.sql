-- Add SIGNATURE_REFUSED status + refusal_reason / refused_at columns so
-- managers can record that an employee declined to sign a write-up. The
-- workflow continues (close-out / follow-up) the same way it does after a
-- normal signature. Mirrors the recent add_writeup_followup_completed pattern.
ALTER TABLE `write_ups` MODIFY `status`
  ENUM('DRAFT','SCHEDULED','DELIVERED','AWAITING_SIGNATURE','SIGNED','SIGNATURE_REFUSED','FOLLOW_UP_PENDING','FOLLOW_UP_COMPLETED','CLOSED')
  NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `write_ups`
  ADD COLUMN `refusal_reason` TEXT NULL,
  ADD COLUMN `refused_at` DATETIME NULL;
