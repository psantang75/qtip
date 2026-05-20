-- One-time backfill of the new DB-managed rule pack tables from the
-- legacy file artifacts so dev / staging / prod all start with the same
-- 2 packs + 1 form assignment that were checked into the repo.
--
-- Sources:
--   • backend/prompts/rule-packs/tech-ticket-process.md
--   • backend/prompts/rule-packs/call-quality-12-category.md
--   • backend/config/ai-form-rule-packs.json   ({ "99017": ["tech-ticket-process"] })
--
-- Idempotent via INSERT ... ON DUPLICATE KEY UPDATE on the unique key
-- columns (`ai_rule_pack.key` and `ai_form_rule_pack_assignment(form_id,
-- rule_pack_id)`). Running this migration twice is a no-op the second time.
--
-- After the migration is verified in dev, the source files (the two
-- markdown packs and the JSON assignment file) are deleted in a
-- follow-up commit. The new RulePackService reads exclusively from these
-- tables — no fs.readFileSync fallback.

-- ---------------------------------------------------------------------
-- Pack 1: Tech Ticket Process (Tech Support)
-- ---------------------------------------------------------------------
INSERT INTO `ai_rule_pack` (`key`, `name`, `owner_dept`, `body_md`, `always_include_urls_json`, `is_archived`)
VALUES (
  'tech-ticket-process',
  'Tech Ticket Process',
  'Tech Support',
  'Description grading:
- The Description field must restate what the customer reported, in the customer''s words after intake (e.g. "player showing Server Unreachable"). A vague description like "music not playing" is a documentation gap when the notes show a more specific symptom.
- Compare the description against the chosen Class/Subclass: do the documented rules and steps for that subclass actually fit what the description says? If yes, the agent satisfied the description and should receive full credit on the description-related questions.

Class / Subclass / Resolution evaluation:
- Use the KB pages for the matching subclass to evaluate whether the right steps were followed. Do NOT reference the page titled "Ticket/Task Classification/Sub Classifications & Resolutions" — that page is just a list of valid options, not a reference for how to handle the work.
- Resolution is judged against the actions and outcome documented in the notes — NOT against a literal "Resolution: …" line. If the closing notes show the outcome being achieved (e.g. "power-cycle restored service", "customer confirmed playback resumed", "satellite radio activation completed"), that supports a chosen Resolution even when the agent never restated the resolution wording inside the notes themselves.
- If the matching subclass has no playbook KB page (example: "Activate Satellite Radio" currently has no documented playbook), do the classification-text KB search and treat the returned pages as the documented process. Add an `observation` of kind `documentation` noting the missing playbook so QA can prioritize creating it.

Timeline + cadence:
- Always trace the notes timeline against the "Ticket Handling Process" and "How to Open a New Ticket" KB pages. These two pages define the universal cadence for tech tickets — every tech ticket review should reference them when evaluating follow-ups, status changes, and closure.
- Confirm follow-up notes were left at the cadence the KB calls for. Cadence drift goes into `observations` (not the score) unless the form explicitly grades cadence.

Common advisory observations to flag (non-scored):
- Cut-and-paste notes that don''t add new information for the day they were left.
- Vague descriptions that don''t restate the customer''s specific symptom.
- Missing customer identity verification when the ticket touches account changes.
- Ambiguous next steps in the most recent open note.
- Any PII captured in notes that doesn''t belong there (full credit card numbers, full SSN, etc.).',
  JSON_ARRAY(
    'http://know.crm.dm-us.com/books/job-billing-customer-service/page/ticket-handling-process',
    'http://know.crm.dm-us.com/books/job-billing-customer-service/page/how-to-open-a-new-ticket'
  ),
  0
)
ON DUPLICATE KEY UPDATE
  `name`                     = VALUES(`name`),
  `owner_dept`               = VALUES(`owner_dept`),
  `body_md`                  = VALUES(`body_md`),
  `always_include_urls_json` = VALUES(`always_include_urls_json`);

