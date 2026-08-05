-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance points: policy start date.
--
-- Punch and schedule history in QTIP predates the day the attendance point
-- policy actually took effect (2026-06-21). Scoring those earlier days would
-- charge people points for a policy that did not exist yet. This seeds a single
-- admin-tunable value; the read layer floors the rolling window to it and the
-- engine refuses to score before it, so nothing prior to the start date is ever
-- counted or written. No schema change — the same ie_config key-value store the
-- KB scheduler interval and the admin-unlock guardrails use.
--
-- Conventions match 20260804210000_add_record_unlock: INSERT IGNORE so the
-- migration is idempotent and a hand-edited value is never clobbered.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('attendance_points_start_date', '2026-06-21', 'Attendance points: policy start date. Occurrences before this date are never scored or counted even though earlier punch/schedule history exists. Format YYYY-MM-DD.');
