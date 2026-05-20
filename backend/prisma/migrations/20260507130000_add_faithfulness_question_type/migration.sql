-- Phase D (D1): widen the form_questions.question_type enum so a form
-- can carry an AI-only FAITHFULNESS question. Auto-graded by the AI
-- Reviewer's synthesis pass from the cross-source faithfulness object;
-- humans don't author or edit the value, so no UI changes are required
-- to roll this enum value forward safely.
ALTER TABLE `form_questions`
    MODIFY COLUMN `question_type` ENUM(
        'YES_NO',
        'SCALE',
        'N_A',
        'TEXT',
        'INFO_BLOCK',
        'RADIO',
        'SUB_CATEGORY',
        'MULTI_SELECT',
        'FAITHFULNESS'
    ) NOT NULL;
