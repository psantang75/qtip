-- Create submission_ticket_tasks (junction Submission <-> CRM ticket/task).
--
-- This table was added to schema.prisma at some point in development but no
-- accompanying migration was generated. On dev the table was created
-- out-of-band; on a fresh stage / prod DB it doesn't exist, which breaks
-- the next migration (20260430130000_add_ai_calibration) — that migration
-- ALTERs this table to add the idx_stt_external index.
--
-- Schema mirrors the SubmissionTicketTask model in schema.prisma. The
-- idx_stt_external index is intentionally NOT created here so the
-- subsequent add_ai_calibration migration can add it as it always has on
-- dev (keeping the dev / stage / prod migration paths identical).

CREATE TABLE `submission_ticket_tasks` (
  `id`            INT            NOT NULL AUTO_INCREMENT,
  `submission_id` INT            NOT NULL,
  `kind`          ENUM('TICKET','TASK') NOT NULL,
  `external_id`   BIGINT         NOT NULL,
  `sort_order`    INT            NOT NULL DEFAULT 0,
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_submission_ticket_task` (`submission_id`, `kind`, `external_id`),
  INDEX `submission_ticket_tasks_submission_id_idx` (`submission_id`),
  CONSTRAINT `submission_ticket_tasks_submission_id_fkey`
    FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
