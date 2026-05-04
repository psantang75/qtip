-- One-shot backfill: copy the human-edited "Ticket Review Feedback"
-- free-text answer into ai_calibration_data.notes for past
-- promoted-draft rows where notes is still NULL.
--
-- Why: the new "Why are you correcting the AI?" UI textbox writes its
-- value to ai_calibration_data.notes and the AI prompt now injects
-- that text as a "Reviewer's reason" bullet. For drafts that were
-- promoted *before* this UI existed, the reviewer's only authored
-- text lives in the form's "Ticket Review Feedback" answer. Copying
-- it across gives the AI immediate calibration value without making
-- past reviewers redo the work.
--
-- Idempotent: WHERE notes IS NULL guards against re-runs overwriting
-- a real reason. Safe to apply more than once (will simply pick up
-- any newly-promoted rows that still don't have a reason).

UPDATE ai_calibration_data acd
JOIN submission_answers sa
  ON sa.submission_id = acd.human_submission_id
JOIN form_questions fq
  ON fq.id = sa.question_id
SET acd.notes = TRIM(sa.answer)
WHERE acd.source = 'qa_promoted_draft'
  AND acd.notes IS NULL
  AND fq.question_text = 'Ticket Review Feedback'
  AND sa.answer IS NOT NULL
  AND TRIM(sa.answer) <> '';
