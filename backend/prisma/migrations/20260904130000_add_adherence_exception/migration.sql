-- ─────────────────────────────────────────────────────────────────────────────
-- Adherence variance exceptions — an approved allowance for ONE break/lunch on
-- ONE day. Adherence-only: the engine reads these at recompute to forgive that
-- segment's Long (end) and Start (beginning) deviations, capped per edge so it
-- never creates credit and never nets across segments. It does NOT touch the
-- schedule, punch/time clock, attendance, or phone rules.
--
-- One row per (user, work_date, segment_kind, seq); seq matches the occurrence
-- seq (sorted-by-start index within that kind), so a two-break day is addressed
-- independently. Additive + idempotent, matching the other adherence migrations
-- (utf8mb4_unicode_ci, CREATE TABLE IF NOT EXISTS, uq_*/idx_*/fk_*).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `adherence_exception` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `user_id`         INT          NOT NULL,
  `work_date`       DATE         NOT NULL,
  `segment_kind`    ENUM('BREAK','LUNCH') NOT NULL,
  `seq`             TINYINT      NOT NULL DEFAULT 1,
  `begin_extra_sec` INT          NOT NULL DEFAULT 0,
  `end_extra_sec`   INT          NOT NULL DEFAULT 0,
  `reason`          VARCHAR(255) NULL,
  `entered_by`      INT          NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adherence_exception_user_date_seg_seq` (`user_id`, `work_date`, `segment_kind`, `seq`),
  INDEX `idx_adherence_exception_date` (`work_date`),
  CONSTRAINT `fk_adherence_exception_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
