-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities: is a rule's miss an OMISSION or a COMMISSION?
--
-- The verification pass (services/insights/missedOpportunities/verify.ts) audits
-- a draft finding by asking one question: "does the transcript show the rep
-- ATTEMPTING the thing this finding says they skipped?" That question is sharp
-- and checkable for most rules, and meaningless for the rest — the rep plainly
-- DID leave the voicemail and DID say the thing on the recorded line, so those
-- rules are graded on the CONTENT of what happened, not on a skipped step. Asked
-- literally, the auditor answers "yes, they did it" and deletes the finding on
-- the grounds that the rep did the very thing it criticises. It did exactly that
-- to a high-severity margin-disclosure finding on the 2026-09-09 re-run.
--
-- That distinction shipped first as a hardcoded rule_key list in verify.ts, which
-- was wrong for this feature: the rule set is DATA (admins add, edit, and
-- deactivate rules from the Settings tab with no deploy), so a list in code means
-- the next conduct-style rule someone writes is silently second-guessed by the
-- auditor with nothing in the UI to explain why. This column moves the decision
-- to the rule itself, where the person authoring it can see and set it.
--
-- DEFAULT TRUE is the safe default in both directions: every existing rule keeps
-- today's behaviour, and a new rule is audited unless its author says otherwise
-- (an audited rule can lose a false positive; an unaudited one cannot).
--
-- Purely additive — no existing data is rewritten. Idempotent via the
-- information_schema guard, since MySQL has no ADD COLUMN IF NOT EXISTS and a
-- bare ALTER aborts on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_missed_opportunity_rule' AND COLUMN_NAME = 'is_omission') > 0,
  'DO 0',
  'ALTER TABLE `ie_missed_opportunity_rule` ADD COLUMN `is_omission` BOOLEAN NOT NULL DEFAULT TRUE AFTER `is_active`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- The two rules in the starter set graded on content rather than on a skipped
-- step. Re-running is a no-op; an admin may flip either back from the Settings
-- tab and this migration will not undo that on a later deploy, because it only
-- ever runs once per database.
UPDATE `ie_missed_opportunity_rule`
   SET `is_omission` = FALSE
 WHERE `rule_key` IN ('weak_or_missing_voicemail', 'professionalism_or_compliance');
