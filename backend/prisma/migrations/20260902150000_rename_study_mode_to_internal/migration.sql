-- ─────────────────────────────────────────────────────────────────────────────
-- Rename the non-public form mode token 'STUDY' -> 'INTERNAL'.
--
-- The user-facing label became "Internal"; this aligns the stored `access_mode`
-- token so the DB value and the UI label stay consistent. Data-only and
-- idempotent (re-running is a no-op once no 'STUDY' rows remain). No schema
-- change — the column type/length is unchanged.
--
--   * forms.access_mode        — the form's current mode.
--   * submissions.access_mode  — the per-submission snapshot taken at creation.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE `forms`       SET `access_mode` = 'INTERNAL' WHERE `access_mode` = 'STUDY';
UPDATE `submissions` SET `access_mode` = 'INTERNAL' WHERE `access_mode` = 'STUDY';
