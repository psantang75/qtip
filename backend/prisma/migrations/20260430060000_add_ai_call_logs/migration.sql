-- Audit table for every LLM call made by the AI Reviewer (Phase 3 of the
-- AI Reviewer Maturity Rollout). Writes are best-effort fire-and-forget;
-- a logging failure must never fail an LLM call.
CREATE TABLE `ai_call_logs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `provider`        VARCHAR(32)     NOT NULL,
  `model`           VARCHAR(64)     NOT NULL,
  `purpose`         VARCHAR(64)     NOT NULL,
  `ticket_id`       INT UNSIGNED    NULL,
  `submission_id`   INT UNSIGNED    NULL,
  `form_id`         INT UNSIGNED    NULL,
  `prompt_hash`     CHAR(64)        NOT NULL,
  `prompt_chars`    INT UNSIGNED    NOT NULL,
  `response_chars` INT UNSIGNED    NOT NULL,
  `tokens_in`       INT UNSIGNED    NULL,
  `tokens_out`      INT UNSIGNED    NULL,
  `elapsed_ms`      INT UNSIGNED    NOT NULL,
  `retried`         TINYINT(1)      NOT NULL DEFAULT 0,
  `success`         TINYINT(1)      NOT NULL,
  `error_code`      VARCHAR(64)     NULL,
  `error_message`   TEXT            NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ai_call_logs_ticket` (`ticket_id`),
  INDEX `idx_ai_call_logs_submit` (`submission_id`),
  INDEX `idx_ai_call_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
