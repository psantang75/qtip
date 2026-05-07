-- Email / Notification system tables.
--
-- 1) password_reset_tokens
--    SHA-256 hashed reset tokens. Raw token only ever lives in the user's
--    inbox; lookup is by token_hash so a DB read never exposes a usable
--    credential.
--
-- 2) email_templates + email_template_versions
--    Admin-editable subject / body / cadence per `template_key`. Versions
--    are immutable history rows for audit + rollback. Locked templates
--    (security/critical workflow) cannot be disabled in the UI.
--
-- 3) email_log
--    Append-only audit of every send / skip. `dedupe_key` is UNIQUE so
--    duplicate events cannot double-send. Status enum captures every
--    deliberate skip (rate-limit, quiet-hours, suppression, circuit-breaker)
--    so admins can diagnose missing mail without reading server logs.
--
-- 4) notification_queue
--    Holds DAILY / WEEKLY digest payloads until DigestScheduler picks
--    them up. `processed_at` is set in place rather than deleting the row
--    so the audit trail survives.

CREATE TABLE `password_reset_tokens` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `user_id`    INT          NOT NULL,
  `token_hash` CHAR(64)     NOT NULL,
  `expires_at` DATETIME(0)  NOT NULL,
  `used_at`    DATETIME(0)  NULL,
  `ip_address` VARCHAR(45)  NULL,
  `created_at` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pwreset_token_hash` (`token_hash`),
  INDEX `idx_pwreset_user_id`    (`user_id`),
  CONSTRAINT `fk_pwreset_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `email_templates` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `template_key`      VARCHAR(100) NOT NULL,
  `category`          VARCHAR(50)  NOT NULL,
  `name`              VARCHAR(255) NOT NULL,
  `description`       TEXT         NULL,
  `subject`           TEXT         NOT NULL,
  `body_html`         LONGTEXT     NOT NULL,
  `body_text`         TEXT         NULL,
  `cadence`           ENUM('IMMEDIATE','DAILY','WEEKLY','OFF') NOT NULL DEFAULT 'IMMEDIATE',
  `digest_filter`     ENUM('ALL','BELOW_THRESHOLD','ROUTED_TO_QA') NOT NULL DEFAULT 'ALL',
  `is_enabled`        TINYINT(1)   NOT NULL DEFAULT 1,
  `is_locked`         TINYINT(1)   NOT NULL DEFAULT 0,
  `allowed_variables` JSON         NOT NULL,
  `recipient_summary` VARCHAR(500) NOT NULL,
  `version`           INT          NOT NULL DEFAULT 1,
  `updated_by`        INT          NULL,
  `updated_at`        DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`        DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_email_templates_key` (`template_key`),
  INDEX `idx_email_templates_category` (`category`),
  CONSTRAINT `fk_email_templates_updated_by`
    FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `email_template_versions` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `template_id`   INT          NOT NULL,
  `version`       INT          NOT NULL,
  `subject`       TEXT         NOT NULL,
  `body_html`     LONGTEXT     NOT NULL,
  `body_text`     TEXT         NULL,
  `cadence`       ENUM('IMMEDIATE','DAILY','WEEKLY','OFF') NOT NULL,
  `digest_filter` ENUM('ALL','BELOW_THRESHOLD','ROUTED_TO_QA') NOT NULL DEFAULT 'ALL',
  `is_enabled`    TINYINT(1)   NOT NULL,
  `edited_by`     INT          NULL,
  `edited_at`     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_email_tpl_versions_tid_v` (`template_id`, `version`),
  CONSTRAINT `fk_email_tpl_versions_template`
    FOREIGN KEY (`template_id`) REFERENCES `email_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_email_tpl_versions_editor`
    FOREIGN KEY (`edited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `email_log` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `template_key`        VARCHAR(100) NOT NULL,
  `to_email`            VARCHAR(255) NOT NULL,
  `to_user_id`          INT          NULL,
  `subject`             TEXT         NOT NULL,
  `status`              ENUM(
                          'SENT','FAILED',
                          'SKIPPED_DISABLED','SKIPPED_OFF','SKIPPED_RATE_LIMIT',
                          'SKIPPED_QUIET_HOURS','SKIPPED_INACTIVE_USER',
                          'SKIPPED_CIRCUIT_BREAKER','SKIPPED_NOT_CONFIGURED'
                        ) NOT NULL,
  `error_message`       TEXT         NULL,
  `message_id`          VARCHAR(255) NULL,
  `dedupe_key`          VARCHAR(255) NOT NULL,
  `related_entity_type` VARCHAR(50)  NULL,
  `related_entity_id`   INT          NULL,
  `sent_at`             DATETIME(0)  NULL,
  `created_at`          DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_email_log_dedupe_key` (`dedupe_key`),
  INDEX `idx_email_log_user_date`  (`to_user_id`, `created_at`),
  INDEX `idx_email_log_tpl_date`   (`template_key`, `created_at`),
  INDEX `idx_email_log_status_date`(`status`, `created_at`),
  CONSTRAINT `fk_email_log_user`
    FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notification_queue` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `user_id`       INT          NOT NULL,
  `template_key`  VARCHAR(100) NOT NULL,
  `payload`       JSON         NOT NULL,
  `scheduled_for` DATETIME(0)  NOT NULL,
  `dedupe_key`    VARCHAR(255) NOT NULL,
  `processed_at`  DATETIME(0)  NULL,
  `created_at`    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_notif_queue_dedupe_key` (`dedupe_key`),
  INDEX `idx_notif_queue_due`    (`scheduled_for`, `processed_at`),
  INDEX `idx_notif_queue_user_t` (`user_id`, `template_key`),
  CONSTRAINT `fk_notif_queue_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
