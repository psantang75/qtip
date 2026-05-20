-- Phase B (B4): tag every calibration row with the kind of external
-- source the row applies to. Until now the `ticket_id` column was the
-- de-facto external id and was always assumed to be a CRM ticket. With
-- call-only review submissions reaching the calibration table, we need
-- to know whether the id refers to a ticket or to a Genesys call so the
-- correction prompt can render "Source: ticket #X" vs "Source: call #X"
-- accurately, and so the inbox / per-source filtering can group rows
-- correctly.
--
-- Backfill: every existing row was a ticket-only calibration, so we
-- default to 'TICKET'. New rows from the CALL adapter will write 'CALL'.
ALTER TABLE `ai_calibration_data`
  ADD COLUMN `source_kind` VARCHAR(16) NOT NULL DEFAULT 'TICKET' AFTER `source`;

-- Helps the few-shot retriever cheaply ask "give me only the corrections
-- that came from CALL submissions" once we start mixing call+ticket
-- corrections in the same form.
ALTER TABLE `ai_calibration_data`
  ADD INDEX `idx_calib_form_source_kind` (`form_id`, `source_kind`);
