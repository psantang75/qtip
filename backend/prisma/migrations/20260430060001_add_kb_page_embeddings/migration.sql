-- Cached BookStack page embeddings for semantic KB grounding (Phase 4 of
-- the AI Reviewer Maturity Rollout). Vectors are stored as packed Float32
-- arrays (4 bytes per dim) in a MEDIUMBLOB so we don't depend on MySQL 9's
-- VECTOR type. In-process cosine similarity over a few hundred pages is
-- microseconds, which is plenty for our scale.
CREATE TABLE `kb_page_embeddings` (
  `page_id`        INT UNSIGNED      NOT NULL,
  `page_name`      VARCHAR(500)      NOT NULL,
  `page_url`       VARCHAR(500)      NOT NULL,
  `book_slug`      VARCHAR(150)      NOT NULL,
  `content_sha`    CHAR(64)          NOT NULL,
  `embedding`      MEDIUMBLOB        NOT NULL,
  `embedding_dims` SMALLINT UNSIGNED NOT NULL,
  `chars`          INT UNSIGNED      NOT NULL,
  `crawled_at`     DATETIME(3)       NOT NULL,
  PRIMARY KEY (`page_id`),
  INDEX `idx_kb_book` (`book_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
