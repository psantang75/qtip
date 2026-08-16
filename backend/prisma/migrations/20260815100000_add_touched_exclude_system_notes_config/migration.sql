-- Rollback switch for the "Touched" system-note cleanup.
--
-- When '1' (default), the daily capture, the history backfill, and the
-- touch-detail drill-down all exclude machine-written CRM notes (auto-closes,
-- status stamps, lead-creation records, ticket status transitions) from the
-- Touched effort metric via the shared systemNoteClassifier. Set to '0' to fall
-- back to the pre-cleanup behavior (count every noted action/ticket note)
-- without a redeploy. INSERT IGNORE so a hand-edited value survives re-runs.
INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('touched_exclude_system_notes', '1', 'Tickets & Tasks productivity: when 1, system-generated CRM notes are excluded from the Touched metric (capture, backfill, and drill-down). Set to 0 to disable the exclusion without a redeploy.');
