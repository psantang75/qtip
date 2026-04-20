-- Add CANCELED to the coaching_sessions status enum.
--
-- The enum below is the union of every value that some part of the system
-- needs to coexist with existing data:
--   * DRAFT — used by coaching.controller (createCoachingSessions) and present
--             in 20 existing rows; cannot be dropped without losing data.
--   * IN_PROCESS / QUIZ_PENDING — defined by the Prisma schema and referenced
--             by the QC coaching analytics page and shared status labels.
--   * CANCELED — the new value this migration is meant to add.
-- Order matches the original 0_init declaration with DRAFT prepended and
-- CANCELED appended so existing rows retain their integer ordinals.
ALTER TABLE `coaching_sessions` MODIFY `status`
  ENUM('DRAFT','SCHEDULED','IN_PROCESS','AWAITING_CSR_ACTION','QUIZ_PENDING','COMPLETED','FOLLOW_UP_REQUIRED','CLOSED','CANCELED')
  NOT NULL DEFAULT 'DRAFT';
