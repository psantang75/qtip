# Sales missed opportunities review — current implementation

The review uses eligible calls from the selected business day, available matched Lead Manager/Contact Manager history, configured database rules/persona and supplied company KB. It returns a concise interaction summary and specific miss, source evidence, practical next-time advice, and an appropriate recovery action.

The [enhancement specification](sales_missed_opportunities_enhancement_plan.md) is the implementation plan. The [KB coverage and missing-page list](sales_qa_kb_gap_analysis.md) and [sales-play audit](sales_plays_audit.md) remain planning/audit documents. The application does not load these files as policy.

## Configuration ownership

The mandatory [runtime-configuration guardrail](../.cursor/rules/runtime-configuration.mdc) requires editable business content in the database. Existing rules use `ie_missed_opportunity_rule`; the persona and other settings use `ie_config`. They remain editable through Admin → Insights Engine → Missed Opportunities. Code owns validation, evidence/output contracts and processing logic.

The file-based QA loader, reference manifest, build-copy helper, path environment variable, synthetic read-only categories and file-backed label lookup added in the preceding revision have been removed. No runtime Markdown reference is required.

The [SQL seed](../backend/scripts/seed_sales_qa_review_rules.sql) contains the fourteen QA categories introduced by this task as editable database rules, including actual question/gate requirements and coaching guidance. It adds only missing keys to the existing table and preserves operator edits on existing keys. **Applied with user approval to the local database `localhost:3306/qtip` on 2026-09-14 at 09:12:42 EDT (13:12:42 UTC).** All fourteen rows are active (IDs 22–35); all eleven existing rows were verified unchanged, giving twenty-five active rules. The QA form, persona, KB, sales plays and schema were not changed. No seed was applied to staging or production.

The QA form itself remains in the Form Builder database. These rule rows are a versioned coaching adaptation; automatic live-form binding and source-version tracking remain proposed. A later form change requires deliberate reconciliation with the review rules. This feature does not create scored QA submissions or expose Internal manager answers.

## Evidence and operating limits retained

- At most three distinct material findings reach the report. Do not invent opportunities, lost revenue, deadlines, offers or recovery actions. Credit valid prior completion, a declined appropriate offer and legitimate prerequisites.
- CRM matching is best effort. Same-lead Lead Manager and Contact Manager threads can be combined; weak matches need corroboration. Bounded, unavailable or truncated history cannot prove missing work.
- Earlier notes establish prior context; later same-day notes establish follow-through. Recent notes currently take priority under retrieval limits, so older relevant work may be omitted. Same-day lead creation by one AE does not disprove an earlier or another owner's lead.
- Findings need a supporting quote; malformed output is a failure, not a clean call. The omission verifier remains a limited transcript-only check.
- KB grounding fetches configured anchor text up to 12,000 characters/page and 48,000 total. It does not follow linked branches. The play renderer can supply eight plays per category, up to 48 in the current six categories. Audit recommendations did not change live plays.
- The connected-call selector, minimum talk threshold, exclusions, candidate limit and run-level spend checks remain. Many short/no-contact calls are outside selection. Strict reservations across concurrency/reruns, selective retrieval, complete call summaries and interaction metrics remain proposed.
- No automatic customer messages, CRM tasks, form changes or recovery execution are added. Deploying code, applying a database seed and re-grading a day are separate actions.

## Scope of this correction

Only this task's reference implementation, associated tests/docs/build/config hooks, the explicitly requested repository guardrails, and the fourteen approved local database rule inserts were changed. Existing unrelated work in the shared workspace was preserved. No service restart, model rerun or deployment was performed.

## Validation of this correction

290 targeted backend tests passed. Both production builds passed; lint passed with one existing unused-eslint-directive warning in the play service. Checked that the seed has 14 non-overwriting inserts, all supplied category question IDs and no schema changes. The approved local insertion ran in one transaction: verified every inserted field, preserved every pre-existing rule including timestamps, and confirmed the committed rows with a fresh database read. No QA rule keys remain missing locally.
