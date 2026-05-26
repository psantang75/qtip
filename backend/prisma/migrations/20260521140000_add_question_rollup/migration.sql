-- Declarative roll-up support on form_questions.
--
-- Three nullable / defaulted columns power the new rollupEngine
-- (backend/src/utils/rollupEngine.ts). All existing rows default to
-- role='DETAIL' which keeps scoring + builder behaviour bit-identical
-- to today. ROLLUP rows are computed at submit/render time from their
-- `rollup_member_question_ids`; the scoring engine does not change.
ALTER TABLE `form_questions`
  ADD COLUMN `role`                       ENUM('DETAIL', 'ROLLUP') NOT NULL DEFAULT 'DETAIL' AFTER `is_critical`,
  ADD COLUMN `rollup_rule`                ENUM('ANY_NO_TO_NO')     NULL     AFTER `role`,
  ADD COLUMN `rollup_member_question_ids` JSON                     NULL     AFTER `rollup_rule`;
