-- Add FOLLOW_UP_COMPLETED to the write_ups status enum so a write-up can sit
-- in a "follow-up completed" state after the manager confirms the follow-up
-- meeting and before the warning is closed. Mirrors the recent
-- add_canceled_status pattern.
ALTER TABLE `write_ups` MODIFY `status`
  ENUM('DRAFT','SCHEDULED','DELIVERED','AWAITING_SIGNATURE','SIGNED','FOLLOW_UP_PENDING','FOLLOW_UP_COMPLETED','CLOSED')
  NOT NULL DEFAULT 'DRAFT';
