-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the "Internal Research → Overview" Insights page.
--
-- The IR section no longer has an Overview dashboard (it now starts at Quality),
-- so its registry row is retired to keep the catalog in sync with the router.
-- Data-only and idempotent (re-running is a no-op once the row is gone). No
-- schema change.
--
-- The `ie_page_role_access`, `ie_page_user_override`, and
-- `ie_page_department_access` children all cascade on `ie_page` delete, so this
-- single statement also clears every role grant / user override / department
-- grant that pointed at `ir_overview`. Seeded in
-- 20260901180000_add_study_form_mode; `ir_quality` and `ir_agents` are kept.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM `ie_page` WHERE `page_key` = 'ir_overview';
