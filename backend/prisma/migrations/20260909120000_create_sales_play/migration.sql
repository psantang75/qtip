-- Sales plays (Phase 2 of the sales suggestion engine).
--
-- One row per "play" — a winning tactic or line mined from a prior WON (or, for
-- contrast, LOST) sales call. Admin-approved plays (status='active') ground the
-- Missed Opportunities recommended-approach wording; they never create a miss.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS touches no existing table.
CREATE TABLE IF NOT EXISTS `ie_sales_play` (
  `play_id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `category`               VARCHAR(32)  NOT NULL,                       -- objection|closing|discovery|upsell|urgency|research
  `title`                  VARCHAR(240) NOT NULL,
  `body_md`                MEDIUMTEXT   NOT NULL,                       -- the winning tactic / line
  `evidence_quote`         VARCHAR(1200) NULL,
  `evidence_speaker`       VARCHAR(16)  NULL,                           -- CUSTOMER|AGENT
  `source_outcome`         VARCHAR(8)   NOT NULL,                       -- WON|LOST
  `source_conversation_id` VARCHAR(64)  NULL,
  `source_agent_name`      VARCHAR(160) NULL,
  `est_value_note`         VARCHAR(240) NULL,
  `status`                 VARCHAR(16)  NOT NULL DEFAULT 'proposed',    -- proposed|active|archived
  `sort_order`             INT          NOT NULL DEFAULT 100,
  `created_at`             DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by`             INT          NULL,
  `updated_at`             DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`play_id`),
  KEY `idx_sales_play_status` (`status`, `sort_order`),
  KEY `idx_sales_play_conv` (`source_conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
