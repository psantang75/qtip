-- Phase D (D2): structured QTIP front-matter metadata for BookStack
-- pages. Populated by the kb-crawl script; consumed by AIReviewerService
-- searchKb() to filter pages by review kind (qtip_applies_to) and rank
-- by authority. Pages without a front-matter block have no row here.
CREATE TABLE `kb_pages_meta` (
    `page_id`          INT UNSIGNED NOT NULL,
    `qtip_role`        VARCHAR(64) NULL,
    `qtip_applies_to`  JSON NULL,
    `qtip_steps`       JSON NULL,
    `qtip_authority`   VARCHAR(64) NULL,
    `playbook_steps`   JSON NULL,
    `parsed_at`        DATETIME(3) NOT NULL,
    PRIMARY KEY (`page_id`),
    KEY `idx_kb_meta_authority` (`qtip_authority`)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE = utf8mb4_unicode_ci;
