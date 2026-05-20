-- Cross-cutting (X1): tag every ai_call_logs row with which two-pass
-- stage produced it (classification | trace | synthesis | verification
-- | single_pass) and which case_id it belongs to. The pass column is
-- defaulted to 'single_pass' so historical rows keep aggregating
-- correctly without a separate backfill query. case_id stays NULL on
-- legacy rows; new rows fill it from submissions.case_id at write time.
ALTER TABLE `ai_call_logs`
    ADD COLUMN `pass` VARCHAR(16) NOT NULL DEFAULT 'single_pass' AFTER `purpose`,
    ADD COLUMN `case_id` VARCHAR(64) NULL AFTER `form_id`,
    ADD INDEX `idx_ai_call_logs_pass` (`pass`),
    ADD INDEX `idx_ai_call_logs_case` (`case_id`);
