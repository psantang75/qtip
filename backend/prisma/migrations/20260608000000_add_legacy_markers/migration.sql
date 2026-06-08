-- Mark records imported from the legacy (pre-split) QTIP system.
-- `is_legacy` flags a migrated row so the UI can show a historical-data banner.
-- `legacy_coaching_type` preserves the original combined `coaching_type` enum
-- value (e.g. 'Verbal Warning', '1-on-1', 'PIP') for reference after the split.

ALTER TABLE `coaching_sessions`
  ADD COLUMN `is_legacy`            TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN `legacy_coaching_type` VARCHAR(50) NULL;

ALTER TABLE `write_ups`
  ADD COLUMN `is_legacy`            TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN `legacy_coaching_type` VARCHAR(50) NULL;