-- ---------------------------------------------------------------------
-- Pack 2: Call Quality (12-Category Rubric) (Quality Assurance)
-- ---------------------------------------------------------------------
INSERT INTO `ai_rule_pack` (`key`, `name`, `owner_dept`, `body_md`, `always_include_urls_json`, `is_archived`)
VALUES (
  'call-quality-12-category',
  'Call Quality (12-Category Rubric)',
  'Quality Assurance',
  'Phase B universal call rubric. Use this pack on any form whose interaction_type is CALL (or whose questions otherwise grade live agent dialog). It mirrors the AWS Bedrock customer-service-transcript-analysis 12-category rubric with chanl-eval style criteria layered on top, so the AI grades every call against the same baseline regardless of how the form authors phrased their questions.

Tone & courtesy:
- Greeting must include agent name and an offer of assistance ("Thanks for calling, this is …, how can I help?"). Missing greeting → grade as a process gap on any tone/intro question.
- Hold and transfer language must be polite and explicit: ask permission, state the reason, give an ETA, thank the customer when returning.
- Closing must include a recap of what was done and an offer of additional help ("Anything else I can help you with today?"). A bare "have a nice day" is a soft fail unless the rest of the call already handled the recap.

Active listening:
- Customer''s reported symptom must be restated by the agent at least once before troubleshooting begins. Restatement does not count if it just paraphrases generic ticket language ("you''re having an issue with X") — it must touch the specific complaint.
- Long agent monologues without acknowledgement are a `cadence` observation. Two consecutive customer turns without agent acknowledgement → grade as listening gap on any related question.

Empathy & rapport:
- When the customer expresses frustration, the agent must acknowledge it explicitly ("I understand this is frustrating", "I can imagine how disruptive that is"). Missing empathy on a clearly upset customer → grade as a `best_practice` gap, not as ok-because-resolved.
- Empathy is graded on appropriateness, not frequency. Empty validation statements ("totally understand!" with no follow-through) do NOT clear the bar.

De-escalation:
- When a customer escalates (raises voice, threatens cancellation, references prior failure), the agent must (1) acknowledge the issue, (2) take ownership ("Let me make this right"), (3) propose a concrete next step. Missing any of those steps → grade as a de-escalation gap.
- Apologising and immediately deflecting ("I''m sorry, but our policy …") is graded as a missed de-escalation, not as policy compliance.

Discovery:
- The agent must confirm the customer''s identity (or note in the call header that the call did not require account changes) BEFORE any account-affecting action. Identity skipped on account-affecting calls is a critical gap.
- Open-ended discovery questions ("What were you doing when this started?", "When did this last work?") should appear before any troubleshooting attempts. Jumping to a fix without discovery is a process gap on any "discovery / understanding" question.

Troubleshooting & process compliance:
- Compare each agent action against the assigned playbook KB page (or the top KB pages returned by the topic classifier). List every missing step in the `Steps followed` narrative bullet by name — do NOT collapse into "some steps not followed".
- Out-of-order steps are a `process_drift` observation AND a graded gap on any process-compliance question, even when the issue ultimately resolves. Document the order in the timeline.
- Time-on-step that exceeds the playbook''s recommended limit without explanation is a cadence observation.

Resolution & ownership:
- The agent must clearly state the resolution (or the next step when it''s an unresolved transfer/escalation) before ending the call. "I think we got it" without confirmation is a resolution gap.
- Customer must verbally confirm the resolution when on a live call ("Yes, that''s working now", "Got it, thanks"). No confirmation on a "resolved" call → grade as resolution gap on any related question.

Communication clarity:
- Avoid jargon without explanation ("recommissioning the channel map" → must follow with a plain-language paraphrase). Jargon-without-paraphrase counts on any communication-quality question.
- Long pauses, dead air, and unexplained holds are timing observations.

Compliance & PII:
- Reading back full credit card numbers, full SSN, or driver''s license numbers on the call audio → critical compliance gap. Verify only the last 4 / partial wherever possible.
- Recording-disclosure must be present at the start of any call where the system did not auto-announce it. When unclear, flag as a `pii` observation.

Note quality (post-call documentation):
- Notes must restate the customer''s specific symptom, the steps walked, the outcome, and the next step. Missing any of those four elements → grade as a documentation gap.
- "See call recording" alone is NEVER sufficient documentation, even if the recording exists. The point of the note is to be readable without the recording.
- Cut-and-paste notes that don''t add new information for the date they were left → `documentation` observation.

Common advisory observations to flag (non-scored):
- Agent multitasking signals (typing latency, audible distractions, asking customer to repeat).
- Long unexplained holds (> 90s) with no apology / status check on return.
- Customer interrupting agent repeatedly — signal of unmet expectations or unclear comms.
- Discrepancies between the agent''s verbal commitment and what was actually documented in the notes.
- Any direct request from the customer that the agent never explicitly acknowledged.',
  JSON_ARRAY(
    'http://know.crm.dm-us.com/books/general-support-instructions/page/call-handling-dos-and-donts'
  ),
  0
)
ON DUPLICATE KEY UPDATE
  `name`                     = VALUES(`name`),
  `owner_dept`               = VALUES(`owner_dept`),
  `body_md`                  = VALUES(`body_md`),
  `always_include_urls_json` = VALUES(`always_include_urls_json`);

-- ---------------------------------------------------------------------
-- Form → pack assignment: { "99017": ["tech-ticket-process"] }
-- INSERT IGNORE so re-running is safe. The new form_id is referenced by
-- a sub-select against the pack key so we don't have to know the
-- AUTO_INCREMENT id of the row we just inserted.
-- ---------------------------------------------------------------------
INSERT IGNORE INTO `ai_form_rule_pack_assignment` (`form_id`, `rule_pack_id`, `sort_order`)
SELECT 99017, p.id, 0
FROM `ai_rule_pack` p
WHERE p.`key` = 'tech-ticket-process';
